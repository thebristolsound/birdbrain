// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { useAppStore } from '@renderer/stores/appStore'

vi.mock('@renderer/components/status/SessionControls', () => ({
  SessionControls: () => <div data-testid="session-controls" />
}))

import { CaseActionBar } from '@renderer/components/layout/CaseActionBar'

afterEach(() => {
  cleanup()
  useAppStore.setState({ connectedToExtension: false })
})

describe('CaseActionBar', () => {
  it('carries the session switch while the extension is connected', () => {
    useAppStore.setState({ connectedToExtension: true })
    render(<CaseActionBar />)
    const bar = screen.getByTestId('case-action-bar')
    expect(within(bar).getByTestId('session-controls')).toBeTruthy()
  })

  it('leaves no empty strip without the extension', () => {
    useAppStore.setState({ connectedToExtension: false })
    render(<CaseActionBar />)
    expect(screen.queryByTestId('case-action-bar')).toBeNull()
  })
})
