import { describe, it, expect } from 'vitest'
import { statusModel, type StatusInput } from '@renderer/components/status/statusGroupModel'

const base: StatusInput = {
  egress: { kind: 'direct' },
  vpnSeen: true,
  connectedToExtension: true,
  successCount: 0,
  failCount: 0,
  sessionActive: false
}

describe('statusModel', () => {
  it('is neutral with nothing to say, and says so in one sentence', () => {
    const m = statusModel(base)
    expect(m.severity).toBe('nominal')
    expect(m.worst).toBeNull()
    expect(m.word).toBeNull()
    expect(m.count).toBeNull()
    expect(m.summary).toBe(
      'Status: all nominal. Egress: Direct · VPN seen. Extension: Connected. No Captures this session.'
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

  it('shows the stored count only while a session runs, whatever the colour', () => {
    expect(statusModel({ ...base, successCount: 23 }).count).toBeNull()
    expect(statusModel({ ...base, successCount: 23, sessionActive: true }).count).toBe(23)
    expect(statusModel({ ...base, sessionActive: true }).count).toBeNull()
  })

  it('always names a failure count in the health row', () => {
    const m = statusModel({ ...base, successCount: 23, failCount: 3 })
    expect(m.signals[2].text).toBe('23 this session · 3 failed')
    expect(m.summary).toContain('a problem')
  })
})
