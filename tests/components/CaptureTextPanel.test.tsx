// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const notifySuccess = vi.hoisted(() => vi.fn())
const notifyError = vi.hoisted(() => vi.fn())

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: notifyError, warn: vi.fn(), success: notifySuccess, info: vi.fn() }
}))

import {
  CAPTURE_TAG_HINT,
  CaptureTextPanel,
  type TextHighlight
} from '@renderer/components/captures/CaptureTextPanel'
import { fakeBridge } from '../renderer/fakeBridge'

const TEXT = 'the funds moved to meridian-trust.com overnight'

let createSelector: ReturnType<typeof vi.fn>
let findOrCreate: ReturnType<typeof vi.fn>
let addToCapture: ReturnType<typeof vi.fn>

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CaptureTextPanel caseId="case1" captureId="cap1" heading="Evidence page" content={TEXT} />
    </QueryClientProvider>
  )
}

/**
 * jsdom has no layout and no real selection, so the Selection is stubbed the
 * way the hook's own tests stub it: what is under test here is which writes a
 * selection in the capture's text leads to.
 */
function selectInPanel(text: string) {
  const host = screen.getByTestId('capture-text')
  vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: false,
    rangeCount: 1,
    anchorNode: host.querySelector('p')?.firstChild ?? null,
    removeAllRanges: vi.fn(),
    toString: () => text,
    getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 40, bottom: 30 }) })
  } as unknown as Selection)
  fireEvent.mouseUp(host)
}

beforeEach(() => {
  notifySuccess.mockClear()
  notifyError.mockClear()
  createSelector = vi.fn(async () => ({ id: 's1' }))
  findOrCreate = vi.fn(async () => ({ id: 't1', name: 'meridian-trust-com' }))
  addToCapture = vi.fn(async () => undefined)
  fakeBridge({
    selectors: { create: createSelector },
    tags: { findOrCreate, addToCapture }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

describe('CaptureTextPanel', () => {
  it('renders the extracted text with no bar until something is selected', () => {
    renderPanel()
    const host = screen.getByTestId('capture-text')
    expect(host.querySelector('h2')?.textContent).toBe('Evidence page')
    expect([...host.querySelectorAll('p')].map((p) => p.textContent)).toEqual([TEXT])
    expect(screen.queryByTestId('note-selection-bar')).toBeNull()
  })

  it("raises the note editor's two-action bar over a selection", () => {
    renderPanel()
    selectInPanel('meridian-trust.com')

    const bar = screen.getByTestId('note-selection-bar')
    expect(Array.from(bar.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      'Selector',
      'Tag'
    ])
  })

  it('creates a selector recorded as added from a capture', async () => {
    renderPanel()
    selectInPanel('meridian-trust.com')
    fireEvent.click(screen.getByTestId('note-selection-selector'))
    fireEvent.click(screen.getByTestId('note-selection-confirm-submit'))

    await waitFor(() => expect(createSelector).toHaveBeenCalled())
    expect(createSelector).toHaveBeenCalledWith({
      caseId: 'case1',
      pattern: 'meridian-trust.com',
      isRegex: false,
      label: 'meridian-trust.com',
      origin: 'capture',
      enabled: true
    })
    await waitFor(() => expect(screen.queryByTestId('note-selection-confirm')).toBeNull())
    expect(notifySuccess).toHaveBeenCalledWith('Selector created — meridian-trust.com')
  })

  it('tags this capture, reusing a tag of the same name', async () => {
    renderPanel()
    selectInPanel('meridian-trust.com')
    fireEvent.click(screen.getByTestId('note-selection-tag'))

    expect(screen.getByText(CAPTURE_TAG_HINT)).toBeTruthy()
    expect(screen.getByTestId('note-selection-kind').textContent).toBe('tag')
    fireEvent.click(screen.getByTestId('note-selection-confirm-submit'))

    await waitFor(() => expect(addToCapture).toHaveBeenCalled())
    expect(findOrCreate).toHaveBeenCalledWith({ name: 'meridian-trust-com' })
    expect(addToCapture).toHaveBeenCalledWith({ captureId: 'cap1', tagId: 't1' })
    await waitFor(() =>
      expect(notifySuccess).toHaveBeenCalledWith('Tag applied — meridian-trust-com')
    )
  })

  // #811: the derived name goes to find-or-create, never to the create-only
  // channel, and the capture gets the tag main hands back, here an existing one
  // whose name differs in case.
  it('applies the existing tag main resolves the derived name to', async () => {
    const create = vi.fn()
    findOrCreate.mockResolvedValueOnce({ id: 'tag-existing', name: 'Meridian-Trust-Com' })
    fakeBridge({
      selectors: { create: createSelector },
      tags: { create, findOrCreate, addToCapture }
    })
    renderPanel()
    selectInPanel('meridian-trust.com')
    fireEvent.click(screen.getByTestId('note-selection-tag'))
    fireEvent.click(screen.getByTestId('note-selection-confirm-submit'))

    await waitFor(() =>
      expect(addToCapture).toHaveBeenCalledWith({ captureId: 'cap1', tagId: 'tag-existing' })
    )
    expect(findOrCreate).toHaveBeenCalledWith({ name: 'meridian-trust-com' })
    expect(create).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(notifySuccess).toHaveBeenCalledWith('Tag applied — Meridian-Trust-Com')
    )
  })

  it('reports a failed tag write and leaves the popover up', async () => {
    addToCapture.mockRejectedValueOnce(new Error('gone'))
    renderPanel()
    selectInPanel('meridian-trust.com')
    fireEvent.click(screen.getByTestId('note-selection-tag'))
    fireEvent.click(screen.getByTestId('note-selection-confirm-submit'))

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith("Couldn't apply the tag", expect.anything())
    )
    expect(screen.getByTestId('note-selection-confirm')).toBeTruthy()
  })
})

describe('CaptureTextPanel with a search hit', () => {
  const PAGE =
    'Show original\n\n\nReceived: from relay\nFrom: Wren Hollis <wren@hollis-mail.example.org>\n\nBody'

  function renderWith(content: string, highlight: TextHighlight) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <CaptureTextPanel
          caseId="case1"
          captureId="cap1"
          heading="Evidence page"
          content={content}
          highlight={highlight}
        />
      </QueryClientProvider>
    )
  }

  function spanOf(text: string): TextHighlight {
    const start = PAGE.indexOf(text)
    return { start, end: start + text.length, preview: text }
  }

  it('marks the span in its paragraph, keeping the paragraph text as it was', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    renderWith(PAGE, spanOf('Wren Hollis <wren@hollis-mail.example.org>'))

    expect(screen.getByTestId('capture-text-hit').textContent).toBe(
      'Wren Hollis <wren@hollis-mail.example.org>'
    )
    const paragraphs = [...screen.getByTestId('capture-text').querySelectorAll('p')]
    expect(paragraphs.map((p) => p.textContent)).toEqual([
      'Show original',
      'Received: from relay\nFrom: Wren Hollis <wren@hollis-mail.example.org>',
      'Body'
    ])
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    expect(screen.queryByTestId('capture-text-hit-moved')).toBeNull()
    delete (Element.prototype as Partial<Element>).scrollIntoView
  })

  it('marks nothing and says so when the text no longer holds the span there', () => {
    renderWith(PAGE.replace('Wren', 'Ruth'), spanOf('Wren Hollis <wren@hollis-mail.example.org>'))

    expect(screen.queryByTestId('capture-text-hit')).toBeNull()
    expect(screen.getByTestId('capture-text-hit-moved')).toBeTruthy()
  })

  it('marks nothing for a span past the end of the text', () => {
    renderWith('Body', { start: 2, end: 40, preview: 'dy' })

    expect(screen.queryByTestId('capture-text-hit')).toBeNull()
    expect(screen.getByTestId('capture-text-hit-moved')).toBeTruthy()
  })
})
