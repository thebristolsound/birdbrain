import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { MANIFEST_FILENAME } from '@shared/constants'
import { ManifestEntrySchema } from '@shared/schemas'
import type { LinkProvenance } from '@shared/types'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { ingestMhtmlCapture, type IngestParams } from '@main/services/captureLifecycle'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { getCapture } from '@main/services/db/captureRepo'
import { initManifest } from '@main/services/manifest'

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

// The capture entry a Capture link job signs (ADR-0040), field for field: the three link
// provenance fields and the schema-6 stamp they need, and an ordinary entry with neither.
const LINK: LinkProvenance = {
  linkedFromCaptureId: 'source-capture-id',
  linkedFromContentHash: '5'.repeat(64),
  linkHref: 'http://example.com/page'
}

describe('the capture entry a link Capture signs', () => {
  let tempDir: string
  let caseId: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-link-ingest-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    caseId = createCase({ name: 'Link provenance' }).id
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'captures', caseId))
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function params(extra: Partial<IngestParams> = {}): IngestParams {
    return {
      caseId,
      url: 'https://example.com/page',
      title: 'Landed',
      timestamp: '2026-10-26T12:00:00.000Z',
      stream: Readable.from([Buffer.from('mhtml bytes')]) as unknown as ReadableStream<Uint8Array>,
      textContent: '',
      headers: {},
      browserVersion: 'Chrome/130',
      userAgent: 'UA',
      httpStatus: 0,
      operatorId: 'op-1',
      operatorName: 'Casey Operator',
      toolVersion: '0.4.0',
      method: 'background',
      ...extra
    }
  }

  function lastEntry(): Record<string, unknown> {
    const lines = readFileSync(join(tempDir, 'captures', caseId, MANIFEST_FILENAME), 'utf-8')
      .trim()
      .split('\n')
    return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>
  }

  const body = (captureId: string, contentHash: string, index: number) => ({
    type: 'capture',
    captureId,
    caseId,
    url: 'https://example.com/page',
    timestamp: '2026-10-26T12:00:00.000Z',
    contentHash,
    method: 'background',
    exhibitNumber: index + 1,
    sizeBytes: 11,
    operatorId: 'op-1',
    operatorName: 'Casey Operator',
    toolVersion: '0.4.0',
    index,
    prevHash: expect.any(String),
    entryHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    signature: expect.any(String)
  })

  it('carries the three fields at schema 6, and the strict schema reads it', async () => {
    const { capture, contentHash } = await ingestMhtmlCapture(params({ linkProvenance: LINK }))
    const entry = lastEntry()
    expect(entry).toEqual({ ...body(capture.id, contentHash, 0), ...LINK, schemaVersion: 6 })
    expect(ManifestEntrySchema.safeParse(entry).success).toBe(true)
    expect(getCapture(capture.id)).toMatchObject(LINK)
  })

  it('carries none of them on an ordinary entry, which keeps its own stamp', async () => {
    const { capture, contentHash } = await ingestMhtmlCapture(params())
    const entry = lastEntry()
    expect(entry).toEqual({ ...body(capture.id, contentHash, 0), schemaVersion: 3 })
    expect(ManifestEntrySchema.safeParse(entry).success).toBe(true)
    const row = getCapture(capture.id)
    expect([row?.linkedFromCaptureId, row?.linkedFromContentHash, row?.linkHref]).toEqual([
      undefined,
      undefined,
      undefined
    ])
  })
})
