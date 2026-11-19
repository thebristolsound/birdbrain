// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react'
import type { Case, ExportOptions, ExportPreflight } from '@shared/types'
import type {
  ArchiveExportResult,
  ArchiveProgressEvent,
  ExportProgressEvent,
  ExportResult
} from '@shared/ipc'

const presence = vi.hoisted(() => ({ present: true }))

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
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    // The export menu's AnimatePresence flips this false when the exit starts.
    useIsPresent: () => presence.present
  }
})

const notifySuccess = vi.hoisted(() => vi.fn())
const notifyError = vi.hoisted(() => vi.fn())
vi.mock('@renderer/lib/notify', () => ({
  notify: { success: notifySuccess, error: notifyError }
}))

import {
  ExportDialog,
  EXPORT_PRESETS,
  detectPreset
} from '@renderer/components/export/ExportDialog'
import { useCaseExports } from '@renderer/components/export/useCaseExport'
import { fakeBridge } from '../renderer/fakeBridge'

// Literal copies of the three selections the dialog submitted before it had one choice list,
// which `tests/main/services/exportKnownAnswer.test.ts` pins the bytes of. They are not read
// from the dialog's own table, so a change to that table cannot move them with it.
const FULL_SELECTION = {
  exportClass: 'evidence',
  include: {
    captures: true,
    screenshots: true,
    auditTrail: true,
    notes: true,
    annotations: 'burned'
  }
} as const
const WITHOUT_NOTES_SELECTION = {
  exportClass: 'evidence',
  include: {
    captures: true,
    screenshots: true,
    auditTrail: true,
    notes: false,
    annotations: 'burned'
  }
} as const
const WORKING_SELECTION = {
  exportClass: 'working-copy',
  include: {
    captures: true,
    screenshots: true,
    auditTrail: false,
    notes: true,
    annotations: 'burned'
  }
} as const

// The three choices, each found by the name its label starts with.
const EVIDENCE = /^Evidence Package/
const WORKING = /^Working Copy/
const ARCHIVE = /^Case Archive/
const ARCHIVE_PATH = '/out/Case_One.birdbrain'

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

/** The class and the item set of the last export submitted, which decide the package. */
function lastSelection(generateReport: ReturnType<typeof vi.fn>) {
  const { exportClass, include } = lastOptions(generateReport)
  return { exportClass, include }
}

describe('ExportDialog', () => {
  let preflight: ReturnType<typeof vi.fn>
  let getCase: ReturnType<typeof vi.fn>
  let generateReport: ReturnType<typeof vi.fn>
  let showItemInFolder: ReturnType<typeof vi.fn>
  let openPath: ReturnType<typeof vi.fn>
  let onExportProgress: ReturnType<typeof vi.fn>
  let listCasePins: ReturnType<typeof vi.fn>
  let exportArchive: ReturnType<typeof vi.fn>
  let progressCb: ((event: ExportProgressEvent) => void) | null
  // Every listener the app has for archive progress, minus those it has stopped, so a step
  // reaches only these, as it would in the app.
  const archiveListeners = new Set<(event: ArchiveProgressEvent) => void>()
  const onArchiveProgress = (cb: (event: ArchiveProgressEvent) => void) => {
    archiveListeners.add(cb)
    return () => archiveListeners.delete(cb)
  }
  function sendArchiveProgress(event: ArchiveProgressEvent) {
    act(() => archiveListeners.forEach((listener) => listener(event)))
  }

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
    listCasePins = vi.fn().mockResolvedValue([])
    exportArchive = vi.fn().mockResolvedValue({
      canceled: false,
      filePath: ARCHIVE_PATH
    } satisfies ArchiveExportResult)
    archiveListeners.clear()
    // A Case Archive export and its failure outlive the dialog, so each test starts with none.
    useCaseExports.setState({ pending: {}, failed: {} })
    fakeBridge({
      export: { preflight, generateReport },
      cases: { get: getCase, exportArchive },
      shell: { showItemInFolder, openPath },
      wayback: { listForCase: listCasePins },
      onExportProgress,
      onArchiveProgress
    })
  })

  afterEach(() => {
    cleanup()
    notifySuccess.mockReset()
    notifyError.mockReset()
  })

  // Pinned Wayback references (#401): corroboration the package's report will
  // carry, stated before the operator exports rather than discovered in the
  // document afterwards.
  const PINS = [
    {
      id: 'ref-1',
      captureId: 'cap-1',
      snapshotTimestamp: '2026-07-01T09:30:00.000Z',
      snapshotUrl: 'https://web.archive.org/web/20260701093000/https://example.com/',
      originalUrl: 'https://example.com/',
      checkedAt: '2026-08-01T00:00:00.000Z',
      pinnedAt: '2026-08-01T00:01:00.000Z',
      captureTimestamp: '2026-07-03T09:30:00.000Z'
    },
    {
      id: 'ref-2',
      captureId: 'cap-2',
      snapshotTimestamp: '2026-06-01T09:30:00.000Z',
      snapshotUrl: 'https://web.archive.org/web/20260601093000/https://example.com/b',
      originalUrl: 'https://example.com/b',
      checkedAt: '2026-08-01T00:00:00.000Z',
      pinnedAt: '2026-08-01T00:01:00.000Z',
      captureTimestamp: '2026-06-01T09:30:00.000Z'
    }
  ]

  it('unpins only the right-clicked reference and refreshes the export list', async () => {
    listCasePins.mockResolvedValue(PINS)
    const unpin = vi.fn(async () => {
      listCasePins.mockResolvedValue([PINS[0]])
      return true
    })
    fakeBridge({
      export: { preflight, generateReport },
      cases: { get: getCase },
      wayback: { listForCase: listCasePins, unpin },
      onExportProgress
    })
    const onClose = vi.fn()
    renderDialog(onClose)
    const rows = await screen.findAllByTestId('export-pinned-wayback-row')
    fireEvent.contextMenu(rows[1])
    const menu = await screen.findByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
    ).toEqual(['Unpin from case', 'Customise this menu…'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Unpin from case' }))
    await waitFor(() => expect(unpin).toHaveBeenCalledWith('ref-2'))
    await waitFor(() => expect(screen.getAllByTestId('export-pinned-wayback-row')).toHaveLength(1))
    expect(screen.getByTestId('export-pinned-wayback-row').textContent).toContain('2026-07-01')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('lists the pinned Wayback snapshots the report will carry', async () => {
    listCasePins.mockResolvedValue(PINS)
    renderDialog()

    const block = await screen.findByTestId('export-pinned-wayback')
    expect(within(block).getAllByTestId('export-pinned-wayback-row')).toHaveLength(2)
    expect(block.textContent).toContain('2026-07-01 09:30 UTC')
    expect(block.textContent).toContain('2d before capture')
    // The boundary, stated in the dialog: a pin is a reference, not content.
    expect(block.textContent).toContain(
      'Listed as archive.org references. Snapshots are not packaged.'
    )
  })

  it('shows only the pins belonging to a scoped selection', async () => {
    listCasePins.mockResolvedValue(PINS)
    renderDialog(vi.fn(), ['cap-2'])

    const block = await screen.findByTestId('export-pinned-wayback')
    const rows = within(block).getAllByTestId('export-pinned-wayback-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('2026-06-01 09:30 UTC')
  })

  it('drops the pinned-snapshot block under Working Copy — there is no report', async () => {
    listCasePins.mockResolvedValue(PINS)
    renderDialog()

    await screen.findByTestId('export-pinned-wayback')
    fireEvent.click(screen.getByLabelText(WORKING))

    // The pins are unchanged; what changed is that this class carries no report
    // for them to be "included in", so the promise must not be on screen.
    expect(screen.queryByTestId('export-pinned-wayback')).toBeNull()
    expect(screen.getByRole<HTMLInputElement>('radio', { name: WORKING }).checked).toBe(true)

    fireEvent.click(screen.getByLabelText(EVIDENCE))
    expect(await screen.findByTestId('export-pinned-wayback')).toBeDefined()
  })

  it('renders no pinned-snapshot block when the case has none', async () => {
    renderDialog()

    await screen.findByTestId('export-scope-row')
    expect(screen.queryByTestId('export-pinned-wayback')).toBeNull()
  })

  it('shows the un-stamped capture warning before export', async () => {
    renderDialog()

    expect((await screen.findByTestId('export-trusted-time-notice')).textContent).toBe(
      '2 Captures will export without RFC 3161 trusted time (1 pending, 1 none).'
    )
    expect(preflight).toHaveBeenCalledWith('case-1', undefined)
  })

  it('exports the Evidence Package preset by default', async () => {
    renderDialog()

    fireEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    const options = lastOptions(generateReport)
    expect(options.format).toBe('zip')
    expect(options.exportClass).toBe('evidence')
    expect(options.outputPath).toBe('Case One_evidence.zip')
    // The class and all five include toggles decide what lands in the package.
    expect(lastSelection(generateReport)).toEqual(FULL_SELECTION)
    // Whole-case export: no selection scope key at all, never [].
    expect('captureIds' in options).toBe(false)
  })

  // AC 1: presets map to the decided classes.
  it('maps the Working Copy preset to the working-copy class and a marked filename', async () => {
    renderDialog()

    fireEvent.click(screen.getByLabelText(WORKING))
    fireEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    const options = lastOptions(generateReport)
    expect(lastSelection(generateReport)).toEqual(WORKING_SELECTION)
    expect(options.outputPath).toBe('Case One_working_copy.zip')
  })

  // The checkbox stands where a third preset stood, so it has to submit that preset's
  // selection and leave the Evidence Package the chosen choice.
  it('leaves Operator notes out of an Evidence Package from its checkbox', async () => {
    renderDialog()

    const leaveOut = screen.getByRole<HTMLInputElement>('checkbox', {
      name: 'Leave out Operator notes'
    })
    expect(leaveOut.checked).toBe(false)
    fireEvent.click(leaveOut)

    expect(leaveOut.checked).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: EVIDENCE }).checked).toBe(true)
    expect(screen.getByText('Customise contents')).toBeDefined()
    fireEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    expect(lastSelection(generateReport)).toEqual(WITHOUT_NOTES_SELECTION)
    expect(lastOptions(generateReport).outputPath).toBe('Case One_evidence.zip')
  })

  it('offers the checkbox under the Evidence Package only while it is the chosen choice', () => {
    renderDialog()

    fireEvent.click(screen.getByLabelText(WORKING))
    expect(screen.queryByRole('checkbox', { name: 'Leave out Operator notes' })).toBeNull()

    fireEvent.click(screen.getByLabelText(EVIDENCE))
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Leave out Operator notes' }).checked
    ).toBe(false)
  })

  // The same item from the checklist, so the two controls cannot disagree.
  it('ticks the checkbox when Operator notes are unticked in the checklist', () => {
    renderDialog()

    fireEvent.click(screen.getByText('Customise contents'))
    fireEvent.click(screen.getByLabelText('Operator notes'))

    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Leave out Operator notes' }).checked
    ).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: EVIDENCE }).checked).toBe(true)
    expect(screen.queryByText('Custom selection')).toBeNull()
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
    const manifest = screen.getByLabelText('Manifest (always the full chain)') as HTMLInputElement
    const certification = screen.getByLabelText('Certification') as HTMLInputElement
    for (const invariant of [manifest, certification]) {
      expect(invariant.checked).toBe(true)
      expect(invariant.disabled).toBe(true)
      fireEvent.click(invariant)
      expect(invariant.checked).toBe(true)
    }
    // Still the Evidence Package preset: clicking the invariants changed nothing.
    expect(screen.getByText('Customise contents')).toBeDefined()
  })

  // #844: the evidence zip ships every page archive whatever the toggle says,
  // so the evidence class offers no unchecked state for the zip to contradict.
  it('renders Captures always-on in an evidence package and says why', async () => {
    renderDialog()

    fireEvent.click(screen.getByText('Customise contents'))
    const captures = screen.getByLabelText('Captures (page archives)') as HTMLInputElement
    expect(captures.checked).toBe(true)
    expect(captures.disabled).toBe(true)
    fireEvent.click(captures)
    expect(captures.checked).toBe(true)
    expect(screen.getByTestId('export-captures-invariant-note').textContent).toBe(
      'Always in an Evidence Package'
    )

    fireEvent.click(screen.getByText('Export'))
    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    expect(lastOptions(generateReport).include.captures).toBe(true)
  })

  // #887: the pinned-snapshot notice promises references that render inside
  // the exhibit modules, which drop out when captures are excluded. A custom
  // evidence export must therefore never reach the report with captures off.
  it('keeps the pinned-snapshot promise true in a custom evidence export', async () => {
    listCasePins.mockResolvedValue(PINS)
    renderDialog()

    await screen.findByTestId('export-pinned-wayback')
    fireEvent.click(screen.getByText('Customise contents'))
    for (const item of ['Screenshots', 'Operator notes', 'Integrity verification']) {
      fireEvent.click(screen.getByLabelText(item))
    }
    fireEvent.click(screen.getByLabelText('Captures (page archives)'))
    expect(screen.getByText('Custom selection')).toBeDefined()

    expect(screen.getByTestId('export-pinned-wayback').textContent).toContain(
      'Listed as archive.org references'
    )
    fireEvent.click(screen.getByText('Export'))
    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    const options = lastOptions(generateReport)
    expect(options.exportClass).toBe('evidence')
    expect(options.include.captures).toBe(true)
  })

  // #887: a Working Copy may drop its page archives, and switching class from
  // there must not carry the unchecked box into the evidence package.
  it('does not carry an unchecked Captures from a Working Copy into an evidence package', async () => {
    listCasePins.mockResolvedValue(PINS)
    renderDialog()

    await screen.findByTestId('export-pinned-wayback')
    fireEvent.click(screen.getByLabelText(WORKING))
    fireEvent.click(screen.getByText('Customise contents'))
    const wcCaptures = screen.getByLabelText('Captures (page archives)') as HTMLInputElement
    expect(wcCaptures.disabled).toBe(false)
    fireEvent.click(wcCaptures)
    expect(wcCaptures.checked).toBe(false)
    expect(screen.queryByTestId('export-captures-invariant-note')).toBeNull()
    expect(screen.queryByTestId('export-pinned-wayback')).toBeNull()

    fireEvent.click(screen.getByLabelText(EVIDENCE))
    const captures = screen.getByLabelText('Captures (page archives)') as HTMLInputElement
    expect(captures.checked).toBe(true)
    expect(captures.disabled).toBe(true)
    expect(screen.getByTestId('export-pinned-wayback')).toBeDefined()

    fireEvent.click(screen.getByText('Export'))
    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    expect(lastOptions(generateReport).include.captures).toBe(true)
  })

  it('lets a Working Copy export leave its page archives out', async () => {
    renderDialog()

    fireEvent.click(screen.getByLabelText(WORKING))
    fireEvent.click(screen.getByText('Customise contents'))
    fireEvent.click(screen.getByLabelText('Captures (page archives)'))
    expect(screen.getByText('Custom selection')).toBeDefined()

    fireEvent.click(screen.getByText('Export'))
    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    const options = lastOptions(generateReport)
    expect(options.exportClass).toBe('working-copy')
    expect(options.include.captures).toBe(false)
  })

  // Each class is described once, under its name. ADR-0010 has the Working Copy's label carry
  // the weight, so its line says what a recipient cannot do with one.
  it('describes each choice once, under its name, with its file type', () => {
    renderDialog()

    const choices = within(screen.getByRole('radiogroup', { name: 'Export as' }))
      .getAllByRole('radio')
      .map((radio) => radio.closest('label')?.textContent)
    expect(choices).toEqual([
      'Evidence Package.zipFor handing over. A recipient can check its integrity.',
      'Working Copy.zipFor your own use. No Certification, and a recipient cannot check it.',
      'Case Archive.birdbrainThe whole Case, to import into another installation.'
    ])
    for (const choice of [EVIDENCE, WORKING, ARCHIVE]) {
      fireEvent.click(screen.getByLabelText(choice))
      expect(screen.queryByTestId('export-custody-card')).toBeNull()
      expect(screen.queryByTestId('export-working-copy-notice')).toBeNull()
    }
  })

  it('offers a Working Copy no Certification and no verification row', () => {
    renderDialog()

    fireEvent.click(screen.getByLabelText(WORKING))
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

    expect((await screen.findByTestId('export-demo-notice')).textContent).toBe(
      'Demonstration Case: fixture data, not evidence. The package says so.'
    )

    cleanup()
    getCase.mockResolvedValue(CASE)
    renderDialog()
    await screen.findByTestId('export-trusted-time-notice')
    expect(screen.queryByTestId('export-demo-notice')).toBeNull()
  })

  it('states the whole-case scope from the preflight count', async () => {
    renderDialog()

    await waitFor(() =>
      expect(screen.getByTestId('export-scope-row').textContent).toBe('Whole Case · 3 Captures')
    )
    expect(screen.getByRole('heading', { name: 'Export Case One' })).toBeDefined()
  })

  it('states a selection scope, the manifest note, and passes captureIds through', async () => {
    renderDialog(vi.fn(), ['cap-1', 'cap-2'])

    expect(screen.getByRole('heading', { name: 'Export 2 Captures' })).toBeDefined()
    expect(screen.getByTestId('export-scope-row').textContent).toBe('Selection from Case One')
    expect(screen.getByTestId('export-scope-manifest-note').textContent).toBe(
      'The full Manifest chain is included.'
    )

    fireEvent.click(screen.getByText('Export'))
    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    expect(lastOptions(generateReport).captureIds).toEqual(['cap-1', 'cap-2'])
  })

  // A Working Copy ships no Manifest, so the chain note would be untrue of one.
  it('drops the manifest note for a Working Copy selection export', () => {
    renderDialog(vi.fn(), ['cap-1'])
    expect(screen.getByTestId('export-scope-manifest-note')).toBeDefined()
    fireEvent.click(screen.getByLabelText(WORKING))

    expect(screen.getByRole('heading', { name: 'Export 1 Capture' })).toBeDefined()
    expect(screen.getByTestId('export-scope-row').textContent).toBe('Selection from Case One')
    expect(screen.queryByTestId('export-scope-manifest-note')).toBeNull()
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

  // The mock's completion (Birdbrain.dc.html 6160): the dialog closes and a
  // toast names what was written and where, in place of an in-dialog panel.
  it('closes and raises an Export written toast naming the class and path', async () => {
    const onClose = vi.fn()
    renderDialog(onClose)

    fireEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(notifySuccess).toHaveBeenCalledOnce())
    const [title, opts] = notifySuccess.mock.calls[0]
    expect(title).toBe('Export written')
    expect(opts.description).toBe('Evidence Package · Case_One_evidence.zip')
    expect(opts.action.label).toBe('Show in folder')
    expect(onClose).toHaveBeenCalledOnce()
    // Held on the progress view while the dialog animates out, never the form.
    expect(screen.getByText('Exporting Case One')).toBeDefined()
    expect(screen.queryByTestId('export-submit')).toBeNull()

    opts.action.onClick()
    expect(showItemInFolder).toHaveBeenCalledWith('Case_One_evidence.zip')
    expect(openPath).not.toHaveBeenCalled()
  })

  it('names a Working Copy as such in the toast', async () => {
    generateReport.mockResolvedValue({
      canceled: false,
      filePath: '/out/Case_One_working_copy.zip'
    })
    renderDialog()

    fireEvent.click(screen.getByLabelText(WORKING))
    fireEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(notifySuccess).toHaveBeenCalledOnce())
    const [title, opts] = notifySuccess.mock.calls[0]
    expect(title).toBe('Export written')
    expect(opts.description).toBe('Working Copy · /out/Case_One_working_copy.zip')
    expect(opts.action.label).toBe('Show in folder')
    opts.action.onClick()
    expect(showItemInFolder).toHaveBeenCalledWith('/out/Case_One_working_copy.zip')
  })

  it('reports a failed reveal from the toast action instead of dropping it', async () => {
    showItemInFolder.mockRejectedValue(new Error('no such directory'))
    renderDialog()

    fireEvent.click(screen.getByText('Export'))
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledOnce())
    notifySuccess.mock.calls[0][1].action.onClick()

    await waitFor(() => expect(notifyError).toHaveBeenCalledOnce())
    expect(notifyError.mock.calls[0][0]).toBe("Couldn't show the file in its folder.")
  })

  // UI pass finding: Close mid-run left the export going with no completion
  // signal at all. The dialog now says the run continues, and the toast still
  // arrives after the dialog has unmounted.
  it('still raises the toast when the dialog was closed mid-run', async () => {
    const gate = deferred<ExportResult>()
    generateReport.mockReturnValue(gate.promise)
    const onClose = vi.fn()
    const { unmount } = renderDialog(onClose)

    fireEvent.click(screen.getByText('Export'))
    expect((await screen.findByTestId('export-close-note')).textContent).toBe(
      'The export continues if you close this.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
    unmount()

    await act(async () => {
      gate.resolve({ canceled: false, filePath: 'Case_One_evidence.zip' })
    })

    await waitFor(() => expect(notifySuccess).toHaveBeenCalledOnce())
    expect(notifySuccess.mock.calls[0][0]).toBe('Export written')
    expect(onClose).toHaveBeenCalledOnce()
  })

  // Review finding on #1578: both parents pass a plain setter, so a first run
  // finishing after Close used to close the window the operator had reopened.
  it('leaves a reopened dialog open when the earlier export finishes', async () => {
    const gate = deferred<ExportResult>()
    generateReport.mockReturnValueOnce(gate.promise)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    function Host() {
      const [open, setOpen] = useState(true)
      return (
        <QueryClientProvider client={client}>
          <button onClick={() => setOpen(true)}>Reopen</button>
          {open && (
            <ExportDialog caseId="case-1" caseName="Case One" onClose={() => setOpen(false)} />
          )}
        </QueryClientProvider>
      )
    }
    render(<Host />)

    fireEvent.click(screen.getByText('Export'))
    await screen.findByTestId('export-close-note')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Exporting Case One')).toBeNull()
    fireEvent.click(screen.getByText('Reopen'))
    expect(await screen.findByText('Export Case One')).toBeDefined()

    await act(async () => {
      gate.resolve({ canceled: false, filePath: 'Case_One_evidence.zip' })
    })

    await waitFor(() => expect(notifySuccess).toHaveBeenCalledOnce())
    expect(screen.getByText('Export Case One')).toBeDefined()
  })

  it('returns to the form when the save dialog is canceled (no false success)', async () => {
    generateReport.mockResolvedValue({ canceled: true } satisfies ExportResult)
    const onClose = vi.fn()
    renderDialog(onClose)

    fireEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('Export')).toBeDefined())
    expect(notifySuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('surfaces an error and offers retry', async () => {
    generateReport.mockRejectedValueOnce(new Error('disk full'))
    renderDialog()

    fireEvent.click(screen.getByText('Export'))

    expect(await screen.findByText(/disk full/)).toBeDefined()
    expect(screen.getByText('Try again')).toBeDefined()
    expect(notifySuccess).not.toHaveBeenCalled()
  })

  describe('Case Archive', () => {
    function chooseArchive() {
      fireEvent.click(screen.getByLabelText(ARCHIVE))
    }

    it('hides the contents, the purpose field and the Trusted Time notice, which do not apply', async () => {
      listCasePins.mockResolvedValue(PINS)
      renderDialog()
      await screen.findByTestId('export-trusted-time-notice')
      await screen.findByTestId('export-pinned-wayback')
      expect(screen.getByText('Customise contents')).toBeDefined()
      expect(screen.getByPlaceholderText(/Disclosure under/)).toBeDefined()

      chooseArchive()

      expect(screen.getByRole<HTMLInputElement>('radio', { name: ARCHIVE }).checked).toBe(true)
      expect(screen.getByRole<HTMLInputElement>('radio', { name: EVIDENCE }).checked).toBe(false)
      expect(screen.queryByText('Customise contents')).toBeNull()
      expect(screen.queryByPlaceholderText(/Disclosure under/)).toBeNull()
      expect(screen.queryByTestId('export-trusted-time-notice')).toBeNull()
      expect(screen.queryByTestId('export-pinned-wayback')).toBeNull()
      expect(screen.queryByRole('checkbox')).toBeNull()

      fireEvent.click(screen.getByLabelText(EVIDENCE))
      expect(screen.getByText('Customise contents')).toBeDefined()
      expect(screen.getByTestId('export-trusted-time-notice')).toBeDefined()
    })

    it('exports the Case Archive, raises its notice and closes', async () => {
      const onClose = vi.fn()
      renderDialog(onClose)
      chooseArchive()

      fireEvent.click(screen.getByTestId('export-submit'))

      await waitFor(() => expect(notifySuccess).toHaveBeenCalledOnce())
      expect(exportArchive).toHaveBeenCalledWith('case-1')
      expect(generateReport).not.toHaveBeenCalled()
      const [title, opts] = notifySuccess.mock.calls[0]
      expect(title).toBe('Case Archive saved')
      expect(opts.description).toBe(ARCHIVE_PATH)
      await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
      // Held on the progress view while the dialog animates out, never the form.
      expect(screen.getByText('Exporting Case One')).toBeDefined()
      expect(screen.queryByTestId('export-submit')).toBeNull()
      expect(archiveListeners.size).toBe(0)
    })

    it('shows the archive export step by step, for its own Case only', async () => {
      const gate = deferred<ArchiveExportResult>()
      exportArchive.mockReturnValue(gate.promise)
      renderDialog()
      chooseArchive()

      fireEvent.click(screen.getByTestId('export-submit'))

      expect(await screen.findByText('Preparing archive…')).toBeDefined()
      expect(screen.getByTestId('export-close-note').textContent).toBe(
        'The export continues if you close this.'
      )
      sendArchiveProgress({ caseId: 'case-1', step: 'Bundling captures...', percent: 55 })
      expect(screen.getByText('Bundling captures...')).toBeDefined()
      expect(screen.getByText('55%')).toBeDefined()
      sendArchiveProgress({ caseId: 'other-case', step: 'Should not show', percent: 99 })
      expect(screen.queryByText('Should not show')).toBeNull()

      await act(async () => gate.resolve({ canceled: false, filePath: ARCHIVE_PATH }))
    })

    it('returns to the form when the save dialog is cancelled', async () => {
      exportArchive.mockResolvedValue({ canceled: true } satisfies ArchiveExportResult)
      const onClose = vi.fn()
      renderDialog(onClose)
      chooseArchive()

      fireEvent.click(screen.getByTestId('export-submit'))

      await waitFor(() => expect(exportArchive).toHaveBeenCalledOnce())
      expect((await screen.findByTestId('export-submit')).textContent).toBe('Export')
      expect(screen.getByRole<HTMLInputElement>('radio', { name: ARCHIVE }).checked).toBe(true)
      expect(notifySuccess).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.queryByTestId('export-error')).toBeNull()
    })

    it('shows a failure in the dialog, keeps it for the Case, and clears it on a retry', async () => {
      exportArchive.mockRejectedValueOnce(new Error('disk full'))
      const onClose = vi.fn()
      renderDialog(onClose)
      chooseArchive()

      fireEvent.click(screen.getByTestId('export-submit'))

      expect((await screen.findByTestId('export-error')).textContent).toBe('Error: disk full')
      expect(screen.getByTestId('export-submit').textContent).toBe('Try again')
      expect(onClose).not.toHaveBeenCalled()
      expect(notifySuccess).not.toHaveBeenCalled()
      // Kept outside the dialog, where the Case menu shows it until it is dismissed.
      expect(useCaseExports.getState().failed).toEqual({ 'case-1': 'disk full' })
      // It is the archive's failure, so it does not show against another choice.
      fireEvent.click(screen.getByLabelText(EVIDENCE))
      expect(screen.queryByTestId('export-error')).toBeNull()
      expect(screen.getByTestId('export-submit').textContent).toBe('Export')

      chooseArchive()
      fireEvent.click(screen.getByTestId('export-submit'))

      await waitFor(() => expect(notifySuccess).toHaveBeenCalledOnce())
      expect(useCaseExports.getState().failed).toEqual({})
      await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    })

    it('keeps exporting, and still raises the notice, after the dialog is closed', async () => {
      const gate = deferred<ArchiveExportResult>()
      exportArchive.mockReturnValue(gate.promise)
      const onClose = vi.fn()
      const { unmount } = renderDialog(onClose)
      chooseArchive()
      fireEvent.click(screen.getByTestId('export-submit'))
      await screen.findByTestId('export-close-note')

      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      expect(onClose).toHaveBeenCalledOnce()
      unmount()
      // The run and its listener belong to the Case, so both are still there.
      expect(useCaseExports.getState().pending['case-1']).toBeDefined()
      expect(archiveListeners.size).toBe(1)
      sendArchiveProgress({ caseId: 'case-1', step: 'Bundling captures...', percent: 55 })
      expect(useCaseExports.getState().pending['case-1']).toEqual({
        step: 'Bundling captures...',
        percent: 55
      })

      await act(async () => gate.resolve({ canceled: false, filePath: ARCHIVE_PATH }))

      await waitFor(() => expect(notifySuccess).toHaveBeenCalledOnce())
      expect(notifySuccess.mock.calls[0][0]).toBe('Case Archive saved')
      expect(useCaseExports.getState().pending).toEqual({})
      expect(archiveListeners.size).toBe(0)
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('keeps a failure for the Case when the dialog was closed before it failed', async () => {
      const gate = deferred<ArchiveExportResult>()
      exportArchive.mockReturnValue(gate.promise)
      const { unmount } = renderDialog()
      chooseArchive()
      fireEvent.click(screen.getByTestId('export-submit'))
      await screen.findByTestId('export-close-note')
      unmount()

      await act(async () => gate.reject(new Error('disk full')))

      await waitFor(() =>
        expect(useCaseExports.getState().failed).toEqual({ 'case-1': 'disk full' })
      )
      expect(useCaseExports.getState().pending).toEqual({})
    })

    // An export still running for the Case shows when the choice is made again, so a second
    // cannot start beside it. The other choices are free to export meanwhile.
    it('shows a Case Archive export already running for the Case in place of a second start', () => {
      useCaseExports.setState({
        pending: { 'case-1': { step: 'Bundling captures...', percent: 55 } },
        failed: {}
      })
      renderDialog()
      expect(screen.getByTestId('export-submit')).toBeDefined()

      chooseArchive()

      expect(screen.getByText('Bundling captures...')).toBeDefined()
      expect(screen.getByText('55%')).toBeDefined()
      expect(screen.queryByTestId('export-submit')).toBeNull()
      expect(exportArchive).not.toHaveBeenCalled()
    })

    // A Case Archive holds the whole Case, so a selection cannot be exported as one.
    it('is disabled for a selection, with the reason under its name', () => {
      renderDialog(vi.fn(), ['cap-1', 'cap-2'])

      const radio = screen.getByRole<HTMLInputElement>('radio', { name: ARCHIVE })
      expect(radio.disabled).toBe(true)
      const reason = document.getElementById(radio.getAttribute('aria-describedby') ?? '')
      expect(reason?.textContent).toBe('For the whole Case only. Not available for a selection.')
      expect(radio.checked).toBe(false)
      expect(screen.getByRole<HTMLInputElement>('radio', { name: EVIDENCE }).checked).toBe(true)
      expect(screen.getByRole<HTMLInputElement>('radio', { name: WORKING }).disabled).toBe(false)
    })
  })

  // jsdom lays nothing out, so these read the structure: which element scrolls, and what
  // sits outside it. `e2e/export.spec.ts` checks the rendered result at 1440 by 900.
  describe('layout', () => {
    function scrollingAncestor(el: HTMLElement): HTMLElement | null {
      const dialog = screen.getByRole('dialog')
      for (let node = el.parentElement; node && dialog.contains(node); node = node.parentElement) {
        if (/(^|\s)overflow-(y-)?(auto|scroll)(\s|$)/.test(node.getAttribute('class') ?? '')) {
          return node
        }
      }
      return null
    }

    it('scrolls the form and keeps the heading and the footer outside it', () => {
      renderDialog()

      expect(scrollingAncestor(screen.getByRole('radiogroup'))).not.toBeNull()
      expect(scrollingAncestor(screen.getByPlaceholderText(/Disclosure under/))).not.toBeNull()
      expect(scrollingAncestor(screen.getByRole('heading', { name: 'Export Case One' }))).toBeNull()
      expect(scrollingAncestor(screen.getByTestId('export-scope-row'))).toBeNull()
      expect(
        scrollingAncestor(screen.getByText('The export continues if you close this.'))
      ).toBeNull()
      expect(scrollingAncestor(screen.getByRole('button', { name: 'Cancel' }))).toBeNull()
      expect(scrollingAncestor(screen.getByTestId('export-submit'))).toBeNull()
    })

    it('shows a failure beside the retry button, outside the form that scrolls', async () => {
      generateReport.mockRejectedValueOnce(new Error('disk full'))
      renderDialog()

      fireEvent.click(screen.getByTestId('export-submit'))

      const failure = await screen.findByTestId('export-error')
      expect(failure.textContent).toBe('Error: disk full')
      expect(scrollingAncestor(failure)).toBeNull()
    })

    it('draws each notice as an icon and text in its tier colour, with no filled box', async () => {
      getCase.mockResolvedValue({ ...CASE, isDemo: true })
      generateReport.mockRejectedValueOnce(new Error('disk full'))
      renderDialog()
      await screen.findByTestId('export-demo-notice')
      await screen.findByTestId('export-trusted-time-notice')
      fireEvent.click(screen.getByTestId('export-submit'))
      await screen.findByTestId('export-error')

      const tiers = {
        'export-demo-notice': 'text-danger-fg',
        'export-error': 'text-danger-fg',
        'export-trusted-time-notice': 'text-warning-fg'
      }
      for (const [testId, colour] of Object.entries(tiers)) {
        const notice = screen.getByTestId(testId)
        const classes = (notice.getAttribute('class') ?? '').split(/\s+/)
        expect(classes, testId).toContain(colour)
        expect(
          classes.filter((name) => /^(bg-|border)|-surface$/.test(name)),
          testId
        ).toEqual([])
        expect(notice.querySelector('svg'), testId).not.toBeNull()
      }
    })
  })

  // Focus, Tab and Escape only (#1536). The known answers are the export
  // options: walking the dialog by keyboard must leave them what the preset
  // table says.
  describe('keyboard', () => {
    // Starts with one Tab off the panel, where the dialog opens: the panel
    // itself is not a stop, so the walk would never wrap back to it.
    function tabStops(): HTMLElement[] {
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab' })
      const stops: HTMLElement[] = [document.activeElement as HTMLElement]
      for (let i = 0; i < 10; i++) {
        fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab' })
        if (document.activeElement === stops[0]) break
        stops.push(document.activeElement as HTMLElement)
      }
      return stops
    }

    it('is a modal dialog with a name for every phase', () => {
      renderDialog()

      const dialog = screen.getByRole('dialog', { name: 'Export Case One' })
      expect(dialog.getAttribute('aria-modal')).toBe('true')
    })

    // Not onto the checked preset radio, its first control: an arrow key
    // there switches the export to a Working Copy.
    it('moves focus onto the panel when it opens, with the preset group one Tab away', () => {
      renderDialog()

      expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Export Case One' }))
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab' })
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: EVIDENCE }))
    })

    it('walks its own six controls and wraps, with the choices as one stop', () => {
      renderDialog()

      const stops = tabStops()

      const label = (el: HTMLElement) =>
        el.tagName === 'INPUT' ? el.getAttribute('type') : el.textContent
      expect(stops.map(label)).toEqual([
        'radio',
        'checkbox',
        'Customise contents',
        'text',
        'Cancel',
        'Export'
      ])
      expect(document.activeElement).toBe(stops[0])
    })

    it('closes on Escape without exporting', () => {
      const onClose = vi.fn()
      renderDialog(onClose)

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(generateReport).not.toHaveBeenCalled()
    })

    it('leaves the export options at the preset after a full keyboard walk', async () => {
      renderDialog()
      tabStops()
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab', shiftKey: true })

      fireEvent.click(screen.getByTestId('export-submit'))

      await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
      const options = lastOptions(generateReport)
      expect(lastSelection(generateReport)).toEqual(FULL_SELECTION)
      expect(options.purposeOrAuthority).toBeUndefined()
    })

    // The Export button unmounts when the progress phase replaces the form, so
    // focus falls to the body with the dialog still up.
    it('brings Tab back into the dialog after the form gives way to progress', async () => {
      const gate = deferred<ExportResult>()
      generateReport.mockReturnValue(gate.promise)
      renderDialog()
      screen.getByTestId('export-submit').focus()

      fireEvent.click(screen.getByTestId('export-submit'))
      await screen.findByText('Exporting Case One')
      expect(document.activeElement).toBe(document.body)

      fireEvent.keyDown(document.body, { key: 'Tab' })

      expect(document.activeElement).toBe(screen.getByText('Close'))
      gate.resolve({ canceled: false, filePath: 'Case_One_evidence.zip' })
    })

    // In the export menu the dialog sits in an AnimatePresence, which keeps it
    // mounted through the exit. Focus and Escape go when the exit starts.
    it('hands focus back and lets go of Escape once its exit starts', () => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
      })
      const onClose = vi.fn()
      function Host({ open }: { open: boolean }) {
        return (
          <QueryClientProvider client={client}>
            <button data-testid="opener">Export</button>
            {open && <ExportDialog caseId="case-1" caseName="Case One" onClose={onClose} />}
          </QueryClientProvider>
        )
      }
      const { rerender } = render(<Host open={false} />)
      const opener = screen.getByTestId('opener')
      opener.focus()
      rerender(<Host open />)
      expect(document.activeElement).not.toBe(opener)

      try {
        presence.present = false
        rerender(<Host open />)

        expect(screen.getByRole('dialog', { name: 'Export Case One' })).toBeTruthy()
        expect(document.activeElement).toBe(opener)
        fireEvent.keyDown(window, { key: 'Escape' })
        expect(onClose).not.toHaveBeenCalled()
      } finally {
        presence.present = true
      }
    })

    it('hands focus back to the opener when the parent unmounts it', () => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
      })
      function Host({ open }: { open: boolean }) {
        return (
          <QueryClientProvider client={client}>
            <button data-testid="opener">Export</button>
            {open && <ExportDialog caseId="case-1" caseName="Case One" onClose={vi.fn()} />}
          </QueryClientProvider>
        )
      }
      const { rerender } = render(<Host open={false} />)
      const opener = screen.getByTestId('opener')
      opener.focus()
      rerender(<Host open />)
      expect(document.activeElement).not.toBe(opener)

      rerender(<Host open={false} />)

      expect(document.activeElement).toBe(opener)
    })
  })
})

// The table behind the two zip choices, pinned value by value against the literal copies, so a
// drive-by edit to it shows up as a failed known answer, not a silently different package.
describe('EXPORT_PRESETS / detectPreset', () => {
  it('pins the two zip choices to the selections they have always submitted', () => {
    expect(Object.keys(EXPORT_PRESETS)).toEqual(['full', 'working'])
    expect(EXPORT_PRESETS.full.selection).toEqual(FULL_SELECTION)
    expect(EXPORT_PRESETS.working.selection).toEqual(WORKING_SELECTION)
  })

  it('reads an Evidence Package with or without Operator notes as the same choice', () => {
    expect(detectPreset(FULL_SELECTION)).toBe('full')
    expect(detectPreset(WITHOUT_NOTES_SELECTION)).toBe('full')
    expect(detectPreset(WORKING_SELECTION)).toBe('working')
  })

  it('reads any other selection as custom', () => {
    expect(
      detectPreset({
        ...FULL_SELECTION,
        include: { ...FULL_SELECTION.include, screenshots: false }
      })
    ).toBe('custom')
    expect(
      detectPreset({
        ...WITHOUT_NOTES_SELECTION,
        include: { ...WITHOUT_NOTES_SELECTION.include, annotations: 'none' }
      })
    ).toBe('custom')
    // Operator notes are the Evidence Package's own checkbox, not the Working Copy's.
    expect(
      detectPreset({
        ...WORKING_SELECTION,
        include: { ...WORKING_SELECTION.include, notes: false }
      })
    ).toBe('custom')
    // The class takes part: the Evidence Package's items under the other class match neither.
    expect(detectPreset({ exportClass: 'working-copy', include: FULL_SELECTION.include })).toBe(
      'custom'
    )
  })
})
