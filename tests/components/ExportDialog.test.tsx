// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import type { Case, ExportOptions, ExportPreflight } from '@shared/types'
import type { ExportProgressEvent, ExportResult } from '@shared/ipc'

vi.mock('motion/react', async () => {
  const React = await import('react')
  const motion = new Proxy(
    {},
    {
      get: (_, tag: string) =>
        React.forwardRef<HTMLElement, Record<string, unknown> & { children?: React.ReactNode }>(
          ({ children, ...props }, ref) => {
            const {
              initial,
              animate,
              exit,
              transition,
              whileTap,
              whileHover,
              layout,
              ...domProps
            } = props
            void initial
            void animate
            void exit
            void transition
            void whileTap
            void whileHover
            void layout
            // forwardRef wraps P in PropsWithoutRef, which collapses an index-signature
            // props type through Omit and widens children to unknown. Narrow it back.
            return React.createElement(tag, { ...domProps, ref }, children as React.ReactNode)
          }
        )
    }
  )

  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children
  }
})

vi.mock('@renderer/hooks/useCompletionCelebration', () => ({
  useCompletionCelebration: () => ({ celebrate: vi.fn(), celebrationProps: {} })
}))

import { ExportDialog, EXPORT_PRESETS, detectPreset } from '@renderer/components/export/ExportDialog'
import { fakeBridge } from '../renderer/fakeBridge'

const CASE: Case = {
  id: 'case-1',
  name: 'Case One',
  isDemo: false,
  archived: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
}

// The preflight read and the generate write are a query and a mutation now, so
// the dialog needs a client. retry:false keeps a failed export from being
// retried behind the assertions.
function renderDialog(onClose = vi.fn(), selectedCaptureIds?: string[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  return render(
    <QueryClientProvider client={client}>
      <ExportDialog
        caseId="case-1"
        caseName="Case One"
        selectedCaptureIds={selectedCaptureIds}
        onClose={onClose}
      />
    </QueryClientProvider>
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function lastOptions(generateReport: ReturnType<typeof vi.fn>): ExportOptions {
  const [, options] = generateReport.mock.calls.at(-1) as [string, ExportOptions]
  return options
}

describe('ExportDialog', () => {
  let preflight: ReturnType<typeof vi.fn>
  let getCase: ReturnType<typeof vi.fn>
  let generateReport: ReturnType<typeof vi.fn>
  let showItemInFolder: ReturnType<typeof vi.fn>
  let openPath: ReturnType<typeof vi.fn>
  let onExportProgress: ReturnType<typeof vi.fn>
  let progressCb: ((event: ExportProgressEvent) => void) | null

  beforeEach(() => {
    progressCb = null
    preflight = vi.fn().mockResolvedValue({
      captureCount: 3,
      stampedCaptureCount: 1,
      unstampedCaptureCount: 2,
      pendingCaptureCount: 1,
      noneCaptureCount: 1
    } satisfies ExportPreflight)
    getCase = vi.fn().mockResolvedValue(CASE)
    generateReport = vi.fn().mockResolvedValue({
      canceled: false,
      filePath: 'Case_One_evidence.zip'
    } satisfies ExportResult)
    showItemInFolder = vi.fn().mockResolvedValue(undefined)
    openPath = vi.fn().mockResolvedValue(undefined)
    onExportProgress = vi.fn((cb: (event: ExportProgressEvent) => void) => {
      progressCb = cb
      return vi.fn()
    })
    fakeBridge({
      export: { preflight, generateReport },
      cases: { get: getCase },
      shell: { showItemInFolder, openPath },
      onExportProgress
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the un-stamped capture warning before export', async () => {
    renderDialog()

    expect(
      await screen.findByText(/2 captures will export without RFC 3161 trusted time/)
    ).toBeDefined()
    expect(preflight).toHaveBeenCalledWith('case-1')
  })

  it('exports the Full evidence bundle preset by default', async () => {
    renderDialog()

    fireEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    const options = lastOptions(generateReport)
    expect(options.format).toBe('zip')
    expect(options.exportClass).toBe('evidence')
    expect(options.outputPath).toBe('Case One_evidence.zip')
    // The include toggles decide what lands in the evidence package, so pin
    // all five rather than only the ones that name the file.
    expect(options.include).toEqual({
      captures: true,
      screenshots: true,
      auditTrail: true,
      notes: true,
      annotations: 'burned'
    })
    // Whole-case export: no selection scope key at all, never [].
    expect('captureIds' in options).toBe(false)
  })

  // AC 1: presets map to the decided classes.
  it('maps the Working copy preset to the working-copy class and a marked filename', async () => {
    renderDialog()

    fireEvent.click(screen.getByLabelText(/Working copy/))
    fireEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    const options = lastOptions(generateReport)
    expect(options.exportClass).toBe('working-copy')
    expect(options.outputPath).toBe('Case One_working_copy.zip')
    expect(options.include).toEqual(EXPORT_PRESETS.working.selection.include)
  })

  it('maps the Court exhibit preset to an evidence export without operator notes', async () => {
    renderDialog()

    fireEvent.click(screen.getByLabelText(/Court exhibit/))
    fireEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    const options = lastOptions(generateReport)
    expect(options.exportClass).toBe('evidence')
    expect(options.include.notes).toBe(false)
    expect(options.include.auditTrail).toBe(true)
  })

  // AC 1: custom detection works — toggling an item off a preset drops the
  // radio selection and flips the disclosure label.
  it('detects a custom selection when an item is toggled off a preset', async () => {
    renderDialog()

    fireEvent.click(screen.getByText('Customise contents'))
    fireEvent.click(screen.getByLabelText('Screenshots'))

    expect(screen.getByText('Custom selection')).toBeDefined()
    const radios = screen.getAllByRole('radio')
    expect(radios.some((r) => (r as HTMLInputElement).checked)).toBe(false)

    fireEvent.click(screen.getByText('Export'))
    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    expect(lastOptions(generateReport).include.screenshots).toBe(false)
  })

  // AC 1: Evidence Package invariants are not deselectable.
  it('renders Manifest and Certification always-on and not deselectable', async () => {
    renderDialog()

    fireEvent.click(screen.getByText('Customise contents'))
    const manifest = screen.getByLabelText(
      'Manifest — full case chain, never a slice'
    ) as HTMLInputElement
    const certification = screen.getByLabelText('Certification') as HTMLInputElement
    for (const invariant of [manifest, certification]) {
      expect(invariant.checked).toBe(true)
      expect(invariant.disabled).toBe(true)
      fireEvent.click(invariant)
      expect(invariant.checked).toBe(true)
    }
    // Still the Full evidence bundle: clicking the invariants changed nothing.
    expect(screen.getByText('Customise contents')).toBeDefined()
  })

  it('replaces the custody card with a non-evidentiary notice under Working copy', async () => {
    renderDialog()

    expect(screen.getByTestId('export-custody-card')).toBeDefined()
    expect(screen.queryByTestId('export-working-copy-notice')).toBeNull()

    fireEvent.click(screen.getByLabelText(/Working copy/))

    expect(screen.queryByTestId('export-custody-card')).toBeNull()
    expect(screen.getByTestId('export-working-copy-notice').textContent).toMatch(
      /not a\s+verifiable object/
    )
    // The invariant rows do not exist for a Working Copy — there is no
    // Manifest or Certification to render as always-on.
    fireEvent.click(screen.getByText('Customise contents'))
    expect(screen.queryByLabelText('Certification')).toBeNull()
    expect(screen.queryByLabelText('Integrity verification')).toBeNull()
  })

  it('threads the purpose-or-authority text into the export options, trimmed', async () => {
    renderDialog()

    fireEvent.change(screen.getByPlaceholderText(/Disclosure under/), {
      target: { value: '  Disclosure under CPS request 2026/114  ' }
    })
    fireEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    expect(lastOptions(generateReport).purposeOrAuthority).toBe(
      'Disclosure under CPS request 2026/114'
    )
  })

  it('omits purposeOrAuthority entirely when the field is blank', async () => {
    renderDialog()

    fireEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    expect('purposeOrAuthority' in lastOptions(generateReport)).toBe(false)
  })

  it('shows the demonstration-case notice only for a demo case', async () => {
    getCase.mockResolvedValue({ ...CASE, isDemo: true })
    renderDialog()

    expect(await screen.findByTestId('export-demo-notice')).toBeDefined()

    cleanup()
    getCase.mockResolvedValue(CASE)
    renderDialog()
    await screen.findByText(/2 captures will export without/)
    expect(screen.queryByTestId('export-demo-notice')).toBeNull()
  })

  it('states the whole-case scope from the preflight count', async () => {
    renderDialog()

    await waitFor(() =>
      expect(screen.getByTestId('export-scope-row').textContent).toBe('Whole case — 3 captures')
    )
  })

  it('states a selection scope, the manifest note, and passes captureIds through', async () => {
    renderDialog(vi.fn(), ['cap-1', 'cap-2'])

    expect(screen.getByTestId('export-scope-row').textContent).toBe('2 selected captures')
    expect(screen.getByText(/scope: 'selection' · captureIds\[2\]/)).toBeDefined()

    fireEvent.click(screen.getByText('Export'))
    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    expect(lastOptions(generateReport).captureIds).toEqual(['cap-1', 'cap-2'])
  })

  it('renders the live step and percent from export progress events', async () => {
    const gate = deferred<ExportResult>()
    generateReport.mockReturnValue(gate.promise)
    renderDialog()

    fireEvent.click(screen.getByText('Export'))
    await waitFor(() => expect(onExportProgress).toHaveBeenCalled())

    act(() => {
      progressCb?.({ caseId: 'case-1', step: 'Verifying capture 2 of 3...', percent: 30 })
    })

    expect(await screen.findByText('Verifying capture 2 of 3...')).toBeDefined()
    expect(screen.getByText('30%')).toBeDefined()

    gate.resolve({ canceled: false, filePath: 'Case_One_evidence.zip' })
  })

  it('ignores progress events for other cases', async () => {
    const gate = deferred<ExportResult>()
    generateReport.mockReturnValue(gate.promise)
    renderDialog()

    fireEvent.click(screen.getByText('Export'))
    await waitFor(() => expect(onExportProgress).toHaveBeenCalled())

    act(() => {
      progressCb?.({ caseId: 'other-case', step: 'Should not show', percent: 99 })
    })

    expect(screen.queryByText('Should not show')).toBeNull()
    gate.resolve({ canceled: false, filePath: 'Case_One_evidence.zip' })
  })

  it('shows the completion screen with file actions on success', async () => {
    renderDialog()

    fireEvent.click(screen.getByText('Export'))

    expect(await screen.findByText('Export complete')).toBeDefined()
    expect(screen.getByText('Case_One_evidence.zip')).toBeDefined()

    fireEvent.click(screen.getByText('Reveal in folder'))
    expect(showItemInFolder).toHaveBeenCalledWith('Case_One_evidence.zip')

    fireEvent.click(screen.getByText('Open file'))
    expect(openPath).toHaveBeenCalledWith('Case_One_evidence.zip')
  })

  it('returns to the form when the save dialog is canceled (no false success)', async () => {
    generateReport.mockResolvedValue({ canceled: true } satisfies ExportResult)
    renderDialog()

    fireEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('Export')).toBeDefined())
    expect(screen.queryByText('Export complete')).toBeNull()
  })

  it('surfaces an error and offers retry', async () => {
    generateReport.mockRejectedValueOnce(new Error('disk full'))
    renderDialog()

    fireEvent.click(screen.getByText('Export'))

    expect(await screen.findByText(/disk full/)).toBeDefined()
    expect(screen.getByText('Try again')).toBeDefined()
  })
})

// The preset table and its detection are the dialog's contract with the issue:
// the mapping is pinned value-by-value so a drive-by edit to a preset shows up
// as a failed known answer, not a silently different package.
describe('EXPORT_PRESETS / detectPreset', () => {
  it('pins the three preset selections', () => {
    expect(EXPORT_PRESETS.full.selection).toEqual({
      exportClass: 'evidence',
      include: {
        captures: true,
        screenshots: true,
        auditTrail: true,
        notes: true,
        annotations: 'burned'
      }
    })
    expect(EXPORT_PRESETS.working.selection).toEqual({
      exportClass: 'working-copy',
      include: {
        captures: true,
        screenshots: true,
        auditTrail: false,
        notes: true,
        annotations: 'burned'
      }
    })
    expect(EXPORT_PRESETS.court.selection).toEqual({
      exportClass: 'evidence',
      include: {
        captures: true,
        screenshots: true,
        auditTrail: true,
        notes: false,
        annotations: 'burned'
      }
    })
  })

  it('detects each preset by set equality and anything else as custom', () => {
    expect(detectPreset(EXPORT_PRESETS.full.selection)).toBe('full')
    expect(detectPreset(EXPORT_PRESETS.working.selection)).toBe('working')
    expect(detectPreset(EXPORT_PRESETS.court.selection)).toBe('court')
    expect(
      detectPreset({
        exportClass: 'evidence',
        include: {
          captures: true,
          screenshots: false,
          auditTrail: true,
          notes: true,
          annotations: 'burned'
        }
      })
    ).toBe('custom')
    // The class participates in detection: the court include-set under the
    // working-copy class is not the Court exhibit preset.
    expect(
      detectPreset({
        exportClass: 'working-copy',
        include: EXPORT_PRESETS.court.selection.include
      })
    ).toBe('custom')
  })
})
