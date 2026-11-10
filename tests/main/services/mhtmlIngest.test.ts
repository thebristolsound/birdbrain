import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { randomUUID } from 'crypto'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { ingestMhtmlCapture, verifyCapture } from '@main/services/captureLifecycle'
import { defaultCaptureStore } from '@main/services/captureStore'
import type { CaptureStore } from '@main/services/captureStore'
import { fetchCertChain } from '@main/services/tlsCertChain'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { getCapture, insertCapture, listCaptures } from '@main/services/db/captureRepo'
import { initManifest, appendManifestEntry, verifyManifestChain } from '@main/services/manifest'

// Keep ingest hermetic: the corroboration-only TLS re-fetch (#123) would
// otherwise open a real socket to https://example.com on every ingest. Default
// it to "nothing to corroborate" (null).
vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

describe('ingestMhtmlCapture', () => {
  let tempDir: string
  let caseId: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-ingest-pipeline-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    caseId = createCase({ name: 'Pipeline' }).id
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'captures', caseId))
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('ingests an MHTML capture, writes manifest, inserts DB row', async () => {
    const content = Buffer.from('From: <Saved by Chrome>\nContent-Type: multipart/related\n\nhi')
    const stream = Readable.from([content])
    const result = await ingestMhtmlCapture({
      caseId,
      url: 'https://example.com',
      title: 'Example',
      timestamp: '2026-04-05T12:00:00.000Z',
      stream: stream as unknown as ReadableStream<Uint8Array>,
      textContent: 'hi',
      headers: { 'content-type': 'text/html' },
      browserVersion: 'Chrome/120',
      userAgent: 'Mozilla/5.0',
      httpStatus: 200,
      extensionVersion: '0.1.0',
      operatorId: 'op-1',
      operatorName: 'Smith',
      toolVersion: '0.1.0'
    })

    expect(result.capture.format).toBe('mhtml')
    expect(result.capture.hash).toBe(result.contentHash)
    expect(result.capture.manifestIndex).toBe(0)
    expect(result.capture.entryHash).toMatch(/^[0-9a-f]{64}$/)

    const reloaded = getCapture(result.capture.id)
    expect(reloaded?.mhtmlPath).toBe(join(caseId, `${result.capture.id}.mhtml`))
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)
  })

  it('writes textContent to .txt file alongside MHTML', async () => {
    const content = Buffer.from('mhtml payload')
    const stream = Readable.from([content])
    const result = await ingestMhtmlCapture({
      caseId,
      url: 'https://example.com/text',
      title: 'Text Test',
      timestamp: '2026-04-06T12:00:00.000Z',
      stream: stream as unknown as ReadableStream<Uint8Array>,
      textContent: 'Hello world extracted text',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0'
    })

    const txtPath = join(tempDir, 'captures', caseId, `${result.capture.id}.txt`)
    expect(existsSync(txtPath)).toBe(true)
    expect(readFileSync(txtPath, 'utf-8')).toBe('Hello world extracted text')
  })

  it('does not write .txt file when textContent is empty', async () => {
    const content = Buffer.from('mhtml payload')
    const stream = Readable.from([content])
    const result = await ingestMhtmlCapture({
      caseId,
      url: 'https://example.com/empty',
      title: 'Empty Text',
      timestamp: '2026-04-06T12:00:00.000Z',
      stream: stream as unknown as ReadableStream<Uint8Array>,
      textContent: '',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0'
    })

    const txtPath = join(tempDir, 'captures', caseId, `${result.capture.id}.txt`)
    expect(existsSync(txtPath)).toBe(false)
  })

  it('writes screenshot to .png file and stores screenshotPath in DB', async () => {
    const content = Buffer.from('mhtml payload')
    const stream = Readable.from([content])
    const screenshotData = Buffer.from('fake-png-data')
    const result = await ingestMhtmlCapture({
      caseId,
      url: 'https://example.com/screenshot',
      title: 'Screenshot Test',
      timestamp: '2026-04-06T12:00:00.000Z',
      stream: stream as unknown as ReadableStream<Uint8Array>,
      textContent: '',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0',
      screenshot: screenshotData
    })

    const pngPath = join(tempDir, 'captures', caseId, `${result.capture.id}.png`)
    expect(existsSync(pngPath)).toBe(true)
    expect(readFileSync(pngPath).equals(screenshotData)).toBe(true)

    const reloaded = getCapture(result.capture.id)
    expect(reloaded?.screenshotPath).toBe(join(caseId, `${result.capture.id}.png`))
  })

  it('does not write .png file when screenshot is not provided', async () => {
    const content = Buffer.from('mhtml payload')
    const stream = Readable.from([content])
    const result = await ingestMhtmlCapture({
      caseId,
      url: 'https://example.com/no-screenshot',
      title: 'No Screenshot',
      timestamp: '2026-04-06T12:00:00.000Z',
      stream: stream as unknown as ReadableStream<Uint8Array>,
      textContent: '',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0'
    })

    const pngPath = join(tempDir, 'captures', caseId, `${result.capture.id}.png`)
    expect(existsSync(pngPath)).toBe(false)

    const reloaded = getCapture(result.capture.id)
    expect(reloaded?.screenshotPath).toBeUndefined()
  })

  it('rolls back manifest and removes all artifacts when DB insert fails', async () => {
    // The capture (caseId) FK won't resolve for an unknown case, so db.insertCapture
    // throws inside the seam body — after the sidecars and manifest entry are written.
    const bogusCaseId = 'does-not-exist'
    const bogusDir = join(tempDir, 'captures', bogusCaseId)
    ensureCaseDir(bogusCaseId)
    initManifest(bogusDir)
    const captureCountBefore = listCaptures(caseId).length

    const stream = Readable.from([Buffer.from('x')])
    await expect(
      ingestMhtmlCapture({
        caseId: bogusCaseId,
        url: 'https://example.com',
        title: 'x',
        timestamp: '2026-04-05T12:00:00.000Z',
        stream: stream as unknown as ReadableStream<Uint8Array>,
        textContent: 'orphan text',
        headers: {},
        browserVersion: '',
        userAgent: '',
        httpStatus: 200,
        extensionVersion: '',
        operatorId: '',
        operatorName: '',
        toolVersion: '',
        screenshot: Buffer.from('fake-png')
      })
    ).rejects.toThrow()

    // Manifest rolled back to empty (no recorded capture that didn't land).
    const manifest = join(bogusDir, 'manifest.jsonl')
    expect(readFileSync(manifest, 'utf-8')).toBe('')

    // No orphaned DB row anywhere.
    expect(listCaptures(bogusCaseId)).toHaveLength(0)
    expect(listCaptures(caseId)).toHaveLength(captureCountBefore)

    // All sidecar files removed (.mhtml / .txt / .png).
    const leftover = readdirSync(bogusDir).filter((f) => f !== 'manifest.jsonl')
    expect(leftover).toEqual([])
  })

  it('removes the .mhtml when the manifest append fails before the seam body runs', async () => {
    // Replace manifest.jsonl with a directory so appendManifestEntry throws (EISDIR)
    // inside withCaptureEntry BEFORE the callback runs — the pre-callback failure path
    // where the already-written .mhtml would otherwise be orphaned.
    const caseDirAbs = join(tempDir, 'captures', caseId)
    const manifestPath = join(caseDirAbs, 'manifest.jsonl')
    rmSync(manifestPath, { force: true })
    mkdirSync(manifestPath)
    const before = readdirSync(caseDirAbs).sort()

    const stream = Readable.from([Buffer.from('orphan-bytes')])
    await expect(
      ingestMhtmlCapture({
        caseId,
        url: 'https://example.com',
        title: 'x',
        timestamp: '2026-04-05T12:00:00.000Z',
        stream: stream as unknown as ReadableStream<Uint8Array>,
        textContent: 'orphan text',
        headers: {},
        browserVersion: '',
        userAgent: '',
        httpStatus: 200,
        extensionVersion: '',
        operatorId: '',
        operatorName: '',
        toolVersion: '',
        screenshot: Buffer.from('fake-png')
      })
    ).rejects.toThrow()

    // The .mhtml written before the seam must not be orphaned, and nothing else leaked.
    const after = readdirSync(caseDirAbs).sort()
    expect(after.filter((f) => f.endsWith('.mhtml'))).toEqual([])
    expect(after).toEqual(before)
    expect(listCaptures(caseId)).toHaveLength(0)
  })

  it('delegates rollback cleanup to the store instead of unlinking per extension (#142)', async () => {
    // Same DB-insert failure as the rollback test above, but asserted purely
    // through the store seam: the lifecycle hands cleanup to deleteArtifacts,
    // no per-extension knowledge required in the test.
    const bogusCaseId = 'store-seam-case'
    ensureCaseDir(bogusCaseId)
    initManifest(join(tempDir, 'captures', bogusCaseId))

    const store = {
      ...defaultCaptureStore,
      deleteArtifacts: vi.fn(defaultCaptureStore.deleteArtifacts)
    }

    const stream = Readable.from([Buffer.from('x')])
    await expect(
      ingestMhtmlCapture(
        {
          caseId: bogusCaseId,
          url: 'https://example.com',
          title: 'x',
          timestamp: '2026-04-05T12:00:00.000Z',
          stream: stream as unknown as ReadableStream<Uint8Array>,
          textContent: 'orphan text',
          headers: {},
          browserVersion: '',
          userAgent: '',
          httpStatus: 200,
          extensionVersion: '',
          operatorId: '',
          operatorName: '',
          toolVersion: '',
          screenshot: Buffer.from('fake-png')
        },
        fetchCertChain,
        store
      )
    ).rejects.toThrow()

    expect(store.deleteArtifacts).toHaveBeenCalledTimes(1)
    expect(store.deleteArtifacts).toHaveBeenCalledWith(bogusCaseId, expect.any(String))
    const leftover = readdirSync(join(tempDir, 'captures', bogusCaseId)).filter(
      (f) => f !== 'manifest.jsonl'
    )
    expect(leftover).toEqual([])
  })
})

describe('verifyCapture', () => {
  let tempDir: string
  let caseId: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-verify-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    caseId = createCase({ name: 'V' }).id
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'captures', caseId))
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns verified for intact capture', async () => {
    const stream = Readable.from([Buffer.from('payload')])
    const { capture } = await ingestMhtmlCapture({
      caseId,
      url: 'https://a',
      title: 'A',
      timestamp: '2026-04-05T12:00:00.000Z',
      stream: stream as unknown as ReadableStream<Uint8Array>,
      textContent: '',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0'
    })
    const r = await verifyCapture(capture.id)
    expect(r.status).toBe('verified')
    expect(r.storedHash).toBe(r.computedHash)
  })

  it('returns tampered when MHTML bytes change', async () => {
    const stream = Readable.from([Buffer.from('payload')])
    const { capture } = await ingestMhtmlCapture({
      caseId,
      url: 'https://a',
      title: 'A',
      timestamp: '2026-04-05T12:00:00.000Z',
      stream: stream as unknown as ReadableStream<Uint8Array>,
      textContent: '',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0'
    })
    const absPath = join(tempDir, 'captures', capture.mhtmlPath!)
    const { writeFileSync } = await import('fs')
    writeFileSync(absPath, 'mutated')
    const r = await verifyCapture(capture.id)
    expect(r.status).toBe('tampered')
  })

  it('returns legacy for pre-MHTML captures', async () => {
    const legacy = insertCapture({
      caseId,
      url: 'https://legacy',
      title: 'Legacy',
      hash: 'x'.repeat(64),
      timestamp: new Date().toISOString()
    })
    const r = await verifyCapture(legacy.id)
    expect(r.status).toBe('legacy')
  })
})

describe('deletion manifest entry', () => {
  let tempDir: string
  let caseId: string
  let caseDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-del-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    caseId = createCase({ name: 'D' }).id
    caseDir = join(tempDir, 'captures', caseId)
    ensureCaseDir(caseId)
    initManifest(caseDir)
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('appends deletion entry after capture entry and chain verifies', async () => {
    const stream = Readable.from([Buffer.from('x')])
    const { capture } = await ingestMhtmlCapture({
      caseId,
      url: 'https://a',
      title: 'A',
      timestamp: '2026-04-05T12:00:00.000Z',
      stream: stream as unknown as ReadableStream<Uint8Array>,
      textContent: '',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0'
    })

    appendManifestEntry(caseDir, {
      type: 'deletion',
      captureId: capture.id,
      caseId,
      timestamp: '2026-04-05T13:00:00.000Z',
      contentHash: capture.hash,
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0'
    })

    expect(verifyManifestChain(caseDir).valid).toBe(true)
    const raw = readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')
    const lines = raw.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]).type).toBe('deletion')
  })
})

describe('two background jobs ingesting into one Case', () => {
  let tempDir: string
  let caseId: string
  let caseDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-ingest-slot-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    caseId = createCase({ name: 'Batch' }).id
    caseDir = join(tempDir, 'captures', caseId)
    ensureCaseDir(caseId)
    initManifest(caseDir)
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("keeps the second job's entry when the first job's ingest fails after its append", async () => {
    const firstId = randomUUID()
    const secondId = randomUUID()
    // The first job's seam body fails after its entry is appended, before its row.
    const store: CaptureStore = {
      ...defaultCaptureStore,
      writeText: (writeCaseId, captureId, text) => {
        if (captureId === firstId) throw new Error('disk full')
        return defaultCaptureStore.writeText(writeCaseId, captureId, text)
      }
    }
    // Both renders have finished and both jobs wait on the TLS re-fetch, which then answers
    // both in one turn: without the Case's slot, the second job appends between the first
    // job's append and its rollback, and the rollback's truncation removes that entry.
    let answerRefetch: (result: null) => void = () => {}
    const refetch = new Promise<null>((resolve) => {
      answerRefetch = resolve
    })
    const fetchTls = vi.fn(() => refetch)
    const ingestJob = (captureId: string, url: string) =>
      ingestMhtmlCapture(
        {
          captureId,
          caseId,
          url,
          title: url,
          timestamp: '2026-11-09T12:00:00.000Z',
          stream: Readable.from([
            Buffer.from(`MHTML of ${url}`)
          ]) as unknown as ReadableStream<Uint8Array>,
          textContent: `text of ${url}`,
          headers: {},
          browserVersion: 'Chrome/140',
          userAgent: 'Mozilla/5.0',
          httpStatus: 200,
          operatorId: 'op-1',
          operatorName: 'Smith',
          toolVersion: '0.1.0',
          method: 'background',
          consentSuppression: 'filter-list'
        },
        fetchTls,
        store
      )

    const first = ingestJob(firstId, 'https://example.com/first')
    await vi.waitFor(() => expect(fetchTls).toHaveBeenCalledTimes(1))
    const second = ingestJob(secondId, 'https://example.com/second')
    await vi.waitFor(() => expect(fetchTls).toHaveBeenCalledTimes(2))
    answerRefetch(null)

    await expect(first).rejects.toThrow('disk full')
    const { capture } = await second

    const entries = readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { captureId: string; index: number })
    expect(entries.map(({ captureId }) => captureId)).toEqual([secondId])
    expect(capture.manifestIndex).toBe(entries[0].index)
    expect(verifyManifestChain(caseDir).valid).toBe(true)
    expect((await verifyCapture(secondId)).status).toBe('verified')
    expect(getCapture(firstId)).toBeUndefined()
  })

  // An appender outside the slot, such as the trusted-timestamp worker, can resume in the
  // microtask after a failed ingest's seam body throws.
  it('rolls a failed ingest back before an appender outside the slot resumes', async () => {
    const failedId = randomUUID()
    const appendedHash = 'a'.repeat(64)
    const store: CaptureStore = {
      ...defaultCaptureStore,
      writeText: () => {
        queueMicrotask(() =>
          appendManifestEntry(caseDir, {
            type: 'deletion',
            captureId: randomUUID(),
            caseId,
            timestamp: '2026-11-09T12:00:01.000Z',
            contentHash: appendedHash,
            operatorId: 'op-1',
            operatorName: 'Smith',
            toolVersion: '0.1.0'
          })
        )
        throw new Error('disk full')
      }
    }

    await expect(
      ingestMhtmlCapture(
        {
          captureId: failedId,
          caseId,
          url: 'https://example.com/failed',
          title: 'Failed',
          timestamp: '2026-11-09T12:00:00.000Z',
          stream: Readable.from([Buffer.from('MHTML')]) as unknown as ReadableStream<Uint8Array>,
          textContent: 'text',
          headers: {},
          browserVersion: '',
          userAgent: '',
          httpStatus: 200,
          operatorId: 'op-1',
          operatorName: 'Smith',
          toolVersion: '0.1.0'
        },
        async () => null,
        store
      )
    ).rejects.toThrow('disk full')

    const entries = readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { type: string; contentHash: string })
    expect(entries.map(({ type, contentHash }) => [type, contentHash])).toEqual([
      ['deletion', appendedHash]
    ])
    expect(verifyManifestChain(caseDir).valid).toBe(true)
  })
})
