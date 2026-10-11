/**
 * #1590: a search for a domain, an email address or a web address used to be
 * an FTS5 syntax error. These pin the preparing function's rules and the two
 * searches that use it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture, searchCaptures } from '@main/services/db/captureRepo'
import { createNote, searchNotes } from '@main/services/db/noteRepo'
import { toFtsMatchQuery } from '@main/services/db/ftsQuery'

const COLUMNS = ['title', 'url', 'content']
const prepare = (query: string) => toFtsMatchQuery(query, COLUMNS)

describe('toFtsMatchQuery', () => {
  it('leaves plain words, prefixes, quoted phrases and operators unchanged', () => {
    for (const query of [
      'example',
      'exam*',
      '"exact phrase"',
      'foo OR bar',
      'foo AND bar',
      'foo NOT bar',
      'foo or bar',
      'snake_case 2026',
      'café 東京',
      '"phrase prefix"*',
      '"say ""hi"""',
      'say"hi"',
      '  spaced   out  '
    ]) {
      expect(prepare(query)).toBe(query)
    }
  })

  // Every query here is one FTS5 can read, valid or not, so its result or its
  // error is the same as before the query was prepared.
  it('leaves explicit FTS5 syntax unchanged', () => {
    for (const query of [
      'title:acme',
      'URL:acme',
      'content:fraud',
      '-title:acme',
      'acme-title:acme',
      '{title url}:acme',
      '- {title}:acme',
      'acme-{title}:acme',
      'title:"exact phrase"',
      'NEAR(acme fraud)',
      'NEAR(acme fraud, 2)',
      '(acme OR beta) AND fraud',
      'acme + fraud',
      'acme+fraud',
      '^acme',
      'foo AND',
      'acme -fraud',
      'acme - fraud',
      'c++',
      '   '
    ]) {
      expect(prepare(query)).toBe(query)
    }
  })

  it('searches a word holding a character FTS5 cannot read as a phrase', () => {
    expect(prepare('example.com')).toBe('"example.com"')
    expect(prepare('alice@example.org')).toBe('"alice@example.org"')
    expect(prepare('https://example.com/path')).toBe('"https://example.com/path"')
    expect(prepare('10:30.')).toBe('"10:30."')
    expect(prepare('acme\ffraud')).toBe('"acme\ffraud"')
  })

  it('searches a hyphenated word as a phrase', () => {
    expect(prepare('well-known')).toBe('"well-known"')
    expect(prepare('2026-10-11')).toBe('"2026-10-11"')
    expect(prepare('acme-title')).toBe('"acme-title"')
    expect(prepare('-title:well-known')).toBe('-title:"well-known"')
  })

  it('quotes only the punctuated word inside surrounding syntax', () => {
    expect(prepare('acme OR example.com')).toBe('acme OR "example.com"')
    expect(prepare('  example.com   exam*  ')).toBe('  "example.com"   exam*  ')
    expect(prepare('url:https://example.com')).toBe('url:"https://example.com"')
    expect(prepare('-Title:example.com')).toBe('-Title:"example.com"')
    expect(prepare('{title url}:example.com')).toBe('{title url}:"example.com"')
    expect(prepare('NEAR(example.com acme, 2)')).toBe('NEAR("example.com" acme, 2)')
    expect(prepare('(example.com OR acme)')).toBe('("example.com" OR acme)')
    expect(prepare('example.com*')).toBe('"example.com"*')
    expect(prepare('title:example.com*')).toBe('title:"example.com"*')
  })

  it('does not read a word that only looks like a column filter as one', () => {
    expect(prepare('body:example.com')).toBe('"body:example.com"')
    expect(toFtsMatchQuery('body:example.com', ['title', 'body'])).toBe('body:"example.com"')
  })

  it('doubles an embedded double quote when an unclosed quote becomes a phrase', () => {
    expect(prepare('"foo bar')).toBe('"""foo bar"')
    expect(prepare('acme "fo""o')).toBe('acme """fo""""o"')
  })

  it('keeps a rewritten word apart from a quote that follows or precedes it', () => {
    expect(prepare('example.com"x"')).toBe('"example.com" "x"')
    expect(prepare('"x"example.com')).toBe('"x" "example.com"')
    expect(prepare('example.com"x')).toBe('"example.com" """x"')
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

  it('keeps column filters, NEAR groups and parentheses working', () => {
    const titled = insertCapture({
      caseId,
      url: 'https://x.invalid/',
      title: 'acme',
      hash: 'h',
      timestamp: '2026-01-01T00:00:00Z',
      textContent: 'unrelated',
      format: 'mhtml'
    }).id
    const near = capture('acme fraud at example.com')
    const far = capture('acme one two three four fraud')
    const beta = capture('beta only')
    const ids = (query: string) =>
      searchCaptures(query, caseId)
        .map((c) => c.id)
        .sort()

    expect(ids('title:acme')).toEqual([titled])
    expect(ids('-title:acme')).toEqual([near, far].sort())
    expect(ids('{title url}:acme')).toEqual([titled])
    expect(ids('NEAR(acme fraud, 2)')).toEqual([near])
    expect(ids('(acme OR beta) AND fraud')).toEqual([near, far].sort())
    expect(ids('content:example.com')).toEqual([near])
    expect(ids('NEAR(example.com acme, 3)')).toEqual([near])
    expect(ids('beta')).toEqual([beta])
  })

  // The rewrite only touches queries FTS5 refuses outright, so no search that
  // ran before returns anything different.
  it('rewrites only queries that FTS5 rejects as written', () => {
    capture('anything')
    const raw = getDb().prepare('SELECT rowid FROM captures_fts WHERE captures_fts MATCH ?')
    for (const query of [
      'example.com',
      'alice@example.org',
      'https://example.com/path',
      '10:30.',
      'well-known',
      '2026-10-11',
      'acme-title',
      'url:https://example.com',
      'example.com*',
      '"foo bar',
      'example.com"x"'
    ]) {
      expect(toFtsMatchQuery(query, ['title', 'url', 'content'])).not.toBe(query)
      expect(() => raw.all(query)).toThrow()
    }
  })

  it('still throws on a query left invalid after preparation', () => {
    capture('foo')
    expect(() => searchCaptures('foo AND', caseId)).toThrow()
  })

  // A leading minus is not an exclusion in FTS5. Quoting it would quietly
  // return the Captures the operator meant to leave out, so it still fails.
  it('still throws on a web-style exclusion rather than matching the excluded word', () => {
    capture('acme fraud')
    expect(() => searchCaptures('acme -fraud', caseId)).toThrow()
    expect(() => searchCaptures('acme - fraud', caseId)).toThrow()
  })

  it('finds a Capture by a hyphenated word', () => {
    const id = capture('a well-known registrant')
    capture('well and known apart')
    expect(searchCaptures('well-known', caseId).map((c) => c.id)).toEqual([id])
  })

  it('finds a note containing a domain', () => {
    const note = createNote({ caseId, title: 'Lead', body: 'Registrant domain is example.com' })
    createNote({ caseId, title: 'Other', body: 'unrelated' })

    expect(searchNotes(caseId, 'example.com').map((n) => n.id)).toEqual([note.id])
  })

  it('keeps a column filter on the notes search', () => {
    const note = createNote({ caseId, title: 'example.com lead', body: 'see title' })
    createNote({ caseId, title: 'Other', body: 'mentions example.com' })

    expect(searchNotes(caseId, 'title:example.com').map((n) => n.id)).toEqual([note.id])
  })
})
