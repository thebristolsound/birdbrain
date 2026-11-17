// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger
} from '@renderer/components/ui/menu'
import { isDisabledItem, press } from './menuKeys'

interface HarnessProps {
  onFirst?: () => void
  onSecond?: () => void
  label?: string
}

function Harness({ onFirst, onSecond, label }: HarnessProps) {
  return (
    <>
      <button type="button">Outside</button>
      <Menu>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuContent aria-label={label}>
          <MenuItem onSelect={onFirst}>
            First
            <MenuShortcut>Ctrl+1</MenuShortcut>
          </MenuItem>
          <MenuItem disabled onSelect={onSecond}>
            Second
          </MenuItem>
          <MenuSeparator />
          <MenuItem danger>Third</MenuItem>
        </MenuContent>
      </Menu>
    </>
  )
}

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: 'Actions' })
}

afterEach(() => {
  cleanup()
})

describe('Menu', () => {
  it('opens on a pointer press, and a second press closes it', () => {
    render(<Harness />)
    fireEvent.pointerDown(trigger(), { button: 0, ctrlKey: false })
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')

    fireEvent.pointerDown(trigger(), { button: 0, ctrlKey: false })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  // Assistive technology and element.click() send a click with no pointer press behind it.
  it('opens and closes on a click that no pointer press came before', () => {
    render(<Harness />)
    fireEvent.click(trigger())
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.click(trigger())
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('ignores the click that follows a pointer press, so one press does not open and close', () => {
    render(<Harness />)
    fireEvent.pointerDown(trigger(), { button: 0, ctrlKey: false })
    fireEvent.click(trigger(), { detail: 1 })
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('takes its name from the trigger, or from a label of its own', () => {
    render(<Harness />)
    fireEvent.click(trigger())
    expect(screen.getByRole('menu', { name: 'Actions' })).toBeTruthy()

    cleanup()
    render(<Harness label="Row actions" />)
    fireEvent.click(trigger())
    expect(screen.getByRole('menu', { name: 'Row actions' })).toBeTruthy()
    expect(screen.queryByRole('menu', { name: 'Actions' })).toBeNull()
  })

  it('opens from the keyboard on its first item and passes over a disabled item', async () => {
    render(<Harness />)
    trigger().focus()
    await press('ArrowDown')
    const [first, second, third] = screen.getAllByRole('menuitem')
    await waitFor(() => expect(document.activeElement).toBe(first))
    expect(isDisabledItem(second)).toBe(true)

    await press('ArrowDown', third)
    await press('ArrowDown', first)
    await press('End', third)
    await press('Home', first)
  })

  it('runs an item on Enter, closes, and leaves focus on the trigger', async () => {
    const onFirst = vi.fn()
    render(<Harness onFirst={onFirst} />)
    trigger().focus()
    await press('Enter')
    const [first] = screen.getAllByRole('menuitem')
    await waitFor(() => expect(document.activeElement).toBe(first))

    await press('Enter')

    expect(onFirst).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger()))
  })

  // A dialog records the focused element as its opener when it mounts, and the item is gone by
  // then. The trigger has to hold focus before the item's action runs, not a turn later.
  it('moves focus to the trigger before the item acts', () => {
    let focusedAtSelect: Element | null = null
    render(<Harness onFirst={() => (focusedAtSelect = document.activeElement)} />)
    fireEvent.click(trigger())
    const [first] = screen.getAllByRole('menuitem')
    first.focus()

    fireEvent.click(first)

    expect(focusedAtSelect).toBe(trigger())
  })

  it('does not run a disabled item, and stays open', () => {
    const onSecond = vi.fn()
    render(<Harness onSecond={onSecond} />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Second' }))
    expect(onSecond).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('closes on Escape and on Tab, and returns focus to the trigger each time', async () => {
    render(<Harness />)
    for (const key of ['Escape', 'Tab']) {
      trigger().focus()
      await press('Enter')
      const [first] = screen.getAllByRole('menuitem')
      await waitFor(() => expect(document.activeElement).toBe(first))
      await press(key)
      expect(screen.queryByRole('menu')).toBeNull()
      await waitFor(() => expect(document.activeElement).toBe(trigger()))
    }
  })

  it('closes on a press outside it', async () => {
    render(<Harness />)
    fireEvent.click(trigger())
    expect(screen.getByRole('menu')).toBeTruthy()
    // Radix starts listening for a press outside on the turn after it opens.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    act(() => {
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
    })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  // The capture list clears its multi-selection on Escape unless an overlay carries this (#686).
  it('marks its panel so the capture list leaves Escape to it', () => {
    render(<Harness />)
    fireEvent.click(trigger())
    expect(screen.getByRole('menu').hasAttribute('data-selection-escape-guard')).toBe(true)
  })

  it('refuses a part rendered outside a menu', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<MenuTrigger>Loose</MenuTrigger>)).toThrow(/outside <Menu>/)
    error.mockRestore()
  })
})
