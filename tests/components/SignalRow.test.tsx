// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
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
    onDuplicate: vi.fn(),
    onCopyPattern: vi.fn(),
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

  it('leaves keys pressed on nested controls to those controls', () => {
    const { onDelete, onToggleEnabled } = renderRow()

    fireEvent.keyDown(screen.getByLabelText('Delete acme'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('switch'), { key: ' ' })

    expect(onDelete).not.toHaveBeenCalled()
    expect(onToggleEnabled).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Edit selector pattern')).toBeNull()
  })

  // #1549: a pre-selected pattern was replaced whole by the first keystroke,
  // and a changed pattern clears and re-runs every persisted match.
  it('opens the editor with the caret after the pattern, not the pattern selected', () => {
    renderRow()
    fireEvent.keyDown(screen.getByTestId('signal-row-s1'), { key: 'Enter' })

    const input = screen.getByLabelText('Edit selector pattern') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe('acme'.length)
    expect(input.selectionEnd).toBe('acme'.length)
  })

  it('writes nothing when the editor closes on an unchanged value', () => {
    const { onRename } = renderRow()
    fireEvent.keyDown(screen.getByTestId('signal-row-s1'), { key: 'Enter' })

    fireEvent.blur(screen.getByLabelText('Edit selector pattern'))

    expect(onRename).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Edit selector pattern')).toBeNull()
  })

  it('copies a selector pattern with the copy chord, and does nothing for a tag', () => {
    const { onCopyPattern } = renderRow()
    fireEvent.keyDown(screen.getByTestId('signal-row-s1'), { key: 'c', ctrlKey: true })
    fireEvent.keyDown(screen.getByTestId('signal-row-s1'), { key: 'C', metaKey: true })
    expect(onCopyPattern).toHaveBeenCalledTimes(2)

    // Another accelerator's chord, and a plain c, are not this one.
    fireEvent.keyDown(screen.getByTestId('signal-row-s1'), {
      key: 'c',
      ctrlKey: true,
      shiftKey: true
    })
    fireEvent.keyDown(screen.getByTestId('signal-row-s1'), { key: 'c' })
    expect(onCopyPattern).toHaveBeenCalledTimes(2)

    cleanup()
    const tag = renderRow(tagSignal)
    fireEvent.keyDown(screen.getByTestId('signal-row-t1'), { key: 'c', ctrlKey: true })
    expect(tag.onCopyPattern).not.toHaveBeenCalled()
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
    // The editor keeps focus once the menu has closed: handing it back to the
    // row would blur the editor, and a blur commits it.
    await waitFor(() => expect(document.activeElement).toBe(input))
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
  // app cannot reach another way. Backfill stays on the rail by the 2026-09-23
  // ruling (#1549), and Export… is #830's per-entity export.
  it('offers no action the app has no inline route for', async () => {
    renderRow()
    fireEvent.contextMenu(screen.getByTestId('signal-row-s1'))
    await screen.findByRole('menu')

    expect(screen.queryByText('Backfill existing captures')).toBeNull()
    expect(screen.queryByText('Export…')).toBeNull()
  })

  // #1549 added these two. Duplicate's inline route is the add row it fills;
  // Copy pattern's is the row's copy chord.
  it('runs Duplicate and Copy pattern from the selector menu', async () => {
    const { onDuplicate, onCopyPattern } = renderRow()
    fireEvent.contextMenu(screen.getByTestId('signal-row-s1'))
    await screen.findByRole('menu')
    fireEvent.click(screen.getByTestId('context-menu-item-selector-duplicate'))
    // Deferred until the menu has closed, since it moves focus to the add row.
    await waitFor(() => expect(onDuplicate).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    fireEvent.contextMenu(screen.getByTestId('signal-row-s1'))
    await screen.findByRole('menu')
    fireEvent.click(screen.getByTestId('context-menu-item-selector-copy-pattern'))
    expect(onCopyPattern).toHaveBeenCalledOnce()
  })
})
