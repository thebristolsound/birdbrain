// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NetworkNotice } from '@renderer/components/sharing/NetworkNotice'

afterEach(cleanup)

const TITLE = 'Teammates and the relay can see this computer’s network addresses'

// Ruling 1 of 2026-10-10: the notice shows whenever the Egress is not Direct,
// with the mock's long copy verbatim, and an unreadable Egress counts as not
// Direct.
describe('NetworkNotice', () => {
  it('renders nothing for a Direct egress', () => {
    render(<NetworkNotice egress="direct" />)
    expect(screen.queryByTestId('network-notice')).toBeNull()
  })

  it('renders nothing before the setting has loaded', () => {
    render(<NetworkNotice egress={undefined} />)
    expect(screen.queryByTestId('network-notice')).toBeNull()
  })

  it.each([
    ['proxy', 'Proxy'],
    ['tor', 'Tor'],
    ['unavailable', 'Unavailable']
  ])('names the %s egress as "%s"', (kind, label) => {
    render(<NetworkNotice egress={kind} />)
    expect(screen.getByText(TITLE)).toBeTruthy()
    expect(screen.getByText(new RegExp(`^Egress is set to ${label}\\. `))).toBeTruthy()
  })

  it('carries the long body verbatim', () => {
    render(<NetworkNotice egress="proxy" />)
    expect(
      screen.getByText(
        'Egress is set to Proxy. That covers captures, not sync: connections to members leave ' +
          'this computer directly. While a connection is set up, a member’s installation receives ' +
          'every network address this computer has, on every interface. A system VPN does not ' +
          'hide them; its own addresses are on that list. The relay sees the address this ' +
          'computer reaches it from. No setting changes this. If these addresses must stay ' +
          'private, do not share this Case from this computer.'
      )
    ).toBeTruthy()
  })

  it('has no dismiss control and warning tint, never danger', () => {
    render(<NetworkNotice egress="tor" />)
    expect(screen.queryByRole('button')).toBeNull()
    const notice = screen.getByTestId('network-notice')
    expect(notice.className).toContain('border-warning-line')
    expect(notice.className).not.toMatch(/danger/)
  })
})
