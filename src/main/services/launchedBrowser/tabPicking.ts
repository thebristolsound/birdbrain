// Which tab the capture shortcut takes (spec, "The Operator's capture trigger"). The engine reads
// `document.visibilityState` and `document.hasFocus()` in an isolated world on each tab it could
// capture. A tab qualifies when it is visible and has focus: with one window that is the tab in
// front, and with the browser focused the focused tab. Exactly one qualifying tab is captured;
// more than one, or none, opens the panel's tab picker. The engine never guesses.

export interface TabFocusState {
  targetId: string
  visible: boolean
  focused: boolean
}

export type ShortcutChoice = { capture: string } | { pick: true }

export function pickShortcutTab(states: readonly TabFocusState[]): ShortcutChoice {
  const qualifying = states.filter(({ visible, focused }) => visible && focused)
  return qualifying.length === 1 ? { capture: qualifying[0].targetId } : { pick: true }
}
