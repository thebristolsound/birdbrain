import { describe, it, expect } from 'vitest'
import {
  classifySelection,
  isActionableSelection,
  normalizeSelection,
  selectionToTagName,
  SELECTION_KINDS,
  SELECTION_MAX_LENGTH,
  SELECTION_MIN_LENGTH
} from '@shared/selectionKind'

/**
 * Known answers for the classifier, one row per branch of the mock's
 * `selKindOf` (2026-08-21 handoff, template 15820-15832) plus the ordering
 * cases where two branches could both fire.
 *
 * These are frozen expectations, not illustrations: the kind chip and the
 * derived pattern are what the operator confirms before a Selector enters the
 * case, so a regex edited without meaning to would change what gets watched.
 */
const KNOWN_ANSWERS: Array<{
  input: string
  value: string
  kind: (typeof SELECTION_KINDS)[number]
  note: string
}> = [
  {
    input: 'https://cracked-forum.example.net/threads/88213',
    value: 'cracked-forum.example.net',
    kind: 'domain',
    note: 'Path stripped — matches any URL on this host.'
  },
  {
    input: 'HTTP://Meridian-Trust-Secure.com/login?a=1',
    value: 'Meridian-Trust-Secure.com',
    kind: 'domain',
    note: 'Path stripped — matches any URL on this host.'
  },
  { input: 'accounts@meridian-trust.com', value: 'accounts@meridian-trust.com', kind: 'email', note: '' },
  {
    input: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    value: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    kind: 'btc address',
    note: ''
  },
  {
    input: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    value: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    kind: 'btc address',
    note: ''
  },
  { input: '192.168.0.14', value: '192.168.0.14', kind: 'ipv4', note: '' },
  {
    input: 'd41d8cd98f00b204e9800998ecf8427e',
    value: 'd41d8cd98f00b204e9800998ecf8427e',
    kind: 'hash',
    note: ''
  },
  { input: '@nightowl.7', value: '@nightowl.7', kind: 'handle', note: '' },
  { input: 'payload_final.zip', value: 'payload_final.zip', kind: 'filename', note: '' },
  { input: 'meridian-trust.com', value: 'meridian-trust.com', kind: 'domain', note: '' },
  { input: 'wire transfer', value: 'wire transfer', kind: 'text', note: '' },
  {
    input: 'the funds were moved before anyone at the branch noticed anything',
    value: 'the funds were moved before anyone at the branch noticed anything',
    kind: 'text',
    note: 'Long string — stored as an exact text match.'
  }
]

describe('classifySelection', () => {
  it.each(KNOWN_ANSWERS)('classifies $input as $kind', ({ input, value, kind, note }) => {
    expect(classifySelection(input)).toEqual({ value, kind, note })
  })

  it('strips trailing sentence punctuation before classifying', () => {
    // Selected mid-sentence, a domain would otherwise be watched with a full
    // stop on the end and match nothing.
    expect(classifySelection('meridian-trust.com.')).toEqual({
      value: 'meridian-trust.com',
      kind: 'domain',
      note: ''
    })
    expect(classifySelection('192.168.0.14,')).toMatchObject({ kind: 'ipv4' })
  })

  it('collapses internal whitespace, so a wrapped selection reads as one line', () => {
    expect(classifySelection('  wire\n   transfer  ')).toEqual({
      value: 'wire transfer',
      kind: 'text',
      note: ''
    })
    expect(normalizeSelection('a\t\tb\n c ')).toBe('a b c')
  })

  it('never annotates a Bitcoin address with a checksum claim', () => {
    // The mock says "Checksum valid - also watched on the chain feed." The
    // test here is a shape regex and there is no chain feed, so shipping that
    // note would state two things the app cannot back.
    const { note } = classifySelection('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')
    expect(note).toBe('')
  })

  it('prefers the more specific kind where two branches could match', () => {
    // A filename is also a bare dotted token; the filename branch runs first.
    expect(classifySelection('index.html').kind).toBe('filename')
    // A 32-char hex string is also a bare word; the hash branch runs first.
    expect(classifySelection('d41d8cd98f00b204e9800998ecf8427e').kind).toBe('hash')
  })

  it('falls back to text for an empty selection rather than throwing', () => {
    expect(classifySelection('')).toEqual({ value: '', kind: 'text', note: '' })
  })
})

describe('isActionableSelection', () => {
  it('rejects a stray double-click and a whole paragraph', () => {
    expect(isActionableSelection('ab')).toBe(false)
    expect(isActionableSelection('abc')).toBe(true)
    expect(isActionableSelection('x'.repeat(SELECTION_MAX_LENGTH))).toBe(true)
    expect(isActionableSelection('x'.repeat(SELECTION_MAX_LENGTH + 1))).toBe(false)
  })

  it('measures the collapsed form, not the raw one', () => {
    // Three characters plus padding is actionable; padding alone is not.
    expect(isActionableSelection('   abc   ')).toBe(true)
    expect(isActionableSelection('     ')).toBe(false)
    expect(SELECTION_MIN_LENGTH).toBe(3)
  })
})

describe('selectionToTagName', () => {
  it.each([
    ['Meridian Trust', 'meridian-trust'],
    // Slugified from the stripped host, truncated at 22, then the hyphen the
    // truncation landed on is dropped.
    ['https://cracked-forum.example.net/threads/88213', 'cracked-forum-example'],
    ['accounts@meridian-trust.com', 'accounts-meridian-trus'],
    ['@nightowl.7', 'nightowl-7'],
    ['   ', 'tagged'],
    ['!!! ???', 'tagged']
  ])('derives %s -> %s', (input, expected) => {
    expect(selectionToTagName(input)).toBe(expected)
  })

  it('never ends on the hyphen a truncation landed in', () => {
    const name = selectionToTagName('alpha bravo charlie delta echo')
    expect(name.endsWith('-')).toBe(false)
    expect(name.length).toBeLessThanOrEqual(22)
  })

  it('never returns the empty string, because tags.name is NOT NULL', () => {
    for (const input of ['', '---', '。。。']) {
      expect(selectionToTagName(input)).not.toBe('')
    }
  })
})
