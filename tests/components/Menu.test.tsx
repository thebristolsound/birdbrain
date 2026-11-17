// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Button } from '@renderer/components/ui/button'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger
} from '@renderer/components/ui/menu'
import { isDisabledItem, nextTurn, press } from './menuKeys'

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

// A real press names its pointer; the trigger ignores a pointerdown that names none.
const MOUSE_PRESS = { button: 0, ctrlKey: false, pointerType: 'mouse' }

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: 'Actions' })
}

afterEach(() => {
  cleanup()
})

describe('Menu', () => {
  it('opens on a pointer press, and a second press closes it', () => {
    render(<Harness />)
    fireEvent.pointerDown(trigger(), MOUSE_PRESS)
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')

    fireEvent.pointerDown(trigger(), MOUSE_PRESS)
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
    fireEvent.pointerDown(trigger(), MOUSE_PRESS)
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

  // Not modal: Radix leaves the rest of the page pressable and readable while the menu is open,
  // where a modal menu turns off pointer events on the body and hides its siblings.
  it('leaves the page behind it pressable and exposed while it is open', async () => {
    render(<Harness />)
    fireEvent.click(trigger())
    expect(screen.getByRole('menu')).toBeTruthy()
    await nextTurn()
    expect(document.body.style.pointerEvents).not.toBe('none')
    const outside = screen.getByText('Outside')
    expect(outside.closest('[aria-hidden="true"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Outside' })).toBe(outside)
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

  // The capture list clears its multi-selection on Escape unless this query finds an overlay
  // (useCaptureSelection, #686). It finds the menu only while the menu is open.
  it('is what the capture list finds on Escape while it is open, and not after', async () => {
    render(<Harness />)
    expect(document.querySelector('[data-selection-escape-guard]')).toBeNull()
    fireEvent.click(trigger())
    expect(document.querySelector('[data-selection-escape-guard]')).toBe(screen.getByRole('menu'))
    await press('Escape')
    await waitFor(() => expect(document.querySelector('[data-selection-escape-guard]')).toBeNull())
  })

  // Radix returns focus to the trigger a turn after the menu unmounts, unless focus has already
  // left the menu. An item moves focus to the trigger first, so nothing is left to return, and
  // focus an item's action has moved, into a dialog for one, stays where the action put it.
  it('leaves focus where an item put it, a turn after the menu closes', async () => {
    render(
      <>
        <input aria-label="Elsewhere" />
        <Harness onFirst={() => screen.getByRole('textbox', { name: 'Elsewhere' }).focus()} />
      </>
    )
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: /First/ }))
    expect(screen.queryByRole('menu')).toBeNull()
    await nextTurn()
    await nextTurn()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Elsewhere' }))
  })

  // Button is a motion.button, and Motion's press gesture sends a pointerdown of its own, naming
  // no pointer, when Enter goes down on one. Radix has already opened the menu on the key, so
  // that pointerdown must not toggle it shut again.
  it('stays open on Enter from a trigger whose tap gesture is on', async () => {
    render(
      <Menu>
        <MenuTrigger asChild>
          <Button>Actions</Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem>First</MenuItem>
        </MenuContent>
      </Menu>
    )
    trigger().focus()
    await press('Enter')
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('ignores a pointerdown that names no pointer', () => {
    render(<Harness />)
    fireEvent.pointerDown(trigger(), { button: 0, ctrlKey: false })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  // That pointerdown also tells Radix the keyboard is no longer in use, so the first item would
  // not take focus. A menu's trigger turns the tap gesture off, as the app's two Button
  // triggers do.
  it('opens on Enter on its first item from a Button trigger with the tap gesture off', async () => {
    render(
      <Menu>
        <MenuTrigger asChild>
          <Button whileTap={undefined}>Actions</Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem>First</MenuItem>
        </MenuContent>
      </Menu>
    )
    trigger().focus()
    await press('Enter')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem')))
  })

  // For an item that swaps the menu's own items, as a delete confirmation does.
  it('stays open, with focus left in the menu, for an item marked keepOpen', () => {
    const onKeep = vi.fn()
    render(
      <Menu>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuContent>
          <MenuItem keepOpen onSelect={onKeep}>
            Keep
          </MenuItem>
        </MenuContent>
      </Menu>
    )
    fireEvent.click(trigger())
    const keep = screen.getByRole('menuitem', { name: 'Keep' })
    keep.focus()
    fireEvent.click(keep)
    expect(onKeep).toHaveBeenCalledOnce()
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(document.activeElement).toBe(keep)
  })

  // Radix gives a label no role, so the menu's own name has to carry what it says.
  it('hides its label from assistive technology', () => {
    render(
      <Menu>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuContent aria-label="Harbour ledger review">
          <MenuLabel>Harbour ledger review</MenuLabel>
          <MenuItem>First</MenuItem>
        </MenuContent>
      </Menu>
    )
    fireEvent.click(trigger())
    const menu = screen.getByRole('menu', { name: 'Harbour ledger review' })
    expect(menu.querySelector('[aria-hidden="true"]')?.textContent).toBe('Harbour ledger review')
  })

  it('refuses a part rendered outside a menu', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<MenuTrigger>Loose</MenuTrigger>)).toThrow(/outside <Menu>/)
    error.mockRestore()
  })
})
