import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { createHash } from 'crypto'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { ingestMhtmlCapture } from '@main/services/captureLifecycle'
import { defaultCaptureStore, type CaptureStore } from '@main/services/captureStore'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import * as captureRepo from '@main/services/db/captureRepo'
import { getCapture, insertCapture } from '@main/services/db/captureRepo'
import { getExhibitSearchBuild, replaceExhibitFields } from '@main/services/db/searchFieldRepo'
import { initManifest } from '@main/services/manifest'
import { buildExhibitFields } from '@main/services/search/fieldIndex'
import { CAPTURE_LINK_BUDGETS } from '@main/services/htmlParts'
import { checkFieldHit } from '@main/services/investigation/claimCheck'

// The exact check of a Case search field record (docs/plans/2026-10-09-case-retrieval-
// first-slice.md, D7): known answers over invented pages, a signed manifest and an
// in-memory database. Every person, site and address here is invented.

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

const PAGE_URL = 'https://quillmere-gazette.example.net/notices/14'
const MAIN_HTML =
  '<html><body><a href="https://Tollgate-Ledger.example.com/pay">Pay</a></body></html>'
const FRAME_HTML = '<html><body><a href="/seal"><img alt="Ledger seal"></a></body></html>'
const TEXT = 'Show original\nFrom: Wren Hollis <wren@Hollis-Mail.example.org>\nMessage-ID: <a1@x>\n'

function mhtml(): Buffer {
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
      MAIN_HTML,
      '--B',
      'Content-Type: text/html',
      'Content-Transfer-Encoding: binary',
      'Content-Location: https://seal-frames.example.net/seal',
      '',
      FRAME_HTML,
      '--B--',
      ''
    ].join('\r\n'),
    'utf8'
  )
}

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

let tempDir: string
let root: string
let caseId: string

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-claim-check-'))
  root = join(tempDir, 'captures')
  initStorage(root)
  await initDatabase(':memory:')
  caseId = createCase({ name: 'Check' }).id
  ensureCaseDir(caseId)
  initManifest(join(root, caseId))
})

afterEach(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

async function ingest(textContent = TEXT, screenshot?: Buffer): Promise<string> {
  const { capture } = await ingestMhtmlCapture({
    caseId,
    url: PAGE_URL,
    title: 'Notice',
    timestamp: '2026-10-01T12:00:00.000Z',
    stream: Readable.from([mhtml()]) as unknown as ReadableStream<Uint8Array>,
    textContent,
    screenshot,
    headers: {},
    browserVersion: 'Chrome/120',
    userAgent: 'Mozilla/5.0',
    httpStatus: 200,
    extensionVersion: '0.1.0',
    operatorId: 'op-1',
    operatorName: 'Operator',
    toolVersion: '0.1.0'
  })
  expect(buildExhibitFields(capture.id)).toBe('built')
  return capture.id
}

function fieldId(exhibitId: string, field: string): number {
  const row = getDb()
    .prepare(
      'SELECT id FROM exhibit_search_fields WHERE exhibit_id = ? AND field = ? ORDER BY id LIMIT 1'
    )
    .get(exhibitId, field) as { id: number } | undefined
  if (!row) throw new Error(`no ${field} record`)
  return row.id
}

function sql(statement: string, ...params: unknown[]): void {
  getDb()
    .prepare(statement)
    .run(...params)
}

const pagePath = (id: string) => join(root, caseId, `${id}.mhtml`)

describe('checkFieldHit: present', () => {
  it('finds a link target in the decoded page', async () => {
    const id = await ingest()
    const result = await checkFieldHit(fieldId(id, 'link.href'))
    expect(result.check).toEqual({ text: 'present', basis: 'decoded', reason: null })
    expect(result.record).toMatchObject({
      exhibitId: id,
      field: 'link.href',
      locator: { source: 'html-part', part: 0, extractor: 'fields/1' }
    })
  })

  it('finds image alt text in the second text/html part', async () => {
    const id = await ingest()
    const result = await checkFieldHit(fieldId(id, 'link.alt'))
    expect(result.check).toEqual({ text: 'present', basis: 'decoded', reason: null })
    expect(result.record?.locator.part).toBe(1)
  })

  it('finds a header in Extracted Text that matches its signed digest', async () => {
    const id = await ingest()
    const result = await checkFieldHit(fieldId(id, 'header.from'))
    expect(result.check).toEqual({ text: 'present', basis: 'hash-verified', reason: null })
    expect(result.record?.locator).toMatchObject({ source: 'text', part: null })
  })

  it('marks Extracted Text that no signed digest covers as unattested', async () => {
    // An empty text gives a capture entry with no text digest, as before #118.
    const id = await ingest('')
    defaultCaptureStore.writeText(caseId, id, TEXT)
    expect(buildExhibitFields(id)).toBe('built')
    const result = await checkFieldHit(fieldId(id, 'header.from'))
    expect(result.check).toEqual({ text: 'present', basis: 'unattested', reason: null })
  })
})

describe('checkFieldHit: absent', () => {
  it('reports a record whose value the page does not hold at its place', async () => {
    const id = await ingest()
    const field = fieldId(id, 'link.href')
    sql('UPDATE exhibit_search_fields SET value = ? WHERE id = ?', 'https://other.example', field)
    const result = await checkFieldHit(field)
    expect(result.check).toEqual({ text: 'absent', basis: 'decoded', reason: null })
    expect(result.record?.locator.source).toBe('html-part')
  })

  it('reports offsets past the end of the Extracted Text', async () => {
    const id = await ingest()
    const field = fieldId(id, 'header.from')
    sql('UPDATE exhibit_search_fields SET end_offset = ? WHERE id = ?', 100000, field)
    const result = await checkFieldHit(field)
    expect(result.check).toEqual({ text: 'absent', basis: 'hash-verified', reason: null })
    expect(result.record?.locator.endOffset).toBe(100000)
  })

  it('reports a start after the end', async () => {
    const id = await ingest()
    const field = fieldId(id, 'header.from')
    sql('UPDATE exhibit_search_fields SET start_offset = end_offset + 1 WHERE id = ?', field)
    expect((await checkFieldHit(field)).check.text).toBe('absent')
  })
})

describe('checkFieldHit: cannot-check', () => {
  it('names a record that is gone', async () => {
    const result = await checkFieldHit(424242)
    expect(result).toEqual({
      check: {
        text: 'cannot-check',
        basis: null,
        reason: 'The search record is gone. Search again.'
      },
      record: null
    })
  })

  it('refuses an Exhibit whose Content Hash changed after indexing', async () => {
    const id = await ingest()
    sql('UPDATE exhibits SET content_hash = ? WHERE id = ?', 'f'.repeat(64), id)
    const { check } = await checkFieldHit(fieldId(id, 'link.href'))
    expect(check).toEqual({
      text: 'cannot-check',
      basis: null,
      reason: 'The Exhibit changed after it was indexed.'
    })
  })

  it('names a tampered stored page', async () => {
    const id = await ingest()
    const bytes = readFileSync(pagePath(id))
    bytes[bytes.length - 3] ^= 1
    writeFileSync(pagePath(id), bytes)
    const { check } = await checkFieldHit(fieldId(id, 'link.href'))
    expect(check.text).toBe('cannot-check')
    expect(check.basis).toBeNull()
    expect(check.reason).toBe(
      'The stored page does not match the hash recorded for it, so the capture does not verify.'
    )
  })

  it('names a stored page that is missing', async () => {
    const id = await ingest()
    unlinkSync(pagePath(id))
    const { check } = await checkFieldHit(fieldId(id, 'link.href'))
    expect(check.text).toBe('cannot-check')
    // The verification's own reason holds the file's absolute path; the answer does not.
    expect(check.reason).toBe(
      'The stored page could not be read, so the capture cannot be verified.'
    )
  })

  it('refuses every record of a capture whose screenshot is missing', async () => {
    const id = await ingest(TEXT, Buffer.from('invented screenshot bytes'))
    unlinkSync(join(root, caseId, `${id}.png`))
    for (const field of ['link.href', 'header.from']) {
      const { check } = await checkFieldHit(fieldId(id, field))
      expect(check.text).toBe('cannot-check')
      expect(check.reason).toBe(
        'The screenshot could not be read, so the capture cannot be verified.'
      )
    }
  })

  it('names a legacy capture, whose page the verification does not hash', async () => {
    const legacy = insertCapture({
      caseId,
      url: PAGE_URL,
      title: 'Legacy',
      hash: 'a'.repeat(64),
      timestamp: '2026-01-01T00:00:00.000Z'
    })
    writeFileSync(join(root, caseId, `${legacy.id}.html`), MAIN_HTML)
    expect(buildExhibitFields(legacy.id)).toBe('built')
    const { check, record } = await checkFieldHit(fieldId(legacy.id, 'link.href'))
    expect(check).toEqual({
      text: 'cannot-check',
      basis: null,
      reason:
        'This capture was stored before page archives, and its verification does not hash its stored page.'
    })
    expect(record?.locator.part).toBe(0)
  })

  it('follows the signed digest when the text file and its database copies change together', async () => {
    const id = await ingest()
    const edited = TEXT.replace('wren@Hollis-Mail', 'wren@Hollis-Post')
    defaultCaptureStore.writeText(caseId, id, edited)
    sql('UPDATE captures SET text_hash = ? WHERE id = ?', sha256(edited), id)
    sql('UPDATE capture_texts SET content = ? WHERE capture_id = ?', edited, id)
    // The rebuild records the edited file's digest in the build row.
    expect(buildExhibitFields(id)).toBe('built')
    expect(getExhibitSearchBuild(id)?.textHash).toBe(sha256(edited))
    const { check } = await checkFieldHit(fieldId(id, 'header.from'))
    expect(check.text).toBe('cannot-check')
    expect(check.reason).toBe(
      'The Extracted Text file does not match the hash recorded for it, so the capture does not verify.'
    )
  })

  it('names a Case whose signed record does not verify', async () => {
    const id = await ingest()
    const manifestPath = join(root, caseId, 'manifest.jsonl')
    writeFileSync(
      manifestPath,
      readFileSync(manifestPath, 'utf8').replace('"capture"', '"kapture"')
    )
    const { check } = await checkFieldHit(fieldId(id, 'link.href'))
    expect(check).toEqual({
      text: 'cannot-check',
      basis: null,
      reason: "The Case's signed record does not verify for this capture."
    })
  })

  it('names a capture that is gone by the time it is verified', async () => {
    const id = await ingest()
    const field = fieldId(id, 'link.href')
    vi.spyOn(captureRepo, 'getCapture').mockReturnValueOnce(undefined)
    const { check } = await checkFieldHit(field)
    expect(check.reason).toBe('The capture is gone.')
  })

  // A row with no index into the signed record verifies against the database's hash
  // alone (captureLifecycle.ts), so nothing signed covers what the check would read.
  describe('a capture no signed capture record covers', () => {
    async function unsigned(): Promise<{ id: string; edited: string }> {
      const id = await ingest()
      const edited = mhtml().toString('utf8').replace('Tollgate-Ledger', 'Tollgate-Lodger')
      writeFileSync(pagePath(id), edited)
      const editedHash = sha256(edited)
      sql('UPDATE captures SET manifest_index = NULL, hash = ? WHERE id = ?', editedHash, id)
      sql('UPDATE exhibits SET content_hash = ? WHERE id = ?', editedHash, id)
      expect(buildExhibitFields(id)).toBe('built')
      return { id, edited: editedHash }
    }

    it('refuses the edited page the reviewer reproduced', async () => {
      const { id, edited } = await unsigned()
      const field = fieldId(id, 'link.href')
      expect(
        getDb().prepare('SELECT value FROM exhibit_search_fields WHERE id = ?').get(field)
      ).toEqual({ value: 'https://Tollgate-Lodger.example.com/pay' })
      expect(readFileSync(join(root, caseId, 'manifest.jsonl'), 'utf8')).not.toContain(edited)
      const { check } = await checkFieldHit(field)
      expect(check).toEqual({
        text: 'cannot-check',
        basis: null,
        reason: 'No signed capture record covers this capture.'
      })
    })

    it('refuses its Extracted Text too, rather than marking it unattested', async () => {
      const { id } = await unsigned()
      const { check } = await checkFieldHit(fieldId(id, 'header.from'))
      expect(check).toEqual({
        text: 'cannot-check',
        basis: null,
        reason: 'No signed capture record covers this capture.'
      })
    })
  })

  it("reads the text file from the Capture's own Case, not the search record's", async () => {
    const id = await ingest('')
    defaultCaptureStore.writeText(caseId, id, TEXT)
    expect(buildExhibitFields(id)).toBe('built')
    const field = fieldId(id, 'header.from')
    // A planted file in another Case, named by an edited search record.
    const other = createCase({ name: 'Other' }).id
    ensureCaseDir(other)
    defaultCaptureStore.writeText(other, id, TEXT.replace('Wren', 'Ward'))
    sql('UPDATE exhibit_search_fields SET case_id = ? WHERE id = ?', other, field)
    const { check } = await checkFieldHit(field)
    expect(check).toEqual({ text: 'present', basis: 'unattested', reason: null })
  })

  it('refuses Extracted Text read for the check that differs from the verified file', async () => {
    const id = await ingest()
    let reads = 0
    const store: CaptureStore = {
      ...defaultCaptureStore,
      readArtifact: (c, captureId, type) => {
        const buf = defaultCaptureStore.readArtifact(c, captureId, type)
        if (type !== 'txt' || !buf) return buf
        reads += 1
        // The verification's read is the first; the check's own read is the second.
        return reads === 1 ? buf : Buffer.from(buf.toString('utf-8').replace('Wren', 'Ward'))
      }
    }
    const { check } = await checkFieldHit(fieldId(id, 'header.from'), { store })
    expect(check).toEqual({
      text: 'cannot-check',
      basis: null,
      reason: 'The Extracted Text read for the check does not match its signed digest.'
    })
  })

  it('refuses unattested text whose file is gone', async () => {
    const id = await ingest('')
    defaultCaptureStore.writeText(caseId, id, TEXT)
    expect(buildExhibitFields(id)).toBe('built')
    unlinkSync(join(root, caseId, `${id}.txt`))
    const { check } = await checkFieldHit(fieldId(id, 'header.from'))
    expect(check.reason).toBe('The Extracted Text file could not be read.')
  })

  it('names a part that is not in the stored page', async () => {
    const id = await ingest()
    const field = fieldId(id, 'link.href')
    sql('UPDATE exhibit_search_fields SET part = 7 WHERE id = ?', field)
    const { check } = await checkFieldHit(field)
    expect(check.reason).toBe('Part 7 is not in the stored page.')
  })

  it('names a page record with no part', async () => {
    const id = await ingest()
    const field = fieldId(id, 'link.href')
    sql('UPDATE exhibit_search_fields SET part = NULL WHERE id = ?', field)
    const { check } = await checkFieldHit(field)
    expect(check.reason).toBe('The record names no part.')
  })

  it('refuses a part over the per-part ceiling without decoding it', async () => {
    const id = await ingest()
    const budgets = { ...CAPTURE_LINK_BUDGETS, maxPartBytes: 10 }
    const { check } = await checkFieldHit(fieldId(id, 'link.href'), { budgets })
    expect(check).toEqual({
      text: 'cannot-check',
      basis: null,
      reason: 'Part 0 is over the 10-byte limit for reading one part.'
    })
  })

  it('hashes the page it slices, not only the file the row path names', async () => {
    const id = await ingest()
    // The row's path names an intact copy, while the file the check reads is altered.
    const copy = join(caseId, 'intact-copy.mhtml')
    copyFileSync(pagePath(id), join(root, copy))
    sql('UPDATE captures SET mhtml_path = ? WHERE id = ?', copy, id)
    writeFileSync(pagePath(id), mhtml().toString('utf8').replace('Tollgate', 'Tollgame'))
    const { check } = await checkFieldHit(fieldId(id, 'link.href'))
    expect(check).toEqual({
      text: 'cannot-check',
      basis: null,
      reason: 'The stored page read for the check does not hash to its Content Hash.'
    })
  })

  it('refuses a page the check cannot read', async () => {
    const id = await ingest()
    const copy = join(caseId, 'intact-copy.mhtml')
    copyFileSync(pagePath(id), join(root, copy))
    sql('UPDATE captures SET mhtml_path = ? WHERE id = ?', copy, id)
    unlinkSync(pagePath(id))
    const { check } = await checkFieldHit(fieldId(id, 'link.href'))
    expect(check.reason).toBe('The stored page could not be read.')
  })

  it('refuses a Content Hash that is not the verified one', async () => {
    const id = await ingest()
    const other = 'e'.repeat(64)
    sql('UPDATE exhibits SET content_hash = ? WHERE id = ?', other, id)
    sql('UPDATE exhibit_search_builds SET content_hash = ? WHERE exhibit_id = ?', other, id)
    const { check } = await checkFieldHit(fieldId(id, 'link.href'))
    expect(check).toEqual({
      text: 'cannot-check',
      basis: null,
      reason: 'The Content Hash the search recorded is not the verified one.'
    })
  })
})

describe('checkFieldHit writes nothing', () => {
  function tableCounts(): Record<string, number> {
    const d = getDb()
    const names = d
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
    return Object.fromEntries(
      names.map(({ name }) => [
        name,
        (d.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n
      ])
    )
  }

  it('leaves the manifest, the capture row and every table as they were', async () => {
    const id = await ingest()
    const absentField = fieldId(id, 'link.alt')
    sql('UPDATE exhibit_search_fields SET value = ? WHERE id = ?', 'Other seal', absentField)
    const manifest = readFileSync(join(root, caseId, 'manifest.jsonl'))
    const capture = getCapture(id)
    const counts = tableCounts()

    expect((await checkFieldHit(fieldId(id, 'link.href'))).check.text).toBe('present')
    expect((await checkFieldHit(absentField)).check.text).toBe('absent')
    expect((await checkFieldHit(424242)).check.text).toBe('cannot-check')
    // A cannot-check the verification itself gave, with `record: false`.
    unlinkSync(join(root, caseId, `${id}.txt`))
    expect((await checkFieldHit(fieldId(id, 'link.href'))).check.reason).toMatch(
      /could not be read/
    )

    expect(readFileSync(join(root, caseId, 'manifest.jsonl'))).toEqual(manifest)
    expect(getCapture(id)).toEqual(capture)
    expect(capture?.lastVerifiedStatus).toBeUndefined()
    expect(tableCounts()).toEqual(counts)
  })
})

describe('checkFieldHit and a reused record id', () => {
  it('returns the record it read, so the view can tell it from the hit', async () => {
    const id = await ingest()
    const field = fieldId(id, 'header.from')
    const before = await checkFieldHit(field)
    const build = getExhibitSearchBuild(id)
    if (!build) throw new Error('no build row')
    // A rebuild that records other fields: the first new row takes the freed id.
    replaceExhibitFields(build, [
      {
        field: 'header.message-id',
        value: '<a1@x>',
        norm: '<a1@x>',
        source: 'text',
        part: null,
        startOffset: TEXT.indexOf('<a1@x>'),
        endOffset: TEXT.indexOf('<a1@x>') + '<a1@x>'.length
      }
    ])
    expect(fieldId(id, 'header.message-id')).toBe(field)
    const after = await checkFieldHit(field)
    expect(before.record?.field).toBe('header.from')
    expect(after.record?.field).toBe('header.message-id')
    expect(after.record?.locator).not.toEqual(before.record?.locator)
  })
})
