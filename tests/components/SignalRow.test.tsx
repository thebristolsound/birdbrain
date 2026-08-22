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
    onFocusSibling: vi.fn(),
    registerRow: vi.fn()
  }
  render(
    <SignalRow
      signal={signal}
      captures={captures}
      selected={false}
      {...handlers}
      {...overrides}
    />
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

  // #701 owns right-click menus and the maintainer ruled that wave 2 leaves no
  // hooks for them. A placeholder handler here would be exactly such a hook.
  it('attaches no context-menu handler', () => {
    const onContextMenu = vi.fn()
    renderRow()
    const row = screen.getByTestId('signal-row-s1')
    row.addEventListener('contextmenu', onContextMenu)

    fireEvent.contextMenu(row)

    // The listener the test added fires; what matters is that the row itself
    // does nothing — no menu markup appears.
    expect(onContextMenu).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
