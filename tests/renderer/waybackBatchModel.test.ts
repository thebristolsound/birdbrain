import { describe, it, expect } from 'vitest'
import {
  batchStatusSentence,
  egressRouteSentence,
  isKnownEgress,
  overCapSentence,
  refusedRowsSentence
} from '@renderer/components/captures/waybackBatchModel'

// #1738: the wording of the Links tab's Wayback batch.

describe('egressRouteSentence', () => {
  it('names the own connection for Direct', () => {
    expect(egressRouteSentence({ kind: 'direct' })).toBe(
      "The requests leave over this computer's own connection, because the Egress is set to Direct."
    )
  })

  it.each([
    [
      { kind: 'proxy', proxyUrl: 'socks5://10.0.0.5:1080', label: 'Office tunnel' },
      'The requests leave through the proxy set as the Egress ("Office tunnel").'
    ],
    [
      { kind: 'proxy', proxyUrl: 'http://10.0.0.5:3128', label: '' },
      'The requests leave through the proxy set as the Egress.'
    ],
    [
      { kind: 'tor', proxyUrl: 'socks5://127.0.0.1:9050', label: '' },
      'The requests leave through Tor set as the Egress.'
    ]
  ] as const)('names a proxy by kind and label, never its address', (egress, sentence) => {
    const text = egressRouteSentence(egress)
    expect(text).toBe(sentence)
    expect(text).not.toContain(egress.proxyUrl)
    expect(text).not.toContain('10.0.0.5')
  })

  it('states no route for an unreadable or unknown setting', () => {
    expect(egressRouteSentence({ kind: 'unavailable' })).toBeNull()
    expect(egressRouteSentence(undefined)).toBeNull()
    expect(isKnownEgress({ kind: 'unavailable' })).toBe(false)
    expect(isKnownEgress(undefined)).toBe(false)
    expect(isKnownEgress({ kind: 'direct' })).toBe(true)
  })
})

describe('batch wording', () => {
  it('counts refused rows and addresses past the cap', () => {
    expect(refusedRowsSentence(1)).toBe('1 row not sent. The address rule refuses these addresses:')
    expect(refusedRowsSentence(3)).toBe(
      '3 rows not sent. The address rule refuses these addresses:'
    )
    expect(overCapSentence(50, 1)).toBe(
      'Only the first 50 addresses are checked. 1 more address is not checked.'
    )
    expect(overCapSentence(50, 7)).toBe(
      'Only the first 50 addresses are checked. 7 more addresses are not checked.'
    )
  })

  it('reports progress while running', () => {
    expect(batchStatusSentence({ running: true, done: 2, total: 9 }, null)).toBe(
      'Checking in Wayback: 2 of 9 done.'
    )
    expect(batchStatusSentence({ running: false, done: 0, total: 0 }, null)).toBeNull()
  })

  it.each([
    [
      { answered: 3, failed: 0, notChecked: 0, stopped: null },
      'Batch finished. 3 addresses answered.'
    ],
    [
      { answered: 1, failed: 1, notChecked: 0, stopped: null },
      'Batch finished. 1 address answered, 1 failed.'
    ],
    [
      { answered: 2, failed: 0, notChecked: 7, stopped: 'rate-limited', status: 429 },
      'archive.org answered HTTP 429, so the batch stopped. 2 addresses answered. 7 addresses not checked.'
    ],
    [
      { answered: 1, failed: 0, notChecked: 1, stopped: 'cancelled' },
      'Batch cancelled. 1 address answered. 1 address not checked.'
    ],
    [
      { answered: 0, failed: 0, notChecked: 4, stopped: 'route-changed' },
      'The Egress setting changed, so the batch stopped. 0 addresses answered. 4 addresses not checked.'
    ]
  ] as const)('reports %j', (outcome, sentence) => {
    expect(batchStatusSentence({ running: false, done: 0, total: 0 }, outcome)).toBe(sentence)
  })
})
