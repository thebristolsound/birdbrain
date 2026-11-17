import { expect } from 'vitest'
import { fireEvent, waitFor } from '@testing-library/react'

// A key press goes to whatever holds focus, as it does from a keyboard. Radix moves focus between
// menu items on the turn after the key, so a press that should move focus waits for it to land.
export async function press(key: string, lands?: Element): Promise<void> {
  fireEvent.keyDown(document.activeElement as Element, { key })
  if (lands) await waitFor(() => expect(document.activeElement).toBe(lands))
}

// A Radix menu item is not a button, so it reports a disabled state through ARIA.
export function isDisabledItem(item: Element): boolean {
  return item.getAttribute('aria-disabled') === 'true'
}
