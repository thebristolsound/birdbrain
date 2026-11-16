import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { closeDatabase, getDb } from '@main/services/db/core'
import { resetInstallationId } from '@main/services/installationId'
import { resetSigningKey } from '@main/services/signingKey'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import type { CaptureLifecycle, IngestParams } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { resetSyncStateMemory } from '@main/services/sharing/syncState'
import {
  BoundTlsSchema,
  CaptureInventorySchema,
  ManifestEntrySchema,
  ScrollToLoadRecordSchema
} from '@shared/schemas'
import { canonicalStringify } from '@shared/verify'
import {
  ENGINE_BOUND_TLS,
  ENGINE_FILES,
  ENGINE_INVENTORY,
  ENGINE_SCROLL_TO_LOAD
} from '../../helpers/captureEnginePackage'
import {
  activate,
  appendOwnChainLine,
  createPeer,
  memberAddBody,
  memberChainText,
  ownChainText,
  pull,
  recordSource,
  seedSharedCase,
  type Peer
} from '../../helpers/syncPeers'

// The Capture row and the signed `capture` entry each of the three writers produces (the ingest,
// a Duplicate, and the row sync writes for another member's Capture), for four Captures that
// between them set every entry field a row mirrors. The values in the fixture file were recorded
// from the writers as they stood at origin/main 2aac9a32, before the mapping from entry to row
// moved into one module, so a change to a column or a byte of an entry of these four fails
// here. Shapes outside the four, such as a row an archive import renamed or a received Capture
// numbered only by a `renumber` entry, are not pinned. Content is invented.
//
// Four values differ on every run and are replaced by a name before the comparison: each
// installation's id, a Duplicate's id, each entry's hash and its signature. Every entry hash is
// first recomputed from the entry's own canonical body, so the named hash still stands for the
// bytes beside it.

// A Duplicate signs the running build's version, which moves at every release.
vi.mock('@main/services/toolVersion', () => ({ resolveToolVersion: () => TOOL_VERSION }))

const TOOL_VERSION = vi.hoisted(() => '1.0.1-beta.25')
const FIXTURE = join(__dirname, '../../fixtures/captureRow/known-answers.json')
const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000002204'
const NOW = '2026-11-16T10:00:00.000Z'
const TLS_URL = 'https://example.com/extension/full'

const id = (n: number): string => `0196f7a2-aaaa-bbbb-cccc-00000000010${n}`
const BARE = id(1)
const FULL = id(2)
const BACKGROUND = id(3)
const LAUNCHED = id(4)
const NAMES: Record<string, string> = {
  [BARE]: 'extension, nothing optional',
  [FULL]: 'extension, headers, status, text, screenshot and a TLS Cert Chain',
  [BACKGROUND]: 'background, every capture engine field, an Egress, a Persona and a link source',
  [LAUNCHED]: 'launched, no Transaction Record'
}

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

const stream = (bytes: Buffer): ReadableStream<Uint8Array> =>
  Readable.from([bytes]) as unknown as ReadableStream<Uint8Array>

const immediates = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function rowOf(captureId: string): Record<string, unknown> {
  const db = getDb()
  return {
    captures: db.prepare('SELECT * FROM captures WHERE id = ?').get(captureId),
    exhibits: db.prepare('SELECT * FROM exhibits WHERE id = ?').get(captureId),
    captureTexts: db
      .prepare('SELECT title, url, content FROM capture_texts WHERE capture_id = ?')
      .get(captureId)
  }
}

describe('the Capture row and signed entry each writer produces', () => {
  let root: string
  let A: Peer
  let B: Peer
  let lifecycle: CaptureLifecycle

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) })
    root = mkdtempSync(join(tmpdir(), 'bb-capture-row-'))
    A = await createPeer(root, 'alice', 'Alice Owner', 'AL')
    B = await createPeer(root, 'bob', 'Bob Member', 'BO')
    for (const peer of [A, B]) {
      await activate(peer)
      seedSharedCase(CASE_ID, A, [B])
    }
    await activate(A)
    appendOwnChainLine(CASE_ID, memberAddBody(CASE_ID, A, 'owner', A))
    appendOwnChainLine(CASE_ID, memberAddBody(CASE_ID, B, 'member', A))
    lifecycle = createCaptureLifecycle({
      selectorLifecycle: { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle,
      egressIsDirect: () => true,
      fetchTlsCertChain: async (url) =>
        url === TLS_URL
          ? {
              url,
              refetchedAt: '2026-11-16T09:59:58.000Z',
              chain: [
                {
                  subject: 'CN=example.com',
                  issuer: 'CN=Example Issuing CA',
                  validFrom: '2026-01-01T00:00:00.000Z',
                  validTo: '2027-01-01T00:00:00.000Z',
                  fingerprint256: 'AB:CD',
                  serialNumber: '01',
                  subjectAltNames: ['example.com']
                }
              ]
            }
          : null
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    closeDatabase()
    resetInstallationId()
    resetSigningKey()
    resetSyncStateMemory()
    rmSync(root, { recursive: true, force: true })
  })

  function params(captureId: string, extra: Partial<IngestParams>): IngestParams {
    return {
      caseId: CASE_ID,
      url: 'https://example.com/page',
      title: 'Page',
      timestamp: '2026-11-14T08:30:00.000Z',
      stream: stream(Buffer.from(`MIME-Version: 1.0\r\n\r\npage ${captureId}`)),
      textContent: '',
      headers: {},
      browserVersion: 'Chrome/142.0.0.0',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/142.0.0.0',
      httpStatus: 0,
      operatorId: A.installationId,
      operatorName: A.operatorName,
      toolVersion: TOOL_VERSION,
      captureId,
      ...extra
    }
  }

  async function ingestEveryShape(): Promise<void> {
    await lifecycle.ingest(params(BARE, { extensionVersion: '1.4.0' }))
    await lifecycle.ingest(
      params(FULL, {
        url: TLS_URL,
        title: 'Harbour Street ledger',
        textContent: 'The brackwater depot ledger for March',
        headers: { server: 'nginx', 'content-type': 'text/html; charset=utf-8' },
        httpStatus: 200,
        finalUrl: 'https://example.com/extension/full?landed=1',
        extensionVersion: '1.4.0',
        screenshot: Buffer.from('extension screenshot bytes')
      })
    )
    await lifecycle.ingest(
      params(BACKGROUND, {
        url: 'https://example.com/background',
        title: 'Background render',
        stream: stream(ENGINE_FILES.page),
        textContent: 'Captured by the capture engine',
        httpStatus: 203,
        method: 'background',
        supersedesCaptureId: BARE,
        consentSuppression: 'filter-list',
        screenshot: ENGINE_FILES.screenshot,
        egress: { kind: 'proxy', label: 'Exit A' },
        // The entry signs FULL as the source and the row keeps BARE, the two ids an import
        // rename leaves apart.
        linkSource: {
          signed: {
            linkedFromCaptureId: FULL,
            linkedFromContentHash: '5'.repeat(64),
            linkHref: 'https://example.com/background'
          },
          rowId: BARE
        },
        persona: { id: 'persona-row-id', label: 'Pseudonym A' },
        inventory: CaptureInventorySchema.parse(ENGINE_INVENTORY),
        scrollToLoad: ScrollToLoadRecordSchema.parse(ENGINE_SCROLL_TO_LOAD),
        transactionRecord: ENGINE_FILES.transactionRecord,
        boundTls: BoundTlsSchema.parse(ENGINE_BOUND_TLS),
        pdf: ENGINE_FILES.pdf
      })
    )
    await lifecycle.ingest(
      params(LAUNCHED, {
        url: 'https://example.com/launched',
        title: 'Launched page',
        textContent: 'launched text',
        httpStatus: 200,
        method: 'launched',
        browserVersion: '149.0.7827.55',
        userAgent: 'Mozilla/5.0 launched',
        screenshot: Buffer.from('launched screenshot bytes'),
        inventory: CaptureInventorySchema.parse({
          mhtml: { present: true, pinnedImages: 0, pinnedImagesNotLoaded: 0 },
          transactionRecord: { present: false, reason: 'page-not-recorded' },
          screenshot: {
            present: true,
            scaled: false,
            truncated: false,
            trimmed: false,
            contentWidth: 1280,
            contentHeight: 900,
            width: 1280,
            height: 900
          },
          pdf: { present: false, reason: 'failed' }
        }),
        boundTlsAbsent: 'not-recorded',
        launchedBrowser: {
          product: 'Chrome',
          version: '149.0.7827.55',
          family: 'chrome-for-testing'
        }
      })
    )
    await immediates()
  }

  it('matches the answers recorded before the mapping moved', async () => {
    await ingestEveryShape()

    const duplicates = new Map<string, string>()
    for (const sourceId of [BARE, FULL, BACKGROUND, LAUNCHED]) {
      const result = await lifecycle.duplicate(sourceId)
      if (result.status !== 'duplicated') throw new Error(JSON.stringify(result))
      duplicates.set(sourceId, result.capture.id)
      await immediates()
    }

    // The author's chain: one `capture` line per Capture, each hash recomputed from its body.
    const lines = ownChainText(CASE_ID)
      .split('\n')
      .filter((line) => line.length > 0)
    const volatile = new Map<string, string>([
      [A.installationId, '<alice>'],
      [B.installationId, '<bob>']
    ])
    for (const [sourceId, duplicateId] of duplicates) {
      volatile.set(duplicateId, `<duplicate of ${sourceId}>`)
    }
    const entryLines = new Map<string, string>()
    for (const line of lines) {
      const entry = JSON.parse(line) as Record<string, unknown>
      const { entryHash, signature, ...body } = entry
      expect(sha(canonicalStringify(body))).toBe(entryHash)
      volatile.set(String(entryHash), `<hash of entry ${String(entry.index)}>`)
      volatile.set(String(signature), `<signature of entry ${String(entry.index)}>`)
      if (entry.type !== 'capture') continue
      expect(ManifestEntrySchema.safeParse(entry).success).toBe(true)
      entryLines.set(String(entry.captureId), line)
    }
    expect(entryLines.size).toBe(8)

    const authored = (captureId: string) => ({
      entry: entryLines.get(captureId),
      row: rowOf(captureId)
    })
    const ingest: Record<string, unknown> = {}
    const duplicate: Record<string, unknown> = {}
    for (const sourceId of [BARE, FULL, BACKGROUND, LAUNCHED]) {
      ingest[NAMES[sourceId]] = authored(sourceId)
      duplicate[NAMES[sourceId]] = authored(duplicates.get(sourceId) ?? '')
    }

    // The receiver writes a row for each of the author's eight entries and no entry of its own.
    const source = recordSource(CASE_ID, A)
    await activate(B)
    const result = await pull(CASE_ID, source)
    expect(result.errors).toEqual([])
    expect(result.capturesApplied).toBe(8)
    const copied = memberChainText(CASE_ID, A)
    for (const line of entryLines.values()) expect(copied).toContain(line + '\n')
    expect(ownChainText(CASE_ID)).not.toContain('"type":"capture"')
    const received: Record<string, unknown> = {}
    for (const sourceId of [BARE, FULL, BACKGROUND, LAUNCHED]) {
      received[NAMES[sourceId]] = rowOf(sourceId)
      received[`a Duplicate of: ${NAMES[sourceId]}`] = rowOf(duplicates.get(sourceId) ?? '')
    }

    let text = JSON.stringify({ ingest, duplicate, received }, null, 2) + '\n'
    for (const [value, name] of volatile) text = text.replaceAll(value, name)
    await expect(text).toMatchFileSnapshot(FIXTURE)
  }, 60_000)
})
