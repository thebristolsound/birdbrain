import { expect } from 'vitest'
import { act, fireEvent, waitFor } from '@testing-library/react'

// A key press goes to whatever holds focus, as it does from a keyboard. Radix moves focus between
// menu items on the turn after the key, so a press that should move focus waits for it to land.
export async function press(key: string, lands?: Element): Promise<void> {
  fireEvent.keyDown(document.activeElement as Element, { key })
  if (lands) await waitFor(() => expect(document.activeElement).toBe(lands))
}

// Lets every timer due now run: Radix moves focus on the turn after a key, and after a menu
// unmounts. A check that focus has stayed put has to come after it.
export async function nextTurn(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
}

// A Radix menu item is not a button, so it reports a disabled state through ARIA.
export function isDisabledItem(item: Element): boolean {
  return item.getAttribute('aria-disabled') === 'true'
}
