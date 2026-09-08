// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRef, type ReactNode } from 'react'

import { TagEditorPopover } from '@renderer/components/captures/TagEditorPopover'
import { DEFAULT_TAG_COLOR, TAG_COLOR_PRESETS } from '@renderer/components/tags/tagColors'
import { fakeBridge } from '../renderer/fakeBridge'

// jsdom normalises an inline hex to rgb(), so the assertions compare in that
// form rather than against the literal the palette module holds.
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

let create: ReturnType<typeof vi.fn>
let addToCapture: ReturnType<typeof vi.fn>

function renderPopover() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(
    <TagEditorPopover
      captureId="cap-1"
      open
      onClose={vi.fn()}
      anchorRef={createRef<HTMLElement>()}
    />,
    { wrapper: Wrapper }
  )
}

beforeEach(() => {
  create = vi.fn(async ({ name, color }: { name: string; color: string }) => ({
    id: 'tag-new',
    name,
    color
  }))
  addToCapture = vi.fn(async () => undefined)
  fakeBridge({
    tags: {
      list: vi.fn(async () => [
        { id: 'tag-on', name: 'phishing', color: '#3b82f6' },
        // No colour at all: the row falls back to the shared default.
        { id: 'tag-off', name: 'malware', color: '' }
      ]),
      getForCapture: vi.fn(async () => [{ id: 'tag-on', name: 'phishing', color: '#3b82f6' }]),
      addToCapture,
      removeFromCapture: vi.fn(async () => undefined),
      create
    }
  })
})

afterEach(() => cleanup())

// The per-capture popover reads its palette from the module the batch picker
// also reads (#665). These cover that wiring — the component had no render
// test, so the extraction was otherwise unverified.
describe('TagEditorPopover palette', () => {
  it('defaults the new-tag swatch to the shared default colour', async () => {
    renderPopover()
    await screen.findByText('malware')
    expect(screen.getByTitle('Pick color').style.backgroundColor).toBe(rgb(DEFAULT_TAG_COLOR))
  })

  it('falls back to the shared default for a tag with no colour of its own', async () => {
    const { container } = renderPopover()
    const row = await screen.findByText('malware')
    const dot = row.parentElement?.querySelector('span')
    expect(container.contains(dot ?? null)).toBe(true)
    expect((dot as HTMLElement).style.backgroundColor).toBe(rgb(DEFAULT_TAG_COLOR))
  })

  it('offers every shared preset and creates with the one picked', async () => {
    const { container } = renderPopover()
    await screen.findByText('malware')
    fireEvent.click(screen.getByTitle('Pick color'))

    const swatches = Array.from(container.querySelectorAll('button')).map(
      (b) => b.style.backgroundColor
    )
    for (const preset of TAG_COLOR_PRESETS) expect(swatches).toContain(rgb(preset))

    const picked = TAG_COLOR_PRESETS[3]
    const button = Array.from(container.querySelectorAll('button')).find(
      (b) => b.style.backgroundColor === rgb(picked)
    )
    fireEvent.click(button as HTMLButtonElement)
    fireEvent.change(screen.getByPlaceholderText('Create tag'), { target: { value: 'ransomware' } })
    fireEvent.click(screen.getByText('Add'))

    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'ransomware', color: picked }))
    await waitFor(() =>
      expect(addToCapture).toHaveBeenCalledWith({ captureId: 'cap-1', tagId: 'tag-new' })
    )
  })
})
