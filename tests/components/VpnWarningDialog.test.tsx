// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import {
  useVpnWarningStore,
  type VpnWarningOutcome,
  type VpnWarningRequest
} from '@renderer/lib/vpnWarning'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

import { VpnWarningDialog } from '@renderer/components/status/VpnWarningDialog'

let settle: ReturnType<typeof vi.fn<(outcome: VpnWarningOutcome) => void>>

function open(request: VpnWarningRequest) {
  useVpnWarningStore.setState({ open: true, request, settle })
  return render(<VpnWarningDialog />)
}

beforeEach(() => {
  settle = vi.fn()
  navigate.mockReset()
})

afterEach(() => {
  cleanup()
  useVpnWarningStore.setState({ open: false, request: null, settle: null })
})

describe('VpnWarningDialog', () => {
  it('says a VPN was not seen, never that there is none', () => {
    open({ occasion: 'site', canMute: true })
    const dialog = screen.getByTestId('vpn-warning-dialog')
    expect(screen.getByRole('heading', { name: 'Birdbrain did not see a VPN' })).toBeDefined()
    expect(dialog.textContent).not.toMatch(/no VPN/i)
    expect(screen.queryByTestId('vpn-warning-session')).toBeNull()
    expect(screen.queryByTestId('vpn-warning-no-network')).toBeNull()
  })

  it("says at a Capture Session's start that the browser's route is not seen", () => {
    open({ occasion: 'session', canMute: true })
    expect(screen.getByTestId('vpn-warning-session').textContent).toContain('not your browser’s')
  })

  it('offers no mute when the network could not be read, and says why', () => {
    open({ occasion: 'site', canMute: false })
    expect(screen.queryByTestId('vpn-warning-mute')).toBeNull()
    expect(screen.getByTestId('vpn-warning-no-network')).toBeDefined()
  })

  it.each([
    ['vpn-warning-continue', 'continue'],
    ['vpn-warning-mute', 'mute-network']
  ] as const)('answers %s with %s', (testId, outcome) => {
    open({ occasion: 'site', canMute: true })
    fireEvent.click(screen.getByTestId(testId))
    expect(settle).toHaveBeenCalledWith(outcome)
    expect(useVpnWarningStore.getState().open).toBe(false)
  })

  it('opens the Egress setting from "Set up a proxy", sending nothing', () => {
    open({ occasion: 'site', canMute: true })
    fireEvent.click(screen.getByTestId('vpn-warning-proxy'))
    expect(settle).toHaveBeenCalledWith('set-up-proxy')
    expect(navigate).toHaveBeenCalledWith({ to: '/settings', search: { section: 'egress' } })
  })

  it('stops the contact on Escape, and only answers this warning', () => {
    open({ occasion: 'site', canMute: true })
    const beneath = vi.fn()
    window.addEventListener('keydown', beneath)
    fireEvent.keyDown(screen.getByTestId('vpn-warning-dialog'), { key: 'Escape' })
    window.removeEventListener('keydown', beneath)
    expect(settle).toHaveBeenCalledOnce()
    expect(settle).toHaveBeenCalledWith('dismiss')
    expect(beneath.mock.calls[0][0].defaultPrevented).toBe(true)
  })

  it('ignores other keys, and stops the contact from the overlay', () => {
    open({ occasion: 'site', canMute: true })
    fireEvent.keyDown(screen.getByTestId('vpn-warning-dialog'), { key: 'Enter' })
    expect(settle).not.toHaveBeenCalled()
    fireEvent.click(document.querySelector('.bg-black\\/50')!)
    expect(settle).toHaveBeenCalledWith('dismiss')
  })
})
