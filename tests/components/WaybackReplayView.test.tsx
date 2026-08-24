// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { WaybackReplayView } from '@renderer/components/captures/WaybackReplayView'
import { MHTML_PARTITION, WAYBACK_PARTITION, WAYBACK_REPLAY_PREFIX } from '@shared/constants'

const REPLAY_URL = `${WAYBACK_REPLAY_PREFIX}20260610000000/https://example.com/`

afterEach(cleanup)

describe('WaybackReplayView', () => {
  it('mounts the guest on the wayback partition, never the evidence viewer’s', () => {
    render(<WaybackReplayView snapshotUrl={REPLAY_URL} />)

    const guest = screen.getByTestId('wayback-replay-webview')
    expect(guest.getAttribute('partition')).toBe(WAYBACK_PARTITION)
    expect(guest.getAttribute('partition')).not.toBe(MHTML_PARTITION)
    expect(guest.getAttribute('src')).toBe(REPLAY_URL)
  })

  it('asks for isolation and omits the attributes whose presence enables them', () => {
    render(<WaybackReplayView snapshotUrl={REPLAY_URL} />)

    const guest = screen.getByTestId('wayback-replay-webview')
    const prefs = guest.getAttribute('webpreferences') ?? ''
    expect(prefs).toContain('contextIsolation=yes')
    expect(prefs).toContain('sandbox=yes')
    expect(guest.getAttribute('nodeintegration')).toBeNull()
    expect(guest.getAttribute('allowpopups')).toBeNull()
    // JavaScript is deliberately left on for this partition (ruling R3), so the
    // attribute must not disable it.
    expect(prefs).not.toContain('javascript=no')
  })

  it.each([
    ['https://web.archive.org/about/', 'archive.org outside the replay path'],
    ['https://example.com/', 'an arbitrary origin'],
    ['file:///etc/passwd', 'a local file']
  ])('refuses to load %s (%s)', (url) => {
    render(<WaybackReplayView snapshotUrl={url} />)

    expect(screen.getByTestId('wayback-replay-refused')).toBeDefined()
    expect(screen.queryByTestId('wayback-replay-webview')).toBeNull()
  })
})
