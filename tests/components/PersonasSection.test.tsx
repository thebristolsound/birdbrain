// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Persona, PersonaImportResult } from '@shared/types'
import { PersonasSection } from '@renderer/components/settings/PersonasSection'
import { fakeBridge } from '../renderer/fakeBridge'

const persona: Persona = {
  id: 'p-1',
  label: 'Research account',
  notes: '',
  createdAt: '2026-09-20T10:00:00.000Z',
  lastImportAt: null,
  lastImportCount: null
}

let list: ReturnType<typeof vi.fn>
let create: ReturnType<typeof vi.fn>
let update: ReturnType<typeof vi.fn>
let remove: ReturnType<typeof vi.fn>
let importCookies: ReturnType<typeof vi.fn>
let storageState: ReturnType<typeof vi.fn>

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<PersonasSection />, { wrapper: Wrapper })
}

function bridge(personas: Persona[], encryptionAvailable = true) {
  list = vi.fn(async () => personas)
  create = vi.fn(async (params: { label: string }) => ({ ...persona, id: 'p-new', ...params }))
  update = vi.fn(async (params: { id: string; label?: string }) => ({ ...persona, ...params }))
  remove = vi.fn(async () => true)
  importCookies = vi.fn(async (): Promise<PersonaImportResult | null> => null)
  storageState = vi.fn(async () => ({ encryptionAvailable }))
  fakeBridge({
    persona: { list, create, update, delete: remove, import: importCookies, storageState }
  })
}

beforeEach(() => bridge([]))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PersonasSection empty state', () => {
  // Decision 2 and 10 (ADR-0030): the term is Persona, framed as a signed-in
  // browser identity, and nothing exists until the operator adds one.
  it('frames a persona as a signed-in browser identity and offers one button', async () => {
    renderSection()
    await screen.findByTestId('personas-empty')
    expect(screen.getByText(/a signed-in browser identity, yours or a pseudonym/)).toBeTruthy()
    expect(screen.getByText(/passwords are never\s+stored/)).toBeTruthy()
    expect(screen.getAllByTestId('persona-add')).toHaveLength(1)
    expect(screen.queryByTestId('personas-list')).toBeNull()
  })

  it('creates a persona from the label form and hides the form afterwards', async () => {
    renderSection()
    fireEvent.click(await screen.findByTestId('persona-add'))
    const input = screen.getByTestId('persona-new-label')
    expect((screen.getByTestId('persona-create') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '  Sock puppet ' } })
    fireEvent.click(screen.getByTestId('persona-create'))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ label: 'Sock puppet' }))
    await waitFor(() => expect(screen.queryByTestId('persona-new-label')).toBeNull())
    expect(list).toHaveBeenCalledTimes(2)
  })
})

describe('PersonasSection rows', () => {
  beforeEach(() => bridge([persona]))

  it('lists the persona with no import yet and a second add button', async () => {
    renderSection()
    await screen.findByTestId('persona-row-p-1')
    expect(screen.getByTestId('persona-import-summary').textContent).toBe(
      'No cookies imported yet.'
    )
    expect(screen.getByTestId('persona-add')).toBeTruthy()
    expect(screen.queryByTestId('personas-empty')).toBeNull()
  })

  it('shows the last import from the row when one is recorded', async () => {
    bridge([{ ...persona, lastImportAt: '2026-09-22T09:30:00.000Z', lastImportCount: 1 }])
    renderSection()
    await screen.findByTestId('persona-row-p-1')
    expect(screen.getByTestId('persona-import-summary').textContent).toMatch(
      /^Last import: 1 cookie on /
    )
  })

  it('renames on blur with a trimmed label and skips an unchanged or blank one', async () => {
    renderSection()
    const input = (await screen.findByTestId('persona-label')) as HTMLInputElement
    fireEvent.change(input, { target: { value: ' Renamed ' } })
    fireEvent.blur(input)
    await waitFor(() => expect(update).toHaveBeenCalledWith({ id: 'p-1', label: 'Renamed' }))

    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    await waitFor(() => expect(input.value).toBe('Research account'))
    fireEvent.blur(input)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('imports through the bridge and summarises accepted and skipped rows', async () => {
    importCookies.mockResolvedValueOnce({
      accepted: 2,
      rejected: [
        { line: 4, reason: 'expired' },
        { line: 5, reason: 'unknown-same-site' },
        { line: 9, reason: 'rejected-by-session' },
        { line: 10, reason: 'expired' }
      ],
      importedAt: '2026-09-23T12:00:00.000Z'
    })
    renderSection()
    fireEvent.click(await screen.findByTestId('persona-import'))
    await waitFor(() => expect(importCookies).toHaveBeenCalledWith('p-1'))
    await waitFor(() =>
      expect(screen.getByTestId('persona-import-summary').textContent).toBe(
        'Imported 2 cookies just now, 4 skipped (2 expired, 1 unknown SameSite, 1 refused by the browser).'
      )
    )
  })

  it('leaves the summary alone when the file dialog is cancelled', async () => {
    renderSection()
    fireEvent.click(await screen.findByTestId('persona-import'))
    await waitFor(() => expect(importCookies).toHaveBeenCalled())
    expect(screen.getByTestId('persona-import-summary').textContent).toBe(
      'No cookies imported yet.'
    )
  })

  it('confirms a delete, names the consequence, and deletes on confirm', async () => {
    renderSection()
    fireEvent.click(await screen.findByTestId('persona-delete'))
    const dialog = await screen.findByTestId('delete-persona-dialog')
    expect(dialog.textContent).toMatch(/cleared from this machine/)
    expect(dialog.textContent).toMatch(/keep its name/)
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('delete-persona-confirm'))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('p-1'))
    await waitFor(() => expect(screen.queryByTestId('delete-persona-dialog')).toBeNull())
  })

  it('cancel closes the delete dialog without deleting', async () => {
    renderSection()
    fireEvent.click(await screen.findByTestId('persona-delete'))
    await screen.findByTestId('delete-persona-dialog')
    fireEvent.click(screen.getByTestId('delete-persona-cancel'))
    await waitFor(() => expect(screen.queryByTestId('delete-persona-dialog')).toBeNull())
    expect(remove).not.toHaveBeenCalled()
  })

  it('keeps the dialog open when the delete fails', async () => {
    remove.mockRejectedValueOnce(new Error('partition busy'))
    renderSection()
    fireEvent.click(await screen.findByTestId('persona-delete'))
    await screen.findByTestId('delete-persona-dialog')
    fireEvent.click(screen.getByTestId('delete-persona-confirm'))
    await waitFor(() => expect(remove).toHaveBeenCalled())
    expect(screen.getByTestId('delete-persona-dialog')).toBeTruthy()
  })
})

describe('PersonasSection unprotected cookie store (#414)', () => {
  beforeEach(() => bridge([persona], false))

  it('shows the warning and blocks import until acknowledged', async () => {
    renderSection()
    await screen.findByTestId('persona-unprotected-warning')
    const importButton = (await screen.findByTestId('persona-import')) as HTMLButtonElement
    await waitFor(() => expect(importButton.disabled).toBe(true))
    fireEvent.click(screen.getByTestId('persona-unprotected-acknowledge'))
    await waitFor(() => expect(importButton.disabled).toBe(false))
    fireEvent.click(importButton)
    await waitFor(() => expect(importCookies).toHaveBeenCalledWith('p-1'))
  })

  it('shows no warning when the store is protected', async () => {
    bridge([persona], true)
    renderSection()
    await screen.findByTestId('persona-row-p-1')
    await waitFor(() => expect(storageState).toHaveBeenCalled())
    expect(screen.queryByTestId('persona-unprotected-warning')).toBeNull()
  })
})
