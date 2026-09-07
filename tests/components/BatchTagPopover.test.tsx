// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRef, type ReactNode } from 'react'

import { BatchTagPopover } from '@renderer/components/captures/BatchTagPopover'
import { fakeBridge } from '../renderer/fakeBridge'

const SELECTED = ['cap-1', 'cap-2', 'cap-3']

const TAGS = [
  { id: 'tag-all', name: 'phishing', color: '#f59e0b' },
  { id: 'tag-some', name: 'malware', color: '#ef4444' },
  { id: 'tag-none', name: 'benign', color: '#10b981' }
]

// The known selection state the picker has to render: phishing on all three,
// malware on one, benign on none.
const COUNTS = { 'tag-all': 3, 'tag-some': 1 }

let list: ReturnType<typeof vi.fn>
let countsForCaptures: ReturnType<typeof vi.fn>
let addToCaptures: ReturnType<typeof vi.fn>
let removeFromCaptures: ReturnType<typeof vi.fn>
let findOrCreate: ReturnType<typeof vi.fn>
let onClose: ReturnType<typeof vi.fn>

function renderPopover() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(
    <BatchTagPopover
      caseId="case1"
      selectedIds={SELECTED}
      onClose={onClose}
      anchorRef={createRef<HTMLElement>()}
    />,
    { wrapper: Wrapper }
  )
}

// Every row is a menuitemcheckbox, so the tri-state reads off aria-checked
// rather than off a class name.
function row(name: string): HTMLElement {
  return screen.getByRole('menuitemcheckbox', { name: new RegExp(name) })
}

beforeEach(() => {
  list = vi.fn(async () => TAGS)
  countsForCaptures = vi.fn(async () => COUNTS)
  addToCaptures = vi.fn(async () => ({ affected: 3 }))
  removeFromCaptures = vi.fn(async () => ({ affected: 3 }))
  findOrCreate = vi.fn(async ({ name, color }: { name: string; color?: string }) => ({
    id: 'tag-new',
    name,
    color
  }))
  onClose = vi.fn()
  fakeBridge({
    tags: { list, countsForCaptures, addToCaptures, removeFromCaptures, findOrCreate }
  })
})

afterEach(() => cleanup())

describe('BatchTagPopover (#665)', () => {
  it('reads the selection membership in one call, not one per capture', async () => {
    renderPopover()
    await waitFor(() => expect(countsForCaptures).toHaveBeenCalledOnce())
    expect(countsForCaptures).toHaveBeenCalledWith({ caseId: 'case1', captureIds: SELECTED })
    expect(await screen.findByText('Tag 3 captures')).toBeDefined()
  })

  it('shows none, partial and all as three distinct states', async () => {
    renderPopover()
    await screen.findByText('phishing')
    expect(row('phishing').getAttribute('aria-checked')).toBe('true')
    expect(row('malware').getAttribute('aria-checked')).toBe('mixed')
    expect(row('benign').getAttribute('aria-checked')).toBe('false')
    // Only the partial row states the fraction; the other two are unambiguous.
    expect(screen.getByText('1/3')).toBeDefined()
    expect(screen.queryByText('3/3')).toBeNull()
  })

  it('applies an unapplied tag to the whole selection and stays open', async () => {
    renderPopover()
    fireEvent.click(await screen.findByText('benign'))
    await waitFor(() => expect(addToCaptures).toHaveBeenCalledOnce())
    expect(addToCaptures).toHaveBeenCalledWith({
      caseId: 'case1',
      captureIds: SELECTED,
      tagId: 'tag-none'
    })
    expect(removeFromCaptures).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('completes a partial application rather than removing it', async () => {
    renderPopover()
    fireEvent.click(await screen.findByText('malware'))
    await waitFor(() => expect(addToCaptures).toHaveBeenCalledOnce())
    expect(addToCaptures).toHaveBeenCalledWith({
      caseId: 'case1',
      captureIds: SELECTED,
      tagId: 'tag-some'
    })
    expect(removeFromCaptures).not.toHaveBeenCalled()
  })

  it('removes a fully applied tag from the whole selection', async () => {
    renderPopover()
    fireEvent.click(await screen.findByText('phishing'))
    await waitFor(() => expect(removeFromCaptures).toHaveBeenCalledOnce())
    expect(removeFromCaptures).toHaveBeenCalledWith({
      caseId: 'case1',
      captureIds: SELECTED,
      tagId: 'tag-all'
    })
    expect(addToCaptures).not.toHaveBeenCalled()
  })

  it('applies several tags in one gesture', async () => {
    renderPopover()
    fireEvent.click(await screen.findByText('benign'))
    await waitFor(() => expect(addToCaptures).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByText('malware'))
    await waitFor(() => expect(addToCaptures).toHaveBeenCalledTimes(2))
    expect(addToCaptures.mock.calls.map(([args]) => args.tagId)).toEqual(['tag-none', 'tag-some'])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('filters the list by the typed name', async () => {
    renderPopover()
    await screen.findByText('phishing')
    fireEvent.change(screen.getByLabelText('Find or create a tag'), { target: { value: 'mal' } })
    expect(screen.getByText('malware')).toBeDefined()
    expect(screen.queryByText('phishing')).toBeNull()
  })

  it('creates and applies a tag that does not exist, closing the empty-case dead end', async () => {
    renderPopover()
    await screen.findByText('phishing')
    fireEvent.change(screen.getByLabelText('Find or create a tag'), {
      target: { value: '  ransomware  ' }
    })
    fireEvent.click(screen.getByText(/Create .*ransomware.* and apply/))
    await waitFor(() => expect(findOrCreate).toHaveBeenCalledOnce())
    // Trimmed, and carrying the swatch colour the picker defaults to.
    expect(findOrCreate).toHaveBeenCalledWith({ name: 'ransomware', color: '#f59e0b' })
    await waitFor(() =>
      expect(addToCaptures).toHaveBeenCalledWith({
        caseId: 'case1',
        captureIds: SELECTED,
        tagId: 'tag-new'
      })
    )
    // The input clears, so the list comes back for the next tag.
    await waitFor(() =>
      expect((screen.getByLabelText('Find or create a tag') as HTMLInputElement).value).toBe('')
    )
  })

  it('offers no create row for a name that already exists, whatever its case', async () => {
    renderPopover()
    await screen.findByText('phishing')
    const input = screen.getByLabelText('Find or create a tag')
    fireEvent.change(input, { target: { value: 'PHISHING' } })
    expect(screen.queryByText(/and apply/)).toBeNull()
    // Enter on that name applies the tag it names rather than doing nothing.
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(removeFromCaptures).toHaveBeenCalledOnce())
  })

  it('creates on Enter when nothing matches', async () => {
    renderPopover()
    await screen.findByText('phishing')
    const input = screen.getByLabelText('Find or create a tag')
    fireEvent.change(input, { target: { value: 'novel' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(findOrCreate).toHaveBeenCalledOnce())
  })

  it('creates with the colour picked from the swatch', async () => {
    renderPopover()
    await screen.findByText('phishing')
    fireEvent.click(screen.getByTitle('Pick color'))
    fireEvent.click(screen.getByLabelText('Use color #ef4444'))
    fireEvent.change(screen.getByLabelText('Find or create a tag'), { target: { value: 'red' } })
    fireEvent.click(screen.getByText(/and apply/))
    await waitFor(() =>
      expect(findOrCreate).toHaveBeenCalledWith({ name: 'red', color: '#ef4444' })
    )
  })

  it('says there is no match rather than offering nothing at all', async () => {
    renderPopover()
    await screen.findByText('phishing')
    fireEvent.change(screen.getByLabelText('Find or create a tag'), { target: { value: 'zzz' } })
    expect(screen.getByText('No tag matches.')).toBeDefined()
    expect(screen.getByText(/Create .*zzz.* and apply/)).toBeDefined()
  })

  it('dismisses on an outside click and on Escape, guarding the selection', async () => {
    const { container } = renderPopover()
    await screen.findByText('phishing')
    expect(container.querySelector('[data-selection-escape-guard]')).not.toBeNull()

    fireEvent.mouseDown(screen.getByText('phishing'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledOnce()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps the typed name when the write fails', async () => {
    findOrCreate.mockRejectedValue(new Error('nope'))
    renderPopover()
    await screen.findByText('phishing')
    const input = screen.getByLabelText('Find or create a tag')
    fireEvent.change(input, { target: { value: 'doomed' } })
    fireEvent.click(screen.getByText(/and apply/))
    await waitFor(() => expect(findOrCreate).toHaveBeenCalledOnce())
    expect(addToCaptures).not.toHaveBeenCalled()
    expect((input as HTMLInputElement).value).toBe('doomed')
  })
})
