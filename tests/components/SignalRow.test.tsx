// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { Capture } from '@shared/types'
import { SignalRow } from '@renderer/components/signals/SignalRow'
import type { Signal } from '@renderer/components/signals/signalsModel'

const captures: Capture[] = ['c1', 'c2', 'c3'].map((id, i) => ({
  id,
  caseId: 'case-1',
  url: `https://example.com/${id}`,
  title: `Page ${i}`,
  hash: `h${i}`,
  timestamp: `2026-01-0${i + 1}T00:00:00.000Z`,
  format: 'mhtml',
  method: 'extension',
  createdAt: `2026-01-0${i + 1}T00:00:00.000Z`
}))

const selectorSignal: Signal = {
  id: 's1',
  kind: 'selector',
  name: 'acme',
  sub: 'acme',
  count: 2,
  enabled: true,
  isRegex: false,
  captureIds: ['c1', 'c3']
}

const tagSignal: Signal = {
  id: 't1',
  kind: 'tag',
  name: 'evidence',
  sub: '',
  count: 1,
  enabled: true,
  isRegex: false,
  color: '#22c55e',
  captureIds: ['c2']
}

function renderRow(signal: Signal = selectorSignal, overrides: Record<string, unknown> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onToggleEnabled: vi.fn(),
    onToggleRegex: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onShowMatches: vi.fn(),
    onExportMatches: vi.fn(),
    onFilterCaptures: vi.fn(),
    onDuplicateTag: vi.fn(),
    onExportTag: vi.fn(),
    onCopyTagMarkdown: vi.fn(),
    onSetColor: vi.fn(),
    onMerge: vi.fn(),
    onFocusSibling: vi.fn(),
    registerRow: vi.fn()
  }
  render(
    <SignalRow signal={signal} captures={captures} selected={false} {...handlers} {...overrides} />
  )
  return handlers
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SignalRow keyboard model', () => {
  it('moves focus down and up through the list', () => {
    const { onFocusSibling } = renderRow()
    const row = screen.getByTestId('signal-row-s1')

    fireEvent.keyDown(row, { key: 'ArrowDown' })
    expect(onFocusSibling).toHaveBeenCalledWith(1)

    fireEvent.keyDown(row, { key: 'ArrowUp' })
    expect(onFocusSibling).toHaveBeenCalledWith(-1)
  })

  it('starts a rename on Enter and commits the edited value', () => {
    const { onRename } = renderRow()
    const row = screen.getByTestId('signal-row-s1')

    fireEvent.keyDown(row, { key: 'Enter' })
    const input = screen.getByLabelText('Edit selector pattern')
    fireEvent.change(input, { target: { value: 'acme corp' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onRename).toHaveBeenCalledWith('acme corp')
  })

  it('cancels a rename on Escape without writing', () => {
    const { onRename } = renderRow()
    const row = screen.getByTestId('signal-row-s1')

    fireEvent.keyDown(row, { key: 'Enter' })
    const input = screen.getByLabelText('Edit selector pattern')
    fireEvent.change(input, { target: { value: 'discarded' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onRename).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Edit selector pattern')).toBeNull()
  })

  // The input unmounts under the keyboard's focus; without a hand-back the next
  // Tab starts from the top of the document (#1536).
  it('returns focus to the row after Escape ends a rename', () => {
    const { registerRow } = renderRow()
    const row = screen.getByTestId('signal-row-s1')
    row.focus()

    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(screen.getByLabelText('Edit selector pattern'), { key: 'Escape' })

    expect(document.activeElement).toBe(row)
    expect(registerRow).toHaveBeenLastCalledWith(row)
  })

  it('returns focus to the row after Enter commits, writing once', () => {
    const { onRename } = renderRow()
    const row = screen.getByTestId('signal-row-s1')
    row.focus()

    fireEvent.keyDown(row, { key: 'Enter' })
    const input = screen.getByLabelText('Edit selector pattern')
    fireEvent.change(input, { target: { value: 'acme corp' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(document.activeElement).toBe(row)
    expect(onRename).toHaveBeenCalledTimes(1)
  })

  it('leaves focus where it went when a blur commits the rename', () => {
    const { onRename } = renderRow()
    const row = screen.getByTestId('signal-row-s1')
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)

    fireEvent.keyDown(row, { key: 'Enter' })
    const input = screen.getByLabelText('Edit selector pattern')
    input.focus()
    fireEvent.change(input, { target: { value: 'acme corp' } })
    elsewhere.focus()

    expect(onRename).toHaveBeenCalledWith('acme corp')
    expect(document.activeElement).toBe(elsewhere)
    elsewhere.remove()
  })

  it('does not act on arrow keys while editing', () => {
    const { onFocusSibling } = renderRow()
    const row = screen.getByTestId('signal-row-s1')
    fireEvent.keyDown(row, { key: 'Enter' })
    onFocusSibling.mockClear()

    fireEvent.keyDown(row, { key: 'ArrowDown' })

    expect(onFocusSibling).not.toHaveBeenCalled()
  })

  it('toggles a selector with Space and deletes with Backspace', () => {
    const { onToggleEnabled, onDelete } = renderRow()
    const row = screen.getByTestId('signal-row-s1')

    fireEvent.keyDown(row, { key: ' ' })
    expect(onToggleEnabled).toHaveBeenCalledOnce()

    fireEvent.keyDown(row, { key: 'Backspace' })
    expect(onDelete).toHaveBeenCalledOnce()
  })

  // A tag is applied by hand, so there is nothing for Space to switch. The row
  // must not report a toggle that does not exist.
  it('does not toggle a tag with Space, but still deletes it', () => {
    const { onToggleEnabled, onDelete } = renderRow(tagSignal)
    const row = screen.getByTestId('signal-row-t1')

    fireEvent.keyDown(row, { key: ' ' })
    expect(onToggleEnabled).not.toHaveBeenCalled()

    fireEvent.keyDown(row, { key: 'Delete' })
    expect(onDelete).toHaveBeenCalledOnce()
  })
})

describe('SignalRow rendering', () => {
  it('draws one coverage cell per recent capture, filled where covered', () => {
    renderRow()
    const cells = [...screen.getByTestId('coverage-strip').children]

    expect(cells).toHaveLength(3)
    expect(cells.map((c) => c.getAttribute('data-covered'))).toEqual(['true', 'false', 'true'])
    expect(cells.map((c) => c.getAttribute('title'))).toEqual(['Page 0', 'Page 1', 'Page 2'])
  })

  it('dims a disabled selector rather than hiding it', () => {
    renderRow({ ...selectorSignal, enabled: false })

    expect(screen.getByTestId('signal-name-block').className).toContain('opacity-40')
    expect(screen.getByRole('switch')).toHaveProperty('ariaChecked', 'false')
  })

  it('shows the match count and the regex chip for a selector', () => {
    renderRow({ ...selectorSignal, isRegex: true })

    expect(screen.getByTestId('signal-count').textContent).toBe('2')
    expect(screen.getByText('.*')).toBeTruthy()
  })

  it('shows a colour dot and no mode chip for a tag', () => {
    renderRow(tagSignal)

    expect(screen.getByTestId('signal-color-dot')).toBeTruthy()
    expect(screen.queryByText('Aa')).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('selects on click and toggles the switch without selecting twice', () => {
    const { onSelect, onToggleEnabled } = renderRow()

    fireEvent.click(screen.getByTestId('signal-row-s1'))
    expect(onSelect).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('switch'))
    expect(onToggleEnabled).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('flips the pattern kind from the mode chip', () => {
    const { onToggleRegex } = renderRow()

    fireEvent.click(screen.getByText('Aa'))

    expect(onToggleRegex).toHaveBeenCalledOnce()
  })

  // Replaces the wave-2 assertion that the row attached no context-menu
  // handler. That was the ruling then; #701 reversed it in wave 3 and these
  // are the terms it reversed it on.
  it('opens a selector menu on right-click, and none before', async () => {
    renderRow()
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.contextMenu(screen.getByTestId('signal-row-s1'))

    const menu = await screen.findByRole('menu')
    expect(menu.getAttribute('aria-label')).toBe('Selector actions: acme')
  })

  it('runs the selector actions the row cannot reach on its own', async () => {
    const { onShowMatches, onExportMatches } = renderRow()
    fireEvent.contextMenu(screen.getByTestId('signal-row-s1'))
    await screen.findByRole('menu')

    fireEvent.click(screen.getByTestId('context-menu-item-selector-show-matches'))
    expect(onShowMatches).toHaveBeenCalledOnce()

    fireEvent.contextMenu(screen.getByTestId('signal-row-s1'))
    await screen.findByRole('menu')
    fireEvent.click(screen.getByTestId('context-menu-item-selector-export'))
    expect(onExportMatches).toHaveBeenCalledOnce()
  })

  it('starts the inline rename from the menu, same as Enter does', async () => {
    const { onRename } = renderRow()
    fireEvent.contextMenu(screen.getByTestId('signal-row-s1'))
    await screen.findByRole('menu')

    fireEvent.click(screen.getByTestId('context-menu-item-selector-edit'))

    const input = await screen.findByLabelText('Edit selector pattern')
    fireEvent.change(input, { target: { value: 'acme corp' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith('acme corp')
  })

  it('gives a tag row the tag action set, not the selector one', async () => {
    const { onSetColor, onMerge } = renderRow(tagSignal)
    fireEvent.contextMenu(screen.getByTestId('signal-row-t1'))

    const menu = await screen.findByRole('menu')
    expect(menu.getAttribute('aria-label')).toBe('Tag actions: evidence')
    expect(screen.queryByTestId('context-menu-item-selector-toggle')).toBeNull()

    fireEvent.click(screen.getByTestId('context-menu-item-tag-merge'))
    expect(onMerge).toHaveBeenCalledOnce()

    fireEvent.contextMenu(screen.getByTestId('signal-row-t1'))
    await screen.findByRole('menu')
    // The colour submenu opens on pointer, so drive it from the keyboard.
    fireEvent.keyDown(screen.getByTestId('context-menu-item-tag-color'), { key: 'Enter' })
    fireEvent.click(await screen.findByText('Blue'))
    expect(onSetColor).toHaveBeenCalledWith('#3b82f6')
  })

  it('routes the tag menu filter item to the capture-list narrowing (#918)', async () => {
    const { onFilterCaptures, onShowMatches } = renderRow(tagSignal)
    fireEvent.contextMenu(screen.getByTestId('signal-row-t1'))
    await screen.findByRole('menu')

    fireEvent.click(screen.getByTestId('context-menu-item-tag-filter-captures'))
    expect(onFilterCaptures).toHaveBeenCalledOnce()
    // The selector route stays the selector's: the two menus name the action
    // differently and a tag has no matches to show.
    expect(onShowMatches).not.toHaveBeenCalled()
  })

  it('names the tag colour the row already has as the current one', async () => {
    renderRow(tagSignal)
    fireEvent.contextMenu(screen.getByTestId('signal-row-t1'))
    await screen.findByRole('menu')

    fireEvent.keyDown(screen.getByTestId('context-menu-item-tag-color'), { key: 'Enter' })

    // tagSignal is #22c55e, the palette's green.
    expect(await screen.findByText('Green (current)')).toBeTruthy()
    expect(screen.getByText('Blue')).toBeTruthy()
  })

  // Ruling 3: the menu is an accelerator, so nothing may appear in it that the
  // app cannot reach another way. These four are the ones the mock offers and
  // the app has no route for, and each is a live divergence rather than an
  // oversight — see the registry's own notes.
  it('offers no action the app has no inline route for', async () => {
    renderRow()
    fireEvent.contextMenu(screen.getByTestId('signal-row-s1'))
    await screen.findByRole('menu')

    expect(screen.queryByText('Duplicate')).toBeNull()
    expect(screen.queryByText('Copy pattern')).toBeNull()
    expect(screen.queryByText('Backfill existing captures')).toBeNull()
    expect(screen.queryByText('Export…')).toBeNull()
  })
})
