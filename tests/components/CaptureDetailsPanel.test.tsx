// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture } from '@shared/types'

// The panel's own chrome is what is under test. The custody section, the tag
// popover and the inline note editor each drag in their own data graph and
// contribute nothing to the actions menu.
vi.mock('@renderer/components/captures/ForensicsTab', () => ({
  ForensicsTab: () => null
}))
vi.mock('@renderer/components/captures/TagEditorPopover', () => ({
  TagEditorPopover: () => null
}))
vi.mock('@renderer/components/notes/NoteEditor', () => ({
  NoteEditor: () => null
}))
vi.mock('@renderer/components/notes/useNoteEditor', () => ({
  useNoteEditor: () => null
}))

import { CaptureDetailsPanel } from '@renderer/components/captures/CaptureDetailsPanel'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubMatchMedia } from './matchMediaStub'

const capture: Capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/evidence?q=1',
  title: 'Example',
  hash: 'h',
  timestamp: '2026-08-01T12:00:00.000Z',
  createdAt: '2026-08-01T12:00:01.000Z',
  format: 'mhtml',
  method: 'extension'
}

let onCopyUrl: ReturnType<typeof vi.fn>
let onCopyHash: ReturnType<typeof vi.fn>

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(
    <CaptureDetailsPanel
      capture={capture}
      caseId="case1"
      onCollapse={vi.fn()}
      onOpenExternal={vi.fn()}
      onCopyUrl={onCopyUrl}
      onCopyHash={onCopyHash}
      onDelete={vi.fn()}
      onOpenAddNote={vi.fn()}
    />,
    { wrapper: Wrapper }
  )
}

beforeEach(() => {
  stubMatchMedia(false)
  onCopyUrl = vi.fn()
  onCopyHash = vi.fn()
  fakeBridge({
    notes: { list: vi.fn(async () => []) },
    tags: { list: vi.fn(async () => []), getForCapture: vi.fn(async () => []) },
    captures: { listFavorites: vi.fn(async () => []) }
  })
})

afterEach(() => {
  cleanup()
})

describe('CaptureDetailsPanel actions menu', () => {
  it('offers Copy URL with its accelerator, and closes the menu on use', async () => {
    renderPanel()

    fireEvent.click(await screen.findByTestId('capture-details-actions-btn'))
    const item = screen.getByTestId('capture-details-copy-url-btn')
    // The hint has to name the same accelerator the surface listens for, or the
    // menu is teaching a keystroke that does nothing.
    expect(item.textContent).toContain('Copy URL')
    expect(item.textContent).toContain('Ctrl+C')

    fireEvent.click(item)

    expect(onCopyUrl).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('capture-details-copy-url-btn')).toBeNull()
  })

  it('keeps Copy URL out of the way until the menu is opened', async () => {
    renderPanel()
    await screen.findByTestId('capture-details-actions-btn')

    expect(screen.queryByTestId('capture-details-copy-url-btn')).toBeNull()
    expect(onCopyUrl).not.toHaveBeenCalled()
  })

  // #826. The second of the mock's two copy actions, and the one with no
  // keyboard route: the menu item is the whole inline surface for it.
  it('offers Copy SHA-256, and closes the menu on use', async () => {
    renderPanel()

    fireEvent.click(await screen.findByTestId('capture-details-actions-btn'))
    const item = screen.getByTestId('capture-details-copy-hash-btn')
    expect(item.textContent).toContain('Copy SHA-256')
    // The inverse of the Copy URL property above: an accelerator hint here
    // would teach a keystroke nothing listens for.
    expect(item.textContent).not.toMatch(/Ctrl|⌘/)

    fireEvent.click(item)

    expect(onCopyHash).toHaveBeenCalledOnce()
    expect(onCopyUrl).not.toHaveBeenCalled()
    expect(screen.queryByTestId('capture-details-copy-hash-btn')).toBeNull()
  })

  it('keeps Copy SHA-256 out of the way until the menu is opened', async () => {
    renderPanel()
    await screen.findByTestId('capture-details-actions-btn')

    expect(screen.queryByTestId('capture-details-copy-hash-btn')).toBeNull()
    expect(onCopyHash).not.toHaveBeenCalled()
  })
})
