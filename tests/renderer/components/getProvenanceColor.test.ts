// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { getProvenanceColor } from '@renderer/components/captures/getProvenanceColor'

describe('getProvenanceColor', () => {
  it('maps verified to emerald tokens', () => {
    expect(getProvenanceColor('verified')).toEqual({
      text: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      dot: 'bg-emerald-400',
      label: 'Verified'
    })
  })

  it('maps tampered and chain-broken to the same red tokens with distinct labels', () => {
    const tampered = getProvenanceColor('tampered')
    const chainBroken = getProvenanceColor('chain-broken')
    expect(tampered.text).toBe('text-red-400')
    expect(tampered.dot).toBe('bg-red-400')
    expect(tampered.label).toBe('Tampered')
    expect(chainBroken.text).toBe('text-red-400')
    expect(chainBroken.label).toBe('Chain broken')
  })

  it('maps missing and legacy to amber tokens with distinct labels', () => {
    expect(getProvenanceColor('missing')).toEqual({
      text: 'text-amber-400',
      bg: 'bg-amber-500/10',
      dot: 'bg-amber-400',
      label: 'Missing'
    })
    expect(getProvenanceColor('legacy').label).toBe('Legacy HTML')
    expect(getProvenanceColor('legacy').text).toBe('text-amber-400')
  })

  it('gives verifier-too-old its own label and none of the tamper tokens (X25)', () => {
    const tooOld = getProvenanceColor('verifier-too-old')
    expect(tooOld).toEqual({
      text: 'text-warning-fg',
      bg: 'bg-warning-surface',
      dot: 'bg-warning-fg',
      label: 'Verifier too old'
    })
    expect(tooOld.text).not.toBe(getProvenanceColor('tampered').text)
  })

  it('falls back to faint "Not verified" tokens for undefined status', () => {
    expect(getProvenanceColor(undefined)).toEqual({
      text: 'text-text-faint',
      bg: 'bg-surface',
      dot: 'bg-text-faint',
      label: 'Not verified'
    })
  })
})
