// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture } from '@shared/types'
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
  MhtmlViewer: () => <div data-testid="mhtml-viewer-stub" />
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
  it('offers exactly Screenshot, Page, Text and Wayback', async () => {
    renderViewer()

    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Screenshot', 'Page', 'Text', 'Wayback'])
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
      'Wayback'
    ])
    expect(tabs.map((t) => t.getAttribute('title'))).toEqual([
      'Screenshot',
      'Page',
      'Text',
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

    expect(await screen.findByTestId('mhtml-viewer-stub')).toBeDefined()
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
