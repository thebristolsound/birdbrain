/**
 * #1590: a search for a domain, an email address or a web address used to be
 * an FTS5 syntax error. These pin the preparing function's rules and the two
 * searches that use it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture, searchCaptures } from '@main/services/db/captureRepo'
import { createNote, searchNotes } from '@main/services/db/noteRepo'
import { toFtsMatchQuery } from '@main/services/db/ftsQuery'

describe('toFtsMatchQuery', () => {
  it('leaves plain words, prefixes, quoted phrases and operators unchanged', () => {
    for (const query of [
      'example',
      'exam*',
      '"exact phrase"',
      'foo OR bar',
      'foo AND bar',
      'foo NOT bar',
      'NEAR',
      'snake_case 2026',
      'café 東京',
      '"phrase prefix"*',
      '"say ""hi"""'
    ]) {
      expect(toFtsMatchQuery(query)).toBe(query)
    }
  })

  it('quotes a term holding a character outside the bareword set', () => {
    expect(toFtsMatchQuery('example.com')).toBe('"example.com"')
    expect(toFtsMatchQuery('alice@example.org')).toBe('"alice@example.org"')
    expect(toFtsMatchQuery('https://example.com/path')).toBe('"https://example.com/path"')
    expect(toFtsMatchQuery('well-known')).toBe('"well-known"')
  })

  it('quotes term by term, keeping operators and plain words around a quoted term', () => {
    expect(toFtsMatchQuery('acme OR example.com')).toBe('acme OR "example.com"')
    expect(toFtsMatchQuery('  example.com   exam*  ')).toBe('"example.com" exam*')
  })

  it('doubles an embedded double quote', () => {
    expect(toFtsMatchQuery('say"hi"')).toBe('"say""hi"""')
  })

  it('treats an unclosed quote as one term running to the end', () => {
    expect(toFtsMatchQuery('"foo bar')).toBe('"""foo bar"')
  })

  it('leaves a lowercase operator word as a plain word', () => {
    expect(toFtsMatchQuery('foo or bar')).toBe('foo or bar')
  })

  it('returns an empty string for a blank query', () => {
    expect(toFtsMatchQuery('   ')).toBe('')
  })
})

describe('searches through toFtsMatchQuery', () => {
  let caseId: string

  beforeEach(async () => {
    await initDatabase(':memory:')
    caseId = createCase({ name: 'Search Case', description: '' }).id
  })

  afterEach(() => {
    closeDatabase()
  })

  function capture(textContent: string): string {
    return insertCapture({
      caseId,
      url: 'https://x.invalid/',
      title: 'T',
      hash: 'h',
      timestamp: '2026-01-01T00:00:00Z',
      textContent,
      format: 'mhtml'
    }).id
  }

  it('finds a Capture by a domain, an email address and a web address', () => {
    const id = capture(
      'Contact alice@example.org about example.com, see https://example.com/path for details'
    )
    capture('nothing relevant here')

    for (const query of ['example.com', 'alice@example.org', 'https://example.com/path']) {
      expect(searchCaptures(query, caseId).map((c) => c.id)).toEqual([id])
    }
  })

  it('keeps plain words, prefixes, phrases and OR returning what they did', () => {
    const exact = capture('an example of an exact phrase')
    const foo = capture('foo only')
    const bar = capture('bar only')
    const ids = (query: string) =>
      searchCaptures(query, caseId)
        .map((c) => c.id)
        .sort()

    expect(ids('example')).toEqual([exact])
    expect(ids('exam*')).toEqual([exact])
    expect(ids('"exact phrase"')).toEqual([exact])
    expect(ids('foo OR bar')).toEqual([foo, bar].sort())
  })

  it('still throws on a query left invalid after preparation', () => {
    capture('foo')
    expect(() => searchCaptures('foo AND', caseId)).toThrow()
  })

  it('finds a note containing a domain', () => {
    const note = createNote({ caseId, title: 'Lead', body: 'Registrant domain is example.com' })
    createNote({ caseId, title: 'Other', body: 'unrelated' })

    expect(searchNotes(caseId, 'example.com').map((n) => n.id)).toEqual([note.id])
  })
})
