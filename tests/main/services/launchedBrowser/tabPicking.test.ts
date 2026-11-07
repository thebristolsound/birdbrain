import { describe, expect, it } from 'vitest'
import { pickShortcutTab } from '@main/services/launchedBrowser/tabPicking'

// The capture shortcut's choice over injected tab states (#1832 acceptance criteria).

const tab = (targetId: string, visible: boolean, focused: boolean) => ({
  targetId,
  visible,
  focused
})

describe('pickShortcutTab', () => {
  it('captures the one tab that is visible and focused', () => {
    expect(
      pickShortcutTab([tab('a', false, false), tab('b', true, true), tab('c', true, false)])
    ).toEqual({ capture: 'b' })
  })

  it('opens the tab picker when two tabs qualify', () => {
    expect(pickShortcutTab([tab('a', true, true), tab('b', true, true)])).toEqual({ pick: true })
  })

  it('opens the tab picker when none qualifies', () => {
    expect(pickShortcutTab([tab('a', true, false), tab('b', false, true)])).toEqual({ pick: true })
    expect(pickShortcutTab([])).toEqual({ pick: true })
  })
})
