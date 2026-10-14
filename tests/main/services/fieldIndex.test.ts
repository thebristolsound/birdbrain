import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { closeDatabase, getDb, initDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture } from '@main/services/db/captureRepo'
import * as searchFieldRepo from '@main/services/db/searchFieldRepo'
import { getExhibitSearchBuild, searchCaseFields } from '@main/services/db/searchFieldRepo'
import {
  buildExhibitFields,
  ensureCaseFields,
  rebuildAllFields,
  rebuildCaseFields
} from '@main/services/search/fieldIndex'
import { FIELD_EXTRACTOR_VERSION } from '@main/services/search/fieldExtractor'
import { listHtmlPartsInMhtml } from '@main/services/mhtmlDecoder'
import {
  disposeLogger,
  flushSync as flushLogger,
  initLogger,
  readRecentEntries
} from '@main/services/logger'

// The Case search field build service (docs/plans/2026-10-09-case-retrieval-first-
// slice.md, D5), over an in-memory database and a store of invented files.

const PAGE_URL = 'https://quillmere-gazette.example.net/notices/14'

function mhtml(html: string): Buffer {
  return Buffer.from(
    [
      'From: <Saved by Blink>',
      `Snapshot-Content-Location: ${PAGE_URL}`,
      'MIME-Version: 1.0',
      'Content-Type: multipart/related; type="text/html"; boundary="B"',
      '',
      '--B',
      'Content-Type: text/html',
      'Content-Transfer-Encoding: binary',
      `Content-Location: ${PAGE_URL}`,
      '',
      html,
      '--B--',
      ''
    ].join('\r\n'),
    'utf8'
  )
}

const PAGE = mhtml(
  '<html><body><a href="/contact">Contact</a>' +
    '<a href="https://Tollgate-Ledger.example.com/pay"><img alt="Pay  here"></a></body></html>'
)
const TEXT = 'Show original\nFrom: Wren Hollis <wren@Hollis-Mail.example.org>\nMessage-ID: <a1@x>\n'

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

type Files = Map<string, Buffer>

function storeOf(files: Files) {
  return {
    readArtifact: (_caseId: string, captureId: string, type: string) =>
      files.get(`${captureId}.${type}`) ?? null
  }
}

function capture(caseId: string, timestamp = '2026-10-01T00:00:00.000Z'): string {
  return insertCapture({
    caseId,
    url: PAGE_URL,
    title: 'Notice',
    hash: 'c'.repeat(64),
    timestamp,
    format: 'mhtml'
  }).id
}

function fieldRows(exhibitId: string) {
  return getDb()
    .prepare(
      `SELECT field, value, norm, source, part, start_offset AS startOffset,
              end_offset AS endOffset
         FROM exhibit_search_fields WHERE exhibit_id = ? ORDER BY id`
    )
    .all(exhibitId) as Array<{
    field: string
    value: string
    norm: string
    source: string
    part: number | null
    startOffset: number
    endOffset: number
  }>
}

function matches(query: string): number {
  return (
    getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM exhibit_search_fields_fts
          WHERE exhibit_search_fields_fts MATCH ?`
      )
      .get(query) as { n: number }
  ).n
}

function expectIndexInStep(): void {
  expect(() =>
    getDb()
      .prepare(
        "INSERT INTO exhibit_search_fields_fts(exhibit_search_fields_fts) VALUES ('integrity-check')"
      )
      .run()
  ).not.toThrow()
}

function loggedCodes(): string[] {
  flushLogger()
  return readRecentEntries(50).map((entry) => `${entry.source}:${entry.code}`)
}

let tempDir: string
let caseId: string

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'bb-field-index-'))
  await initDatabase(':memory:')
  initLogger(tempDir, 'field-index-test-session')
  caseId = createCase({ name: 'Field index' }).id
})

afterEach(() => {
  vi.restoreAllMocks()
  disposeLogger()
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('buildExhibitFields', () => {
  it('records link and header fields with the hashes they were built from', () => {
    const id = capture(caseId)
    const files: Files = new Map([
      [`${id}.mhtml`, PAGE],
      [`${id}.txt`, Buffer.from(TEXT, 'utf-8')]
    ])

    expect(buildExhibitFields(id, storeOf(files))).toBe('built')

    expect(getExhibitSearchBuild(id)).toMatchObject({
      exhibitId: id,
      caseId,
      contentHash: 'c'.repeat(64),
      textHash: sha256(Buffer.from(TEXT, 'utf-8')),
      extractor: FIELD_EXTRACTOR_VERSION,
      outcome: 'built',
      skippedJson: null
    })
    const rows = fieldRows(id)
    expect(rows.map(({ field, norm }) => ({ field, norm }))).toEqual([
      { field: 'header.from', norm: 'wren@hollis-mail.example.org' },
      { field: 'header.message-id', norm: '<a1@x>' },
      { field: 'link.href', norm: 'https://quillmere-gazette.example.net/contact' },
      { field: 'link.href', norm: 'https://tollgate-ledger.example.com/pay' },
      { field: 'link.alt', norm: 'Pay here' }
    ])
    const decoded = listHtmlPartsInMhtml(PAGE).parts[0].decode()
    for (const row of rows) {
      const source = row.source === 'text' ? TEXT : decoded
      expect(source.slice(row.startOffset, row.endOffset)).toBe(row.value)
    }
    expect(matches('"tollgate-ledger.example"')).toBe(1)
    expectIndexInStep()
  })

  it('reads a legacy Capture from its .html file as part 0', () => {
    const id = capture(caseId)
    const html = '<a href="https://ashgrove.example.org/">Ashgrove</a>'
    const files: Files = new Map([[`${id}.html`, Buffer.from(html, 'utf8')]])

    expect(buildExhibitFields(id, storeOf(files))).toBe('built')

    expect(getExhibitSearchBuild(id)?.textHash).toBeNull()
    expect(fieldRows(id)).toEqual([
      {
        field: 'link.href',
        value: 'https://ashgrove.example.org/',
        norm: 'https://ashgrove.example.org/',
        source: 'html-part',
        part: 0,
        startOffset: 9,
        endOffset: 38
      }
    ])
  })

  it('writes a no-source row and logs it when the stored page is not found', () => {
    const id = capture(caseId)
    const files: Files = new Map([[`${id}.txt`, Buffer.from(TEXT, 'utf-8')]])

    expect(buildExhibitFields(id, storeOf(files))).toBe('no-source')

    expect(getExhibitSearchBuild(id)).toMatchObject({ outcome: 'no-source', textHash: null })
    expect(fieldRows(id)).toEqual([])
    expect(loggedCodes()).toContain('searchFields:searchFields.source_missing')
  })

  it('records what the budgets refused as a partial build', () => {
    const id = capture(caseId)
    const parts = Array.from({ length: 65 }, (_, i) => [
      '--B',
      'Content-Type: text/html',
      `Content-Location: https://frames.example.org/${i}`,
      '',
      `<a href="https://frames.example.org/link/${i}">${i}</a>`
    ])
    const big = Buffer.from(
      [
        'MIME-Version: 1.0',
        'Content-Type: multipart/related; type="text/html"; boundary="B"',
        '',
        ...parts.flat(),
        '--B--',
        ''
      ].join('\r\n')
    )

    expect(buildExhibitFields(id, storeOf(new Map([[`${id}.mhtml`, big]])))).toBe('partial')

    const build = getExhibitSearchBuild(id)
    expect(JSON.parse(build?.skippedJson ?? 'null')).toEqual({
      tooLarge: 0,
      overPartCount: 1,
      overTotalSize: 0,
      mainDocumentSkipped: false,
      truncated: false
    })
    expect(fieldRows(id)).toHaveLength(64)
  })

  it('writes a failed build row and logs it when reading the files throws', () => {
    const id = capture(caseId)
    const store = {
      readArtifact: () => {
        throw new Error('disk gone')
      }
    }

    expect(buildExhibitFields(id, store)).toBe('failed')

    expect(getExhibitSearchBuild(id)).toMatchObject({
      outcome: 'failed',
      contentHash: 'c'.repeat(64),
      extractor: FIELD_EXTRACTOR_VERSION
    })
    expect(loggedCodes()).toContain('searchFields:searchFields.build_failed')
  })

  it('replaces the earlier build rather than adding to it', () => {
    const id = capture(caseId)
    const files: Files = new Map([[`${id}.mhtml`, PAGE]])
    buildExhibitFields(id, storeOf(files))
    files.set(`${id}.mhtml`, mhtml('<a href="https://later.example.org/">Later</a>'))

    buildExhibitFields(id, storeOf(files))

    expect(fieldRows(id).map((row) => row.norm)).toEqual(['https://later.example.org/'])
    expect(matches('"tollgate"')).toBe(0)
    expectIndexInStep()
  })

  it('returns null for a Capture that is not there', () => {
    expect(buildExhibitFields('00000000-0000-4000-8000-000000000000', storeOf(new Map()))).toBe(
      null
    )
  })
})

describe('ensureCaseFields', () => {
  it('builds only the Captures with no build row or an older extractor', async () => {
    const fresh = capture(caseId, '2026-10-03T00:00:00.000Z')
    const current = capture(caseId, '2026-10-02T00:00:00.000Z')
    const older = capture(caseId, '2026-10-01T00:00:00.000Z')
    const other = capture(createCase({ name: 'Other' }).id)
    const store = storeOf(new Map([fresh, current, older].map((id) => [`${id}.mhtml`, PAGE])))
    buildExhibitFields(current, store)
    buildExhibitFields(older, store)
    getDb()
      .prepare("UPDATE exhibit_search_builds SET extractor = 'fields/0' WHERE exhibit_id = ?")
      .run(older)
    const builtAt = getExhibitSearchBuild(current)?.builtAt
    const replace = vi.spyOn(searchFieldRepo, 'replaceExhibitFields')

    expect(await ensureCaseFields(caseId, store)).toEqual({ indexed: 2, noSource: 0, failed: 0 })

    expect(replace.mock.calls.map(([build]) => build.exhibitId)).toEqual([fresh, older])
    expect(getExhibitSearchBuild(older)?.extractor).toBe(FIELD_EXTRACTOR_VERSION)
    expect(getExhibitSearchBuild(current)?.builtAt).toBe(builtAt)
    expect(getExhibitSearchBuild(other)).toBeUndefined()
    expect(await ensureCaseFields(caseId, store)).toEqual({ indexed: 0, noSource: 0, failed: 0 })
  })

  it('does not retry a failed build on the next pass', async () => {
    const id = capture(caseId)
    const failing = {
      readArtifact: () => {
        throw new Error('disk gone')
      }
    }

    expect(await ensureCaseFields(caseId, failing)).toEqual({ indexed: 0, noSource: 0, failed: 1 })
    expect(await ensureCaseFields(caseId, storeOf(new Map()))).toEqual({
      indexed: 0,
      noSource: 0,
      failed: 0
    })
    expect(getExhibitSearchBuild(id)?.outcome).toBe('failed')
  })

  it('tries a Capture whose page was not found again, and builds it once the page is back', async () => {
    const id = capture(caseId)
    const files: Files = new Map()

    expect(await ensureCaseFields(caseId, storeOf(files))).toEqual({
      indexed: 0,
      noSource: 1,
      failed: 0
    })
    files.set(`${id}.mhtml`, PAGE)
    expect(await ensureCaseFields(caseId, storeOf(files))).toEqual({
      indexed: 1,
      noSource: 0,
      failed: 0
    })

    expect(getExhibitSearchBuild(id)?.outcome).toBe('built')
    expect(matches('"tollgate-ledger.example"')).toBe(1)
  })

  it('joins the pass already running for the Case', async () => {
    const id = capture(caseId)
    const store = storeOf(new Map([[`${id}.mhtml`, PAGE]]))

    const first = ensureCaseFields(caseId, store)
    const second = ensureCaseFields(caseId, store)

    expect(second).toBe(first)
    expect(await first).toEqual({ indexed: 1, noSource: 0, failed: 0 })
    const third = ensureCaseFields(caseId, store)
    expect(third).not.toBe(first)
    expect(await third).toEqual({ indexed: 0, noSource: 0, failed: 0 })
  })

  it('counts and logs a Capture whose build the database refuses, and goes on', async () => {
    const refused = capture(caseId, '2026-10-02T00:00:00.000Z')
    const next = capture(caseId, '2026-10-01T00:00:00.000Z')
    const replace = searchFieldRepo.replaceExhibitFields
    vi.spyOn(searchFieldRepo, 'replaceExhibitFields').mockImplementation((build, fields) => {
      if (build.exhibitId === refused) throw new Error('database is locked')
      replace(build, fields)
    })

    expect(await ensureCaseFields(caseId, storeOf(new Map()))).toEqual({
      indexed: 0,
      noSource: 1,
      failed: 1
    })

    expect(getExhibitSearchBuild(refused)).toBeUndefined()
    expect(getExhibitSearchBuild(next)?.outcome).toBe('no-source')
    expect(loggedCodes()).toContain('searchFields:searchFields.build_failed')
  })

  it('rejects when the Case cannot be listed, and the next call starts a new pass', async () => {
    vi.spyOn(searchFieldRepo, 'listExhibitsNeedingFields').mockImplementationOnce(() => {
      throw new Error('database is locked')
    })

    await expect(ensureCaseFields(caseId, storeOf(new Map()))).rejects.toThrow('locked')
    expect(await ensureCaseFields(caseId, storeOf(new Map()))).toEqual({
      indexed: 0,
      noSource: 0,
      failed: 0
    })
  })
})

describe('rebuildCaseFields', () => {
  it("builds every Capture in the Case again, failed builds included, and no other Case's", async () => {
    const failed = capture(caseId, '2026-10-02T00:00:00.000Z')
    const built = capture(caseId, '2026-10-01T00:00:00.000Z')
    const other = capture(createCase({ name: 'Other' }).id)
    buildExhibitFields(failed, {
      readArtifact: () => {
        throw new Error('disk gone')
      }
    })
    buildExhibitFields(built, storeOf(new Map()))
    const replace = vi.spyOn(searchFieldRepo, 'replaceExhibitFields')
    const files: Files = new Map([
      [`${failed}.mhtml`, PAGE],
      [`${built}.mhtml`, PAGE],
      [`${built}.txt`, Buffer.from(TEXT, 'utf8')]
    ])

    expect(await rebuildCaseFields(caseId, storeOf(files))).toEqual({
      indexed: 2,
      noSource: 0,
      failed: 0
    })

    expect(replace.mock.calls.map(([build]) => build.exhibitId)).toEqual([failed, built])
    expect(getExhibitSearchBuild(failed)?.outcome).toBe('built')
    expect(getExhibitSearchBuild(built)?.outcome).toBe('built')
    expect(getExhibitSearchBuild(other)).toBeUndefined()
  })
})

describe('rebuildAllFields', () => {
  it('builds each Capture in every Case again, failed builds included', async () => {
    const other = createCase({ name: 'Other' }).id
    const a = capture(caseId)
    const b = capture(other)
    buildExhibitFields(a, {
      readArtifact: () => {
        throw new Error('disk gone')
      }
    })
    getDb()
      .prepare(
        `INSERT INTO exhibit_search_builds
           (exhibit_id, case_id, content_hash, extractor, built_at, outcome)
         VALUES (?, ?, ?, ?, '2026-10-01T00:00:00.000Z', 'built')`
      )
      .run(b, other, 'c'.repeat(64), FIELD_EXTRACTOR_VERSION)
    getDb()
      .prepare(
        `INSERT INTO exhibit_search_fields
           (exhibit_id, case_id, field, value, norm, source, part, start_offset, end_offset)
         VALUES (?, ?, 'link.href', 'stale', 'https://stale.example.org/', 'html-part', 0, 0, 5)`
      )
      .run(b, other)
    const files: Files = new Map([
      [`${a}.mhtml`, PAGE],
      [`${b}.mhtml`, mhtml('<a href="https://fresh.example.org/">Fresh</a>')]
    ])

    expect(await rebuildAllFields(storeOf(files))).toEqual({ indexed: 2, noSource: 0, failed: 0 })

    expect(getExhibitSearchBuild(a)?.outcome).toBe('built')
    expect(fieldRows(b).map((row) => row.norm)).toEqual(['https://fresh.example.org/'])
    expect(matches('"stale.example"')).toBe(0)
    expectIndexInStep()
  })

  it('leaves the records it has not reached yet searchable while it runs', async () => {
    const id = capture(caseId)
    const store = storeOf(new Map([[`${id}.mhtml`, PAGE]]))
    buildExhibitFields(id, store)

    const rebuilt = rebuildAllFields(store)
    expect(matches('"tollgate-ledger"')).toBe(1)

    expect(await rebuilt).toEqual({ indexed: 1, noSource: 0, failed: 0 })
    expect(matches('"tollgate-ledger"')).toBe(1)
  })

  it('drops index entries that have no field row', async () => {
    const id = capture(caseId)
    getDb()
      .prepare('INSERT INTO exhibit_search_fields_fts(rowid, norm) VALUES (9999, ?)')
      .run('https://stray.example.org/')
    expect(matches('"stray.example"')).toBe(1)

    await rebuildAllFields(storeOf(new Map([[`${id}.mhtml`, PAGE]])))

    expect(matches('"stray.example"')).toBe(0)
    expect(matches('"tollgate-ledger.example"')).toBe(1)
    expectIndexInStep()
  })
})

describe('searchCaseFields', () => {
  function build(id: string, page: Buffer = PAGE): void {
    const files: Files = new Map([
      [`${id}.mhtml`, page],
      [`${id}.txt`, Buffer.from(TEXT, 'utf-8')]
    ])
    buildExhibitFields(id, storeOf(files))
  }

  it('finds an address through its search form, whatever its case and brackets', () => {
    const id = capture(caseId)
    build(id)

    const { hits, unavailable, truncated } = searchCaseFields(
      caseId,
      'WREN@hollis-mail.EXAMPLE.org'
    )

    expect(unavailable).toEqual([])
    expect(truncated).toBe(false)
    expect(hits).toHaveLength(1)
    const [hit] = hits
    expect(hit).toMatchObject({
      caseId,
      exhibitId: id,
      exhibitCitation: String(hit.exhibitNumber),
      contentHash: 'c'.repeat(64),
      title: 'Notice',
      field: 'header.from',
      preview: 'Wren Hollis <wren@Hollis-Mail.example.org>',
      norm: 'wren@hollis-mail.example.org',
      occurrences: 1,
      locator: { source: 'text', part: null, extractor: FIELD_EXTRACTOR_VERSION }
    })
    expect(TEXT.slice(hit.locator.startOffset, hit.locator.endOffset)).toBe(hit.preview)
  })

  it('finds a part of a link target, with the span it came from in the decoded part', () => {
    const id = capture(caseId)
    build(id)

    const { hits } = searchCaseFields(caseId, 'ledger.example.com/pa')

    expect(hits.map((hit) => hit.field)).toEqual(['link.href'])
    const { part, startOffset, endOffset } = hits[0].locator
    const decoded = listHtmlPartsInMhtml(PAGE).parts[part ?? -1].decode()
    expect(decoded.slice(startOffset, endOffset)).toBe(hits[0].preview)
  })

  it('returns a value repeated in one Capture once, at its first place, with the count', () => {
    const id = capture(caseId)
    const link = '<a href="https://tollgate-ledger.example.com/pay">Pay</a>'
    build(id, mhtml(`<p>${link}</p><p>${link}</p><p>${link}</p>`))

    const { hits } = searchCaseFields(caseId, 'tollgate')

    expect(hits).toHaveLength(1)
    expect(hits[0].occurrences).toBe(3)
    const firstField = fieldRows(id).find((row) => row.field === 'link.href')
    expect(hits[0].locator.startOffset).toBe(firstField?.startOffset)
  })

  it('matches a query under three characters as a plain substring', () => {
    const id = capture(caseId)
    build(id)

    expect(searchCaseFields(caseId, 'Pa').hits.map((hit) => hit.norm)).toEqual([
      'https://tollgate-ledger.example.com/pay',
      'Pay here'
    ])
    expect(searchCaseFields(caseId, '%').hits).toEqual([])
    expect(searchCaseFields(caseId, '_').hits).toEqual([])
  })

  it('reads punctuation and quotes in the query as text', () => {
    const id = capture(caseId)
    build(id)

    expect(searchCaseFields(caseId, '<a1@x>').hits.map((hit) => hit.field)).toEqual([
      'header.message-id'
    ])
    expect(searchCaseFields(caseId, '"tollgate').hits).toEqual([])
    expect(searchCaseFields(caseId, 'tollgate OR wren').hits).toEqual([])
    expect(searchCaseFields(caseId, '  ').hits).toEqual([])
  })

  it('returns records whose build row records another Content Hash as unavailable', () => {
    const id = capture(caseId)
    build(id)
    getDb()
      .prepare('UPDATE exhibit_search_builds SET content_hash = ? WHERE exhibit_id = ?')
      .run('d'.repeat(64), id)

    const { hits, unavailable } = searchCaseFields(caseId, 'tollgate')

    expect(hits).toEqual([])
    expect(unavailable).toEqual([{ exhibitId: id, exhibitCitation: expect.any(String) }])
  })

  // The comparison reads two recorded hashes, not the stored files; the plan's D7 leaves
  // hashing the file to the exact check.
  it('returns hits for files that do not match the Content Hash the Exhibit row records', () => {
    const id = capture(caseId)
    build(id, mhtml('<a href="https://swapped.example.org/">Swapped</a>'))

    const { hits, unavailable } = searchCaseFields(caseId, 'swapped.example')

    expect(getExhibitSearchBuild(id)?.contentHash).toBe('c'.repeat(64))
    expect(unavailable).toEqual([])
    expect(hits.map(({ field, contentHash }) => ({ field, contentHash }))).toEqual([
      { field: 'link.href', contentHash: 'c'.repeat(64) }
    ])
    // A header record comes from the Extracted Text file, which no hash here covers.
    expect(searchCaseFields(caseId, 'wren@hollis').hits.map(({ field }) => field)).toEqual([
      'header.from'
    ])
  })

  it("searches one Case, not another Case's records", () => {
    build(capture(createCase({ name: 'Other' }).id))

    expect(searchCaseFields(caseId, 'tollgate').hits).toEqual([])
  })

  it('stops at its hit limit and says so', () => {
    const id = capture(caseId)
    const links = Array.from(
      { length: 201 },
      (_, i) => `<a href="https://many-${i}.example.org/">${i}</a>`
    )
    build(id, mhtml(links.join('')))

    const { hits, truncated } = searchCaseFields(caseId, '.example.org/')

    expect(hits).toHaveLength(200)
    expect(truncated).toBe(true)
  })
})
