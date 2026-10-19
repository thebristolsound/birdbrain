import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { closeDatabase, getDb, initDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture } from '@main/services/db/captureRepo'
import { insertExhibit } from '@main/services/db/exhibitRepo'
import { insertStagingFile } from '@main/services/db/stagingRepo'
import { createNote } from '@main/services/db/noteRepo'
import { createSelector, updateSelector } from '@main/services/db/selectorRepo'
import { insertExtractedData } from '@main/services/db/extractedDataRepo'
import { replaceExhibitFields, type FieldBuildOutcome } from '@main/services/db/searchFieldRepo'
import { listUnreviewedCaptures } from '@main/services/db/unreviewedRepo'
import { extractFields, type ExtractedField } from '@main/services/search/fieldExtractor'
import type { UnreviewedCaptures, UnreviewedRow } from '@shared/types'

// The unreviewed view's read (docs/plans/2026-10-09-case-retrieval-first-slice.md, D8),
// over an in-memory database and invented Captures. Every person and host is invented.

const HASH = 'c'.repeat(64)

let caseId: string

beforeEach(async () => {
  await initDatabase(':memory:')
  caseId = createCase({ name: 'Unreviewed' }).id
})

afterEach(() => {
  closeDatabase()
})

function capture(title: string, timestamp = '2026-10-01T00:00:00.000Z', inCase = caseId): string {
  return insertCapture({
    caseId: inCase,
    url: `https://${title.toLowerCase().replace(/\W+/g, '-')}.example.org/`,
    title,
    hash: HASH,
    timestamp,
    format: 'mhtml'
  }).id
}

function record(
  field: string,
  value: string,
  norm: string,
  startOffset = 0,
  source: ExtractedField['source'] = field.startsWith('header.') ? 'text' : 'html-part'
): ExtractedField {
  return {
    field,
    value,
    norm,
    source,
    part: source === 'text' ? null : 0,
    startOffset,
    endOffset: startOffset + value.length
  }
}

function build(
  exhibitId: string,
  fields: ExtractedField[],
  {
    outcome = 'built',
    contentHash = HASH,
    extractor = 'fields/1'
  }: { outcome?: FieldBuildOutcome; contentHash?: string; extractor?: string } = {}
): void {
  replaceExhibitFields(
    {
      exhibitId,
      caseId,
      contentHash,
      textHash: null,
      extractor,
      builtAt: '2026-10-01T00:00:00.000Z',
      outcome,
      skippedJson: outcome === 'partial' ? '{"tooLarge":1}' : null
    },
    fields
  )
}

const FROM = record(
  'header.from',
  'Wren Hollis <wren@hollis-mail.example.org>',
  'wren@hollis-mail.example.org'
)

function list(limit = 2): UnreviewedCaptures {
  return listUnreviewedCaptures(caseId, limit)
}

function keys(rows: UnreviewedRow[]): string[] {
  return rows.map((row) => row.key)
}

function listed(rows: UnreviewedRow[], key: string): string[] {
  return rows.find((row) => row.key === key)?.captures.map((c) => c.exhibitId) ?? []
}

function docOf(captureId: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'mention', attrs: { targetType: 'capture', targetId: captureId, label: 'x' } }
        ]
      }
    ]
  })
}

function tombstone(noteId: string): void {
  getDb()
    .prepare("UPDATE notes SET deleted_at = '2026-10-02T00:00:00.000Z' WHERE id = ?")
    .run(noteId)
}

describe('listUnreviewedCaptures: which Captures are unreviewed', () => {
  it('lists a committed Capture that no Note names and no Persisted Match covers', () => {
    const id = capture('Notice')
    build(id, [FROM])
    const result = list()
    expect(result).toMatchObject({ captures: 1, total: 1, ungrouped: 0, notCurrent: 0, partial: 0 })
    expect(listed(result.groups.from, 'wren@hollis-mail.example.org')).toEqual([id])
  })

  const anchors: Array<[string, (captureId: string) => string]> = [
    ['capture', (captureId) => JSON.stringify({ kind: 'capture', captureId })],
    [
      'region',
      (captureId) =>
        JSON.stringify({
          kind: 'region',
          captureId,
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          imageWidth: 100,
          imageHeight: 100
        })
    ],
    [
      'text',
      (captureId) =>
        JSON.stringify({
          kind: 'text',
          captureId,
          quote: 'notice',
          prefix: '',
          suffix: '',
          textOffset: 0
        })
    ],
    [
      'finding on extracted data',
      (captureId) =>
        JSON.stringify({
          kind: 'finding',
          finding: 'extractedData',
          captureId,
          category: 'Infrastructure',
          subcategory: 'Email Address',
          value: 'wren@hollis-mail.example.org'
        })
    ],
    [
      'finding on a Selector match',
      (captureId) =>
        JSON.stringify({
          kind: 'finding',
          finding: 'selectorMatch',
          captureId,
          selectorId: createSelector({ caseId, pattern: 'notice', isRegex: false }).id
        })
    ]
  ]

  const namings: Array<[string, (captureId: string) => string]> = [
    ['notes.capture_id', (captureId) => createNote({ caseId, captureId, title: 'Read' }).id],
    ...anchors.map(([kind, anchor]): [string, (captureId: string) => string] => [
      `an anchor of kind ${kind}`,
      (captureId) => createNote({ caseId, title: 'Read', anchor: anchor(captureId) }).id
    ]),
    ['a mention', (captureId) => createNote({ caseId, bodyDoc: docOf(captureId) }).id]
  ]

  it.each(namings)('a live Note naming it through %s removes it', (_, name) => {
    const id = capture('Notice')
    name(id)
    expect(list()).toMatchObject({ captures: 1, total: 0 })
  })

  it.each(namings)('a Note naming it through %s with deleted_at set does not', (_, name) => {
    const id = capture('Notice')
    tombstone(name(id))
    expect(list()).toMatchObject({ captures: 1, total: 1 })
  })

  it('a mention lands in note_references as a capture row', () => {
    const id = capture('Notice')
    const noteId = createNote({ caseId, bodyDoc: docOf(id) }).id
    expect(
      getDb()
        .prepare('SELECT target_type, target_id FROM note_references WHERE note_id = ?')
        .all(noteId)
    ).toEqual([{ target_type: 'capture', target_id: id }])
  })

  it('a Persisted Match removes it, also once its Selector is disabled', () => {
    const id = capture('Notice')
    const selector = createSelector({ caseId, pattern: 'notice', isRegex: false })
    getDb()
      .prepare('INSERT INTO selector_matches (selector_id, capture_id) VALUES (?, ?)')
      .run(selector.id, id)
    expect(list().total).toBe(0)
    updateSelector({ id: selector.id, enabled: false })
    expect(list().total).toBe(0)
  })

  it("keeps a Capture whose id is quoted in another Capture's text anchor", () => {
    const quoted = capture('Quoted')
    const anchored = capture('Anchored')
    build(quoted, [FROM])
    createNote({
      caseId,
      anchor: JSON.stringify({
        kind: 'text',
        captureId: anchored,
        quote: `see ${quoted}`,
        prefix: '',
        suffix: '',
        textOffset: 0
      })
    })
    const result = list()
    expect(result.total).toBe(1)
    expect(listed(result.groups.from, FROM.norm)).toEqual([quoted])
  })

  it('names nothing through a malformed anchor, and still reads', () => {
    capture('Notice')
    const noteId = createNote({ caseId, title: 'Read' }).id
    getDb().prepare("UPDATE notes SET anchor_json = '{not json' WHERE id = ?").run(noteId)
    expect(list()).toMatchObject({ total: 1 })
  })

  it('never lists a pooled file, an Exhibit committed from the pool, or another Case', () => {
    insertStagingFile({
      caseId,
      kind: 'document',
      origin: 'upload',
      name: 'statement.pdf',
      contentHash: 'd'.repeat(64),
      path: 'staging/statement.pdf',
      sizeBytes: 10,
      arrivedAt: '2026-10-01T00:00:00.000Z'
    })
    insertExhibit({
      id: 'doc-1',
      caseId,
      kind: 'document',
      origin: 'upload',
      name: 'ledger.pdf',
      contentHash: 'e'.repeat(64),
      committedAt: '2026-10-01T00:00:00.000Z'
    })
    const otherCase = createCase({ name: 'Other' }).id
    capture('Elsewhere', undefined, otherCase)
    expect(list()).toMatchObject({ captures: 0, total: 0 })
  })
})

describe('listUnreviewedCaptures: groups', () => {
  it('groups From and Reply-To by the bare address, one row per address', () => {
    const a = capture('A', '2026-10-01T00:00:00.000Z')
    const b = capture('B', '2026-10-02T00:00:00.000Z')
    build(a, [
      FROM,
      record('header.from', 'wren@hollis-mail.example.org', 'wren@hollis-mail.example.org', 80),
      record('header.reply-to', '<Pay@Corvane.example.net>', 'pay@corvane.example.net', 120)
    ])
    build(b, [
      record(
        'header.from',
        'W. Hollis <WREN@Hollis-Mail.example.org>',
        'wren@hollis-mail.example.org'
      ),
      record('header.reply-to', 'pay@corvane.example.net', 'pay@corvane.example.net', 40)
    ])
    const { groups } = list()
    expect(keys(groups.from)).toEqual(['wren@hollis-mail.example.org'])
    expect(keys(groups['reply-to'])).toEqual(['pay@corvane.example.net'])
    // Newest first.
    expect(listed(groups.from, 'wren@hollis-mail.example.org')).toEqual([b, a])
    const hitA = groups.from[0].captures.find((c) => c.exhibitId === a)!.hit!
    expect(hitA).toMatchObject({
      caseId,
      exhibitId: a,
      field: 'header.from',
      norm: 'wren@hollis-mail.example.org',
      preview: FROM.value,
      occurrences: 2,
      contentHash: HASH,
      locator: {
        source: 'text',
        part: null,
        startOffset: 0,
        endOffset: FROM.value.length,
        extractor: 'fields/1'
      }
    })
    const firstId = getDb()
      .prepare(
        "SELECT MIN(id) AS id FROM exhibit_search_fields WHERE exhibit_id = ? AND field = 'header.from'"
      )
      .get(a) as { id: number }
    expect(hitA.fieldId).toBe(firstId.id)
    expect(groups.from[0].captures.find((c) => c.exhibitId === b)!.hit!.occurrences).toBe(1)
  })

  it('groups links by host, once per Capture, at its first record with that host', () => {
    const id = capture('Links')
    build(id, [
      record('link.href', '/a', 'https://Mail.Example.org/a', 10),
      record('link.href', '/b', 'https://mail.example.org/b', 30),
      record('link.href', 'https://www.mail.example.org/', 'https://www.mail.example.org/', 50),
      record('link.href', 'mailto:x@mail.example.org', 'mailto:x@mail.example.org', 70),
      record('link.href', 'http://[bad', 'http://[bad', 90),
      record('link.alt', 'Pay here', 'Pay here', 110)
    ])
    const { groups, ungrouped } = list()
    expect(keys(groups['link-host'])).toEqual(['mail.example.org', 'www.mail.example.org'])
    const row = groups['link-host'][0]
    expect(row.captures).toHaveLength(1)
    expect(row.captures[0].hit).toMatchObject({
      field: 'link.href',
      norm: 'https://Mail.Example.org/a',
      occurrences: 1,
      locator: { source: 'html-part', part: 0, startOffset: 10 }
    })
    expect(ungrouped).toBe(0)
  })

  it('reads only From, Reply-To and link targets from a fields/2 build', () => {
    const id = capture('Fields two')
    // A page and Extracted Text that the extractor at head reads every kind from, written
    // through the same call the field build uses.
    const text = [
      'From: Wren Hollis <wren@hollis-mail.example.org>',
      'Reply-To: pay@corvane.example.net',
      'To: desk@ostrander.example.net',
      'Cc: cc@ostrander.example.net',
      'Message-ID: <1@hollis-mail.example.org>',
      'Path: news.example.org!not-for-mail',
      'References: <0@hollis-mail.example.org>',
      '',
      'Write to remit@larch.example.org or see https://ledger.example.org/pay'
    ].join('\n')
    const html = [
      '<html><body><a href="https://mail.example.org/a">',
      '<img src="https://cdn.example.net/a.png" alt="Pay"></a>',
      `<p>GTM-QX4R7T 0x${'ab12cd34ef'.repeat(4)}</p></body></html>`
    ].join('')
    const { fields } = extractFields({
      captureUrl: 'https://brindle-forum.example.org/thread/88',
      mhtml: null,
      html: Buffer.from(html),
      text
    })
    const kinds = new Set(fields.map((f) => f.field))
    for (const kind of [
      'header.to',
      'header.cc',
      'header.path',
      'header.references',
      'image.src',
      'text.address',
      'text.url',
      'id.tracking',
      'id.crypto'
    ]) {
      expect(kinds, kind).toContain(kind)
    }
    build(id, fields, { extractor: 'fields/2' })
    const { groups, ungrouped } = list()
    expect(keys(groups.from)).toEqual(['wren@hollis-mail.example.org'])
    expect(keys(groups['reply-to'])).toEqual(['pay@corvane.example.net'])
    expect(keys(groups['link-host'])).toEqual(['mail.example.org'])
    expect(groups.rare).toEqual([])
    expect(ungrouped).toBe(0)
    const hits = Object.values(groups).flatMap((rows) =>
      rows.flatMap((row) => row.captures.map((c) => c.hit!))
    )
    expect(new Set(hits.map((hit) => hit.field))).toEqual(
      new Set(['header.from', 'header.reply-to', 'link.href'])
    )
    // The From address is also a `text.address` record; the row counts the header only.
    expect(hits.find((hit) => hit.field === 'header.from')).toMatchObject({
      occurrences: 1,
      locator: { source: 'text', extractor: 'fields/2' }
    })
  })

  it('leaves out of the header and link rows a Capture whose records are not current', () => {
    const changed = capture('Changed')
    const missing = capture('Missing')
    const failed = capture('Failed')
    const noSource = capture('No source')
    const partial = capture('Partial')
    build(changed, [FROM], { contentHash: 'f'.repeat(64) })
    build(failed, [], { outcome: 'failed' })
    build(noSource, [], { outcome: 'no-source' })
    build(partial, [FROM], { outcome: 'partial' })
    const result = list()
    // `missing` has no build row at all.
    expect(missing).not.toBe(partial)
    expect(result).toMatchObject({ total: 5, notCurrent: 4, partial: 1, ungrouped: 4 })
    expect(listed(result.groups.from, FROM.norm)).toEqual([partial])
  })

  it('lists rare emails and accounts by how many Captures of the Case hold them', () => {
    const unreviewed = capture('Unreviewed')
    const reviewed = capture('Reviewed')
    const third = capture('Third')
    createNote({ caseId, captureId: reviewed })
    createNote({ caseId, captureId: third })
    const email = (value: string) => ({
      category: 'Infrastructure',
      subcategory: 'Email Address',
      value
    })
    insertExtractedData(unreviewed, caseId, 'u', [
      email('pair@larch.example.org'),
      email('three@larch.example.org'),
      { category: 'Accounts', subcategory: 'GitHub', value: 'wrenhollis' },
      { category: 'Infrastructure', subcategory: 'Domain Reference', value: 'larch.example.org' },
      { category: 'Infrastructure', subcategory: 'IPv4 Address', value: '198.51.100.23' }
    ])
    insertExtractedData(reviewed, caseId, 'r', [
      email('pair@larch.example.org'),
      email('three@larch.example.org')
    ])
    insertExtractedData(third, caseId, 't', [email('three@larch.example.org')])

    const two = list(2).groups.rare
    expect(two.map((row) => [row.identifier?.subcategory, row.key, row.caseCaptures])).toEqual([
      ['Email Address', 'pair@larch.example.org', 2],
      ['GitHub', 'wrenhollis', 1]
    ])
    expect(
      two.every((row) => row.captures.every((c) => c.exhibitId === unreviewed && c.hit === null))
    ).toBe(true)
    expect(keys(list(1).groups.rare)).toEqual(['wrenhollis'])
    expect(keys(list(3).groups.rare)).toEqual([
      'pair@larch.example.org',
      'three@larch.example.org',
      'wrenhollis'
    ])
  })

  it('counts the Captures in no row, and orders rows fewest first, then by key', () => {
    const a = capture('A', '2026-10-01T00:00:00.000Z')
    const b = capture('B', '2026-10-01T00:00:00.000Z')
    const lone = capture('Lone', '2026-10-03T00:00:00.000Z')
    build(a, [record('link.href', 'x', 'https://zeta.example.org/', 0)])
    build(b, [
      record('link.href', 'x', 'https://zeta.example.org/', 0),
      record('link.href', 'y', 'https://beta.example.org/', 20),
      record('link.href', 'z', 'https://alpha.example.org/', 40)
    ])
    build(lone, [])
    const result = list()
    expect(result).toMatchObject({ total: 3, ungrouped: 1 })
    expect(keys(result.groups['link-host'])).toEqual([
      'alpha.example.org',
      'beta.example.org',
      'zeta.example.org'
    ])
    // Same capture time: by id.
    expect(listed(result.groups['link-host'], 'zeta.example.org')).toEqual([a, b].sort())
  })
})

describe('listUnreviewedCaptures: limit and writes', () => {
  it.each([0, -1, 1.5, Number.NaN])('refuses a limit of %s', (limit) => {
    expect(() => listUnreviewedCaptures(caseId, limit)).toThrow(RangeError)
  })

  it('writes nothing', () => {
    const id = capture('Notice')
    build(id, [FROM])
    createNote({ caseId, title: 'Elsewhere' })
    insertExtractedData(id, caseId, 'u', [
      {
        category: 'Infrastructure',
        subcategory: 'Email Address',
        value: 'wren@hollis-mail.example.org'
      }
    ])
    const counts = () =>
      Object.fromEntries(
        (
          getDb()
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            )
            .all() as Array<{ name: string }>
        ).map(({ name }) => [
          name,
          (getDb().prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n
        ])
      )
    const before = counts()
    list()
    expect(counts()).toEqual(before)
  })
})
