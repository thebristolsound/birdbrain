// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { useAppStore } from '@renderer/stores/appStore'

const routerState = vi.hoisted(() => ({ pathname: '/cases/case-1/notes' }))
vi.mock('@tanstack/react-router', () => ({
  useMatchRoute:
    () =>
    ({ to }: { to: string; fuzzy?: boolean }) => {
      const prefix = to.replace('$caseId', 'case-1')
      return routerState.pathname.startsWith(prefix) ? {} : false
    }
}))
vi.mock('@renderer/components/status/SessionControls', () => ({
  SessionControls: () => <div data-testid="session-controls" />
}))

import { CaseActionBar } from '@renderer/components/layout/CaseActionBar'

afterEach(() => {
  cleanup()
  routerState.pathname = '/cases/case-1/notes'
  useAppStore.setState({ connectedToExtension: false, sessionActive: false })
})

// The row under the top bar (docs/design-handoff/2026-11-08-top-bar/, Option B).
describe("CaseActionBar as the Case's action row", () => {
  it('names the section on its left', () => {
    render(<CaseActionBar />)
    expect(screen.getByTestId('case-action-bar-section').textContent).toBe('Notes')
  })

  it('names no section on a route it does not know', () => {
    routerState.pathname = '/cases/case-1/elsewhere'
    render(<CaseActionBar />)
    expect(screen.queryByTestId('case-action-bar-section')).toBeNull()
  })

  // The recording mark is the running state of the top bar's capture control
  // (LaunchControl.test.tsx), so the row holds the section name and the extension's switch.
  // Share and Export needed the Case to render, which this row no longer loads, so
  // e2e/topbar-layout.spec.ts checks on an open Case that they and Launch browser are gone.
  it('holds only the section name and the switch, with a session running or not', () => {
    for (const sessionActive of [false, true]) {
      useAppStore.setState({ sessionActive, connectedToExtension: true })
      render(<CaseActionBar />)
      const bar = screen.getByTestId('case-action-bar')
      // The second child is the spacer that pushes the switch to the right.
      expect(Array.from(bar.children, (el) => el.getAttribute('data-testid'))).toEqual([
        'case-action-bar-section',
        null,
        'session-controls'
      ])
      expect(screen.queryByTestId('topbar-rec')).toBeNull()
      cleanup()
    }
  })
})
