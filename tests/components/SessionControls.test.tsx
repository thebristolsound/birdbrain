// @vitest-environment jsdom
// The toggle sets sessionActive and nothing else, so its label has to say
// session (#813). "Auto-capture" is the Signals setting, written elsewhere.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [{ id: 'case-a', name: 'Case A' }] })
}))
const route = vi.hoisted(() => ({ caseId: 'case-a' as string | undefined }))

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: route.caseId })
}))
const session = vi.hoisted(() => ({ activateCase: vi.fn(), start: vi.fn(), stop: vi.fn() }))
vi.mock('@renderer/lib/queries', () => ({
  casesQueryOptions: {},
  useSessionMutations: () => ({
    activateCase: { mutateAsync: session.activateCase },
    start: { mutateAsync: session.start },
    stop: { mutateAsync: session.stop }
  })
}))

import { SessionControls } from '@renderer/components/status/SessionControls'
import { useAppStore } from '@renderer/stores/appStore'
import { settleVpnWarning, useVpnWarningStore } from '@renderer/lib/vpnWarning'
import { fakeBridge } from '../renderer/fakeBridge'

beforeEach(() => {
  route.caseId = 'case-a'
  useAppStore.setState({ connectedToExtension: true, sessionActive: false })
  useVpnWarningStore.setState({ open: false, request: null, settle: null })
  session.activateCase.mockReset()
  session.start.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('SessionControls', () => {
  it('labels the toggle Capture Session, not Auto-Capture (#813)', () => {
    render(<SessionControls />)

    expect(screen.getByText('Capture Session')).toBeDefined()
    expect(screen.getByRole('switch', { name: 'Capture Session' })).toBeDefined()
    expect(screen.queryByText('Auto-Capture')).toBeNull()
  })

  it('reflects the session state on the switch', () => {
    useAppStore.setState({ sessionActive: true })

    render(<SessionControls />)

    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })

  // Off a case route (Settings) a running session still has to be stoppable;
  // only starting one needs a case to activate.
  it('leaves a running session stoppable off a case route', () => {
    route.caseId = undefined
    useAppStore.setState({ sessionActive: true })

    render(<SessionControls />)

    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(false)
  })

  it('cannot start a session off a case route', () => {
    route.caseId = undefined

    render(<SessionControls />)

    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
  })
})

// A session's Captures contact sites, so its start passes the VPN warning (ADR-0032 rule 3).
describe('SessionControls and the VPN warning', () => {
  beforeEach(() => {
    fakeBridge({
      egress: {
        checkVpnWarning: vi.fn(async () => ({ caseId: 'case-a', warn: true, canMute: true })),
        answerVpnWarning: vi.fn(async () => undefined)
      }
    })
  })

  it('warns before a session starts, as a session warning, and starts once continued', async () => {
    render(<SessionControls />)
    fireEvent.click(screen.getByRole('switch', { name: 'Capture Session' }))
    await waitFor(() => expect(useVpnWarningStore.getState().open).toBe(true))
    expect(useVpnWarningStore.getState().request?.occasion).toBe('session')
    expect(session.start).not.toHaveBeenCalled()

    settleVpnWarning('continue')
    await waitFor(() => expect(useAppStore.getState().sessionActive).toBe(true))
    expect(session.activateCase).toHaveBeenCalledWith('case-a')
    expect(session.start).toHaveBeenCalledOnce()
  })

  it('starts nothing when the Operator stops at the warning', async () => {
    render(<SessionControls />)
    const toggle = screen.getByRole('switch', { name: 'Capture Session' }) as HTMLButtonElement
    fireEvent.click(toggle)
    await waitFor(() => expect(useVpnWarningStore.getState().open).toBe(true))
    settleVpnWarning('dismiss')
    await waitFor(() => expect(toggle.disabled).toBe(false))
    expect(session.activateCase).not.toHaveBeenCalled()
    expect(session.start).not.toHaveBeenCalled()
    expect(useAppStore.getState().sessionActive).toBe(false)
  })
})
