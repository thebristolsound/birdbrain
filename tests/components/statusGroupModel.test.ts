import { describe, it, expect } from 'vitest'
import { statusModel, type StatusInput } from '@renderer/components/status/statusGroupModel'

const base: StatusInput = {
  egress: { kind: 'direct' },
  egressReadFailed: false,
  vpnSeen: true,
  vpnReadFailed: false,
  connectedToExtension: true,
  successCount: 0,
  failCount: 0,
  sessionActive: false
}

describe('statusModel', () => {
  it('is neutral with nothing to say, and its summary says so', () => {
    const m = statusModel(base)
    expect(m.severity).toBe('nominal')
    expect(m.worst).toBeNull()
    expect(m.word).toBeNull()
    expect(m.count).toBeNull()
    expect(m.summary).toBe(
      'Status: all nominal. Egress: Direct · VPN seen. Extension: Connected. No captures logged.'
    )
  })

  it('keeps a disconnected extension nominal: Launch browser needs none', () => {
    const m = statusModel({ ...base, connectedToExtension: false })
    expect(m.severity).toBe('nominal')
    expect(m.signals[0].text).toBe('Not connected')
  })

  it('warns, with one word, when the Egress is Direct and no VPN was seen', () => {
    const m = statusModel({ ...base, vpnSeen: false })
    expect(m.severity).toBe('warning')
    expect(m.worst?.key).toBe('egress')
    expect(m.word).toBe('VPN not seen')
  })

  it('ranks capture failures over the VPN warning, and an unreadable Egress over both', () => {
    const failures = statusModel({ ...base, vpnSeen: false, failCount: 3, successCount: 23 })
    expect(failures.worst?.key).toBe('health')
    expect(failures.word).toBe('3 failed')
    expect(failures.severity).toBe('danger')

    const unknown = statusModel({
      ...base,
      egress: { kind: 'unavailable' },
      vpnSeen: undefined,
      failCount: 3
    })
    expect(unknown.worst?.key).toBe('egress')
    expect(unknown.word).toBe('Egress unknown')
  })

  // Missing input is its own state: an Egress nobody has read is not a nominal one.
  it('does not call the state nominal while the Egress is still being read', () => {
    const m = statusModel({ ...base, egress: undefined, vpnSeen: undefined })
    expect(m.signals[1].text).toBe('Reading…')
    expect(m.summary).toMatch(/^Status: reading the Egress\. Egress: Reading…\./)
    expect(m.summary).not.toContain('all nominal')
  })

  it('reports a failed Egress read as a problem, over capture failures', () => {
    const m = statusModel({
      ...base,
      egress: undefined,
      egressReadFailed: true,
      vpnSeen: undefined,
      failCount: 3
    })
    expect(m.severity).toBe('danger')
    expect(m.worst?.key).toBe('egress')
    expect(m.word).toBe('Egress unknown')
    expect(m.signals[1]).toMatchObject({ text: 'Egress unknown', severity: 'danger' })
    expect(m.summary).toMatch(/^Status: a problem\. Egress: Egress unknown\./)
  })

  // The VPN check is an input too: a Direct Egress nobody has checked is not a nominal one.
  it('does not call a Direct Egress nominal before the VPN check answers', () => {
    const m = statusModel({ ...base, vpnSeen: undefined })
    expect(m.severity).toBe('nominal')
    expect(m.summary).toMatch(/^Status: checking for a VPN\. Egress: Direct\./)
    expect(m.summary).not.toContain('all nominal')
  })

  it('warns that the VPN check failed, whatever the last reading was', () => {
    const m = statusModel({ ...base, vpnSeen: true, vpnReadFailed: true })
    expect(m.severity).toBe('warning')
    expect(m.worst?.key).toBe('egress')
    expect(m.word).toBe('VPN check failed')
    expect(m.signals[1]).toMatchObject({ text: 'Direct · VPN check failed', severity: 'warning' })
    expect(m.summary).toMatch(/^Status: a warning\. Egress: Direct · VPN check failed\./)
  })

  it('asks nothing of the VPN check while the Egress is not Direct', () => {
    const m = statusModel({
      ...base,
      egress: { kind: 'proxy', proxyUrl: 'socks5://127.0.0.1:1080', label: 'Lab' },
      vpnSeen: undefined,
      vpnReadFailed: true
    })
    expect(m.severity).toBe('nominal')
    expect(m.summary).toMatch(/^Status: all nominal\. Egress: Proxy: Lab\./)
  })

  it('shows the stored count only while a session runs, whatever the colour', () => {
    expect(statusModel({ ...base, successCount: 23 }).count).toBeNull()
    expect(statusModel({ ...base, successCount: 23, sessionActive: true }).count).toBe(23)
    expect(statusModel({ ...base, sessionActive: true }).count).toBeNull()
  })

  it('always names a failure count in the health row', () => {
    const m = statusModel({ ...base, successCount: 23, failCount: 3 })
    expect(m.signals[2].text).toBe('23 captured · 3 failed')
    expect(m.summary).toContain('a problem')
  })

  it('names queued background captures in the summary only when there are some', () => {
    expect(statusModel({ ...base, pending: 0 }).queued).toBeNull()
    const one = statusModel({ ...base, pending: 1 })
    expect(one.queued).toBe('1 background capture queued or running')
    expect(one.summary).toMatch(/No captures logged\. 1 background capture queued or running\.$/)
    expect(one.severity).toBe('nominal')
  })
})
