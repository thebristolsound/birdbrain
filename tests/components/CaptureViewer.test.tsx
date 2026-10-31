// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture, CaptureLinks, FieldHit, FieldHitCheck } from '@shared/types'
import { LEGACY_HTML_PARTITION } from '@shared/constants'

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: 'case1' })
}))

// The konva canvas, the MHTML iframe and the download menu each drag in a
// graph of their own and none of them is what the tab set is about.
vi.mock('@renderer/components/captures/annotation/AnnotationEditor', () => ({
  AnnotationEditor: () => null
}))
vi.mock('@renderer/components/captures/MhtmlViewer', () => ({
  MhtmlViewer: ({ linkClicks }: { linkClicks: boolean }) => (
    <div data-testid="mhtml-viewer-stub" data-link-clicks={String(linkClicks)} />
  )
}))
vi.mock('@renderer/components/captures/CaptureDownloadMenu', () => ({
  CaptureDownloadMenu: () => null
}))
vi.mock('@renderer/components/captures/WaybackCompare', () => ({
  WaybackCompare: () => <div data-testid="wayback-compare-stub" />
}))

import { CaptureViewer } from '@renderer/components/captures/CaptureViewer'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubMatchMedia } from './matchMediaStub'
import { stubResizeObserver } from './resizeObserverStub'

const capture: Capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/evidence',
  title: 'Example evidence page',
  hash: 'h',
  timestamp: '2026-08-01T12:00:00.000Z',
  createdAt: '2026-08-01T12:00:01.000Z',
  format: 'mhtml',
  method: 'extension'
}

const LEGACY_FILE_URL = 'file:///store/case1/cap1.html'

let getContent: ReturnType<typeof vi.fn>
let getHtmlUrl: ReturnType<typeof vi.fn>

function renderViewer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<CaptureViewer />, { wrapper: Wrapper })
}

beforeEach(() => {
  stubMatchMedia(false)
  stubResizeObserver()
  getContent = vi.fn(async () => null)
  getHtmlUrl = vi.fn(async () => LEGACY_FILE_URL)
  fakeBridge({
    captures: { list: vi.fn(async () => [capture]), getContent, getHtmlUrl }
  })
  useAppStore.getState().setSelectedCaptureId(capture.id)
  useAppStore.getState().setActiveViewerTab('screenshot')
})

afterEach(() => {
  cleanup()
  useAppStore.getState().setSelectedCaptureId(null)
  useAppStore.getState().setActiveViewerTab('screenshot')
  useAppStore.getState().setViewerHit(null)
  useAppStore.setState({ captureTrail: [] })
})

describe('CaptureViewer provenance chrome (#827)', () => {
  it('badges a duplicate and links back to the capture it was copied from', async () => {
    const source = { ...capture, id: 'cap0', timestamp: '2026-07-01T09:00:00.000Z' }
    const duplicate = { ...capture, method: 'duplicate' as const, duplicateOfCaptureId: 'cap0' }
    fakeBridge({
      captures: { list: vi.fn(async () => [duplicate, source]), getContent }
    })
    renderViewer()

    expect((await screen.findByTestId('method-badge')).textContent).toBe('Duplicate')
    const link = await screen.findByTestId('duplicate-link-source')
    expect(link.textContent).toContain('Duplicate of')

    fireEvent.click(link)
    expect(useAppStore.getState().selectedCaptureId).toBe('cap0')
  })

  // ADR-0040: a link Capture names the Capture whose stored page held the link.
  it('links a link Capture back to the Capture it came from', async () => {
    const source = { ...capture, id: 'cap0', title: 'Profile page' }
    const linked = {
      ...capture,
      method: 'background' as const,
      linkedFromCaptureId: 'cap0',
      linkedFromContentHash: 'b'.repeat(64),
      linkHref: 'http://example.com/linked'
    }
    fakeBridge({ captures: { list: vi.fn(async () => [linked, source]), getContent } })
    renderViewer()

    const link = await screen.findByTestId('linked-from-source')
    expect(link.textContent).toBe('← From a link in Profile page')
    fireEvent.click(link)
    expect(useAppStore.getState().selectedCaptureId).toBe('cap0')
  })

  it('names a link source by its address when it has no title, and not at all once deleted', async () => {
    const source = { ...capture, id: 'cap0', title: '', url: 'https://example.com/profile' }
    const linked = { ...capture, linkedFromCaptureId: 'cap0' }
    fakeBridge({ captures: { list: vi.fn(async () => [linked, source]), getContent } })
    const { unmount } = renderViewer()
    expect((await screen.findByTestId('linked-from-source')).textContent).toBe(
      '← From a link in https://example.com/profile'
    )
    unmount()

    fakeBridge({ captures: { list: vi.fn(async () => [linked]), getContent } })
    renderViewer()
    expect(await screen.findByText('Example evidence page')).toBeTruthy()
    expect(screen.queryByTestId('linked-from-source')).toBeNull()
  })

  it('still badges a duplicate whose source has been deleted', async () => {
    const duplicate = { ...capture, method: 'duplicate' as const, duplicateOfCaptureId: 'gone' }
    fakeBridge({ captures: { list: vi.fn(async () => [duplicate]), getContent } })
    renderViewer()

    // The badge comes from the row's own method, so a missing source cannot
    // make the copy read as an ordinary capture.
    expect((await screen.findByTestId('method-badge')).textContent).toBe('Duplicate')
    expect(screen.queryByTestId('duplicate-link-source')).toBeNull()
  })

  // #466. The Wayback tab hides the details panel, the one other place the
  // method shows, and at the default 1200px window it leaves the viewer 716px
  // (1200 - 48px sidebar - 436px Wayback panel). The badge therefore has to be
  // back by 42rem (672px), not the 48rem the Download label waits for.
  it('keeps the method badge at the width the Wayback layout leaves the viewer', async () => {
    const duplicate = { ...capture, method: 'duplicate' as const, duplicateOfCaptureId: 'gone' }
    fakeBridge({ captures: { list: vi.fn(async () => [duplicate]), getContent } })
    renderViewer()

    const badge = await screen.findByTestId('method-badge')
    expect(badge.className).toContain('@2xl/viewer:inline-block')
    expect(badge.className).not.toContain('@3xl/viewer')
  })

  it('leaves an ordinary extension capture unbadged', async () => {
    renderViewer()
    await screen.findAllByRole('tab')
    expect(screen.queryByTestId('method-badge')).toBeNull()
  })
})

describe('CaptureViewer tabs', () => {
  it('offers exactly Screenshot, Page, Text, Links and Wayback', async () => {
    renderViewer()

    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Screenshot',
      'Page',
      'Text',
      'Links',
      'Wayback'
    ])
  })

  // #466. The narrow viewer pane drops the tab labels for their icons, so the
  // name a screen reader and the E2E locators read cannot be the text node.
  it('names every tab independently of the label it may be hiding', async () => {
    renderViewer()
    const tabs = await screen.findAllByRole('tab')

    expect(tabs.map((t) => t.getAttribute('aria-label'))).toEqual([
      'Screenshot',
      'Page',
      'Text',
      'Links',
      'Wayback'
    ])
    expect(tabs.map((t) => t.getAttribute('title'))).toEqual([
      'Screenshot',
      'Page',
      'Text',
      'Links',
      'Wayback'
    ])
    // One decorative icon each: it stands in for the label, so it must not
    // double the name up when the label is showing.
    for (const tab of tabs) {
      const icons = tab.querySelectorAll('svg[aria-hidden]')
      expect(icons.length).toBe(1)
    }
  })

  it('no longer offers a Source tab — Page is the MHTML', async () => {
    renderViewer()
    await screen.findAllByRole('tab')

    expect(screen.queryByRole('tab', { name: 'Source' })).toBeNull()
  })

  // #1708. The fifth tab reads its rows from captures:getLinks, not the artifact bytes.
  it('renders the Links tab from the link list without fetching a stored artifact', async () => {
    const getLinks = vi.fn(async () => ({
      links: [
        {
          href: 'https://example.com/a',
          rawHref: '/a',
          text: 'A link',
          rel: [],
          kind: 'http' as const,
          frame: 'main' as const,
          documentUrl: capture.url,
          occurrences: 1,
          textHostMismatch: false
        }
      ],
      truncated: false,
      skippedParts: { tooLarge: 0, overPartCount: 0, overTotalSize: 0 },
      mainDocumentSkipped: false
    }))
    fakeBridge({
      captures: { list: vi.fn(async () => [capture]), getContent, getHtmlUrl, getLinks }
    })
    renderViewer()
    fireEvent.click(await screen.findByRole('tab', { name: 'Links' }))

    expect(await screen.findByText('A link')).toBeDefined()
    expect(getLinks).toHaveBeenCalledWith('cap1')
    await waitFor(() => expect(getContent).not.toHaveBeenCalledWith('cap1', 'html'))
  })

  it('renders the Wayback surface without fetching a stored artifact', async () => {
    renderViewer()
    fireEvent.click(await screen.findByRole('tab', { name: 'Wayback' }))

    expect(await screen.findByTestId('wayback-compare-stub')).toBeDefined()
    // Wayback reads archive.org, not the capture directory.
    await waitFor(() => expect(getContent).not.toHaveBeenCalledWith('cap1', 'html'))
  })

  it('drives the tab off the shared store so the route can react to it', async () => {
    renderViewer()
    fireEvent.click(await screen.findByRole('tab', { name: 'Text' }))

    expect(useAppStore.getState().activeViewerTab).toBe('text')
  })

  it('walks the tab strip with the arrow keys', async () => {
    renderViewer()
    const tabs = await screen.findAllByRole('tab')

    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(useAppStore.getState().activeViewerTab).toBe('page')

    fireEvent.keyDown(tabs[1], { key: 'End' })
    expect(useAppStore.getState().activeViewerTab).toBe('wayback')

    fireEvent.keyDown(tabs[3], { key: 'Home' })
    expect(useAppStore.getState().activeViewerTab).toBe('screenshot')

    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' })
    expect(useAppStore.getState().activeViewerTab).toBe('wayback')
  })

  it('shows the MHTML viewer on the Page tab', async () => {
    renderViewer()
    fireEvent.click(await screen.findByRole('tab', { name: 'Page' }))

    expect((await screen.findByTestId('mhtml-viewer-stub')).dataset.linkClicks).toBe('true')
  })

  // #1735, plan A3.
  it('shows Back to the Capture a link click came from while the trail holds one', async () => {
    const from = { ...capture, id: 'cap0', title: 'Where the link was' }
    const gone = 'deleted-since'
    fakeBridge({ captures: { list: vi.fn(async () => [capture, from]), getContent } })
    useAppStore.setState({ selectedCaptureId: 'cap1', captureTrail: ['cap0', gone] })
    renderViewer()

    const back = await screen.findByTestId('capture-trail-back')
    expect(back.textContent).toBe('← Back to Where the link was')
    fireEvent.click(back)

    expect(useAppStore.getState().selectedCaptureId).toBe('cap0')
    expect(useAppStore.getState().captureTrail).toEqual([])
    await waitFor(() => expect(screen.queryByTestId('capture-trail-back')).toBeNull())
  })

  it('names a Capture with no title by its address on Back, and shows no Back with no trail', async () => {
    const from = { ...capture, id: 'cap0', title: '', url: 'https://example.com/untitled' }
    fakeBridge({ captures: { list: vi.fn(async () => [capture, from]), getContent } })
    useAppStore.setState({ selectedCaptureId: 'cap1', captureTrail: ['cap0'] })
    renderViewer()

    expect((await screen.findByTestId('capture-trail-back')).textContent).toBe(
      '← Back to https://example.com/untitled'
    )
    act(() => useAppStore.setState({ captureTrail: [] }))
    expect(screen.queryByTestId('capture-trail-back')).toBeNull()
  })

  // #906. The Page tab used to render a pre-v11 capture through an
  // `<iframe sandbox="" srcDoc={content}>`, which stops scripts but governs no
  // subresource fetch. It is a guest on a partition with an empty request
  // allow-list now, and the bytes are read off disk by URL rather than carried
  // across IPC as a string.
  it('renders a pre-v11 HTML capture in a no-network guest on the Page tab', async () => {
    const legacy: Capture = { ...capture, format: 'html' }
    fakeBridge({ captures: { list: vi.fn(async () => [legacy]), getContent, getHtmlUrl } })
    const { container } = renderViewer()
    fireEvent.click(await screen.findByRole('tab', { name: 'Page' }))

    const guest = await screen.findByTestId('legacy-html-viewer')
    expect(guest.getAttribute('src')).toBe(LEGACY_FILE_URL)
    expect(guest.getAttribute('partition')).toBe(LEGACY_HTML_PARTITION)
    expect(guest.getAttribute('webpreferences')).toContain('javascript=no')
    expect(container.querySelector('iframe')).toBeNull()
    await waitFor(() => expect(getContent).not.toHaveBeenCalledWith('cap1', 'html'))
  })

  it('says so when a pre-v11 HTML capture has no stored artifact', async () => {
    const legacy: Capture = { ...capture, format: 'html' }
    getHtmlUrl = vi.fn(async () => null)
    fakeBridge({ captures: { list: vi.fn(async () => [legacy]), getContent, getHtmlUrl } })
    renderViewer()
    fireEvent.click(await screen.findByRole('tab', { name: 'Page' }))

    expect(await screen.findByText('No HTML available')).toBeDefined()
  })
})

// #704. The Page tab renders a stored copy inside a guest that looks like a
// live browser, so it says which it is. Mounted in the viewer shell rather than
// inside either guest component, which is also why the MhtmlViewer mock at the
// top of this file does not hide it.
describe('CaptureViewer archived-copy banner (#704)', () => {
  it('states that the MHTML Page tab is an archived copy, and when it was captured', async () => {
    renderViewer()
    fireEvent.click(await screen.findByRole('tab', { name: 'Page' }))

    const banner = await screen.findByTestId('archived-copy-banner')
    expect(banner.textContent).toContain('Archived copy')
    // UTC-pinned, so this reads the same on every machine and in CI.
    expect(banner.textContent).toContain('Captured Sat, Aug 1, 2026, 12:00 PM UTC')
  })

  it('states the same on a pre-v11 HTML capture, without claiming MHTML', async () => {
    const legacy: Capture = { ...capture, format: 'html' }
    fakeBridge({ captures: { list: vi.fn(async () => [legacy]), getContent, getHtmlUrl } })
    renderViewer()
    fireEvent.click(await screen.findByRole('tab', { name: 'Page' }))

    const banner = await screen.findByTestId('archived-copy-banner')
    expect(banner.textContent).toContain('Archived copy')
    expect(banner.textContent).toContain('Captured Sat, Aug 1, 2026, 12:00 PM UTC')
    // The claim holds for a capture that has no page.mhtml, so the copy must not
    // name one. Scoped to the banner — the tab body legitimately may.
    expect(banner.textContent).not.toMatch(/mhtml/i)
    expect(await screen.findByTestId('legacy-html-viewer')).toBeDefined()
  })

  it('carries no claim the viewer does not make: no hash, no network posture', async () => {
    renderViewer()
    fireEvent.click(await screen.findByRole('tab', { name: 'Page' }))

    const banner = await screen.findByTestId('archived-copy-banner')
    expect(banner.textContent).not.toMatch(/sha256/i)
    expect(banner.textContent).not.toMatch(/network/i)
    expect(banner.textContent).not.toMatch(/script/i)
  })

  it('stays off the tabs that cannot be mistaken for a live page', async () => {
    renderViewer()
    await screen.findAllByRole('tab')
    expect(screen.queryByTestId('archived-copy-banner')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Text' }))
    expect(screen.queryByTestId('archived-copy-banner')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Wayback' }))
    await screen.findByTestId('wayback-compare-stub')
    expect(screen.queryByTestId('archived-copy-banner')).toBeNull()
  })
})

describe('CaptureViewer pager', () => {
  const second = { ...capture, id: 'cap2', title: 'Second page' }
  const third = { ...capture, id: 'cap3', title: 'Third page' }

  beforeEach(() => {
    fakeBridge({ captures: { list: vi.fn(async () => [capture, second, third]), getContent } })
  })

  afterEach(() => {
    useAppStore.getState().setDisplayedCaptureIds(null)
  })

  it('counts and steps through the list as displayed, not the whole case', async () => {
    // The list shows two of the three, newest-first order reversed by a sort.
    useAppStore.getState().setDisplayedCaptureIds(['cap3', 'cap1'])
    renderViewer()

    expect((await screen.findByTestId('capture-pager-count')).textContent).toBe('2 / 2')
    expect(screen.getByTitle('Next capture (→)')).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByTitle('Previous capture (←)'))
    expect(useAppStore.getState().selectedCaptureId).toBe('cap3')
  })

  it('never steps onto a capture the list is hiding', async () => {
    useAppStore.getState().setDisplayedCaptureIds(['cap1', 'cap3'])
    renderViewer()
    await screen.findByTestId('capture-pager-count')

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(useAppStore.getState().selectedCaptureId).toBe('cap3')
  })

  it('walks the whole case when no list is mounted', async () => {
    renderViewer()
    expect((await screen.findByTestId('capture-pager-count')).textContent).toBe('1 / 3')

    fireEvent.click(screen.getByTitle('Next capture (→)'))
    expect(useAppStore.getState().selectedCaptureId).toBe('cap2')
  })
})

describe('CaptureViewer Text tab', () => {
  it('lays the extracted text out as prose under the capture title', async () => {
    getContent.mockResolvedValue('First line\nsame paragraph\n\n\nSecond paragraph\r\n\r\nThird')
    useAppStore.getState().setActiveViewerTab('text')
    renderViewer()

    const panel = await screen.findByTestId('capture-text')
    expect(panel.querySelector('h2')?.textContent).toBe('Example evidence page')
    const paragraphs = [...panel.querySelectorAll('p')].map((p) => p.textContent)
    // Blank lines become breaks; a single line break stays inside its paragraph.
    expect(paragraphs).toEqual(['First line\nsame paragraph', 'Second paragraph', 'Third'])
    expect(panel.firstElementChild?.className).toContain('max-w-[660px]')
  })

  it('reads the text sidecar into the panel that carries the selection bar', async () => {
    getContent.mockImplementation(async (_id: string, kind: string) =>
      kind === 'txt' ? 'funds moved to meridian-trust.com' : null
    )
    useAppStore.getState().setActiveViewerTab('text')
    renderViewer()

    const panel = await screen.findByTestId('capture-text')
    expect([...panel.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'funds moved to meridian-trust.com'
    ])
    expect(getContent).toHaveBeenCalledWith('cap1', 'txt')
  })

  it('says so when the capture has no extracted text', async () => {
    useAppStore.getState().setActiveViewerTab('text')
    renderViewer()
    expect(await screen.findByText('No text content available')).toBeDefined()
  })

  it.each([
    ['marks the span of a header hit opened on this Capture', 'cap1', 'text', 1],
    ["marks nothing for another Capture's hit", 'cap9', 'text', 0],
    ['marks nothing for a link hit', 'cap1', 'html-part', 0]
  ] as const)('%s', async (_name, exhibitId, source, marks) => {
    getContent.mockResolvedValue('From: wren@hollis-mail.example.org')
    const hit: FieldHit = {
      fieldId: 1,
      caseId: 'case1',
      exhibitId,
      exhibitNumber: 1,
      exhibitCitation: '1',
      contentHash: 'h',
      title: 'Example evidence page',
      field: 'header.from',
      preview: 'wren@hollis-mail.example.org',
      norm: 'wren@hollis-mail.example.org',
      occurrences: 1,
      locator: { source, part: null, startOffset: 6, endOffset: 34, extractor: 'fields/1' }
    }
    useAppStore.getState().setViewerHit(hit)
    useAppStore.getState().setActiveViewerTab('text')
    renderViewer()

    await screen.findByTestId('capture-text')
    expect(screen.queryAllByTestId('capture-text-hit')).toHaveLength(marks)
  })
})

// The exact check (docs/plans/2026-10-09-case-retrieval-first-slice.md, D7) sits in the
// tab the hit opened, in every state that tab can show while the hit is open.
describe('CaptureViewer exact check', () => {
  const TEXT = 'From: wren@hollis-mail.example.org'
  const HREF = 'https://tollgate-ledger.example.com/pay'

  function fieldHit(source: 'text' | 'html-part', exhibitId = 'cap1'): FieldHit {
    return {
      fieldId: 1,
      caseId: 'case1',
      exhibitId,
      exhibitNumber: 1,
      exhibitCitation: '1',
      contentHash: 'h',
      title: 'Example evidence page',
      field: source === 'text' ? 'header.from' : 'link.href',
      preview: source === 'text' ? 'wren@hollis-mail.example.org' : HREF,
      norm: source === 'text' ? 'wren@hollis-mail.example.org' : HREF,
      occurrences: 1,
      locator:
        source === 'text'
          ? { source, part: null, startOffset: 6, endOffset: 34, extractor: 'fields/1' }
          : { source, part: 0, startOffset: 9, endOffset: 48, extractor: 'fields/1' }
    }
  }

  function links(href: string): CaptureLinks {
    return {
      links: [
        {
          href,
          rawHref: href,
          text: 'Pay',
          rel: [],
          kind: 'http' as const,
          frame: 'main' as const,
          documentUrl: capture.url,
          occurrences: 1,
          textHostMismatch: false
        }
      ],
      truncated: false,
      skippedParts: { tooLarge: 0, overPartCount: 0, overTotalSize: 0 },
      mainDocumentSkipped: false
    }
  }

  it.each([
    ['a marked span', TEXT, 'capture-text-hit'],
    [
      'a span not at its recorded place',
      'From: someone else entirely here',
      'capture-text-hit-moved'
    ],
    ['no text file', null, null]
  ] as const)('offers the check in the Text tab with %s', async (_name, text, shown) => {
    getContent.mockResolvedValue(text)
    useAppStore.getState().setViewerHit(fieldHit('text'))
    useAppStore.getState().setActiveViewerTab('text')
    renderViewer()

    if (shown) await screen.findByTestId(shown)
    else await screen.findByText('No text content available')
    expect(screen.getByTestId('field-hit-check')).toBeDefined()
  })

  const linkStates: Array<
    [string, Pick<Capture, 'format'>, () => Promise<CaptureLinks | null>, string]
  > = [
    ['a marked row', { format: 'mhtml' as const }, async () => links(HREF), 'links-hit'],
    [
      'no matching row',
      { format: 'mhtml' as const },
      async () => links('https://other.example/x'),
      'links-notice'
    ],
    ['a legacy capture', { format: 'html' as const }, async () => null, 'links-empty'],
    ['no stored page', { format: 'mhtml' as const }, async () => null, 'links-empty'],
    [
      'a read error',
      { format: 'mhtml' as const },
      async () => {
        throw new Error('unreadable')
      },
      'links-empty'
    ]
  ]

  it.each(linkStates)(
    'offers the check in the Links tab with %s',
    async (_name, over, getLinks, shown) => {
      const viewed = { ...capture, ...over }
      fakeBridge({
        captures: { list: vi.fn(async () => [viewed]), getContent, getHtmlUrl, getLinks }
      })
      useAppStore.getState().setViewerHit(fieldHit('html-part'))
      useAppStore.getState().setActiveViewerTab('links')
      renderViewer()

      await screen.findAllByTestId(shown)
      expect(screen.getByTestId('field-hit-check')).toBeDefined()
    }
  )

  it.each([
    ['with no hit open', null, 'text'],
    ["for another Capture's hit", fieldHit('text', 'cap9'), 'text'],
    ['in a tab the hit did not open', fieldHit('text'), 'links']
  ] as const)('offers no check %s', async (_name, openHit, tab) => {
    getContent.mockResolvedValue(TEXT)
    fakeBridge({
      captures: {
        list: vi.fn(async () => [capture]),
        getContent,
        getHtmlUrl,
        getLinks: vi.fn(async () => links(HREF))
      }
    })
    useAppStore.getState().setViewerHit(openHit)
    useAppStore.getState().setActiveViewerTab(tab)
    renderViewer()

    await screen.findByTestId(tab === 'text' ? 'capture-text' : 'links-tab')
    expect(screen.queryByTestId('field-hit-check')).toBeNull()
  })

  // The answer belongs to one opening of a hit.
  describe('the answer', () => {
    const PRESS = { name: 'Check against the stored file' }
    const present = (target: FieldHit): FieldHitCheck => {
      const { exhibitId, field, locator, preview } = target
      return {
        check: { text: 'present', basis: 'hash-verified', reason: null },
        record: { exhibitId, field, value: preview, locator }
      }
    }

    function openText(checkFieldHit: ReturnType<typeof vi.fn>, others: Capture[] = []) {
      getContent.mockResolvedValue(TEXT)
      fakeBridge({
        captures: { list: vi.fn(async () => [capture, ...others]), getContent, getHtmlUrl },
        cases: { checkFieldHit }
      })
      useAppStore.getState().setActiveViewerTab('text')
    }

    it('goes when another Capture is selected, and stays gone on return', async () => {
      const hitA = fieldHit('text')
      const checkFieldHit = vi.fn(async () => present(hitA))
      openText(checkFieldHit, [{ ...capture, id: 'cap2', title: 'Second page' }])
      useAppStore.getState().setViewerHit(hitA)
      renderViewer()

      fireEvent.click(await screen.findByRole('button', PRESS))
      expect(await screen.findByTestId('field-hit-check-answer')).toBeDefined()
      act(() => useAppStore.getState().selectCapture('cap2'))
      expect(screen.queryByTestId('field-hit-check-answer')).toBeNull()
      act(() => useAppStore.getState().selectCapture('cap1'))
      await screen.findByTestId('capture-text')
      expect(screen.queryByTestId('field-hit-check-answer')).toBeNull()
    })

    it('does not come back when the same hit is opened again', async () => {
      // A repeated search hands back the same hit object, so reopening hit A passes
      // the object the answer was given for.
      const hitA = fieldHit('text')
      const hitB = { ...fieldHit('text'), fieldId: 2 }
      const checkFieldHit = vi.fn(async () => present(hitA))
      openText(checkFieldHit)
      useAppStore.getState().setViewerHit(hitA)
      renderViewer()

      fireEvent.click(await screen.findByRole('button', PRESS))
      expect(await screen.findByTestId('field-hit-check-answer')).toBeDefined()
      act(() => useAppStore.getState().setViewerHit(hitB))
      expect(screen.queryByTestId('field-hit-check-answer')).toBeNull()
      act(() => useAppStore.getState().setViewerHit(hitA))
      expect(screen.getByRole('button', PRESS)).toBeDefined()
      expect(screen.queryByTestId('field-hit-check-answer')).toBeNull()
      expect(checkFieldHit).toHaveBeenCalledTimes(1)
    })

    it('from an earlier opening never shows in a later one', async () => {
      const hitA = fieldHit('text')
      let settle: (value: FieldHitCheck) => void = () => {}
      const checkFieldHit = vi.fn(
        () =>
          new Promise<FieldHitCheck>((resolve) => {
            settle = resolve
          })
      )
      openText(checkFieldHit)
      useAppStore.getState().setViewerHit(hitA)
      renderViewer()

      fireEvent.click(await screen.findByRole('button', PRESS))
      act(() => useAppStore.getState().setViewerHit(hitA))
      await act(async () => settle(present(hitA)))
      expect(screen.queryByTestId('field-hit-check-answer')).toBeNull()
      expect(screen.getByRole('button', PRESS)).toHaveProperty('disabled', false)
    })
  })
})
