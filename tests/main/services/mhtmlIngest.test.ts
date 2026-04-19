import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { Readable } from 'stream'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { streamWriteAndHash, ingestMhtmlCapture, verifyCapture } from '@main/services/mhtmlIngest'
import {
  initDatabase,
  closeDatabase,
  createCase,
  getCapture,
  insertCapture
} from '@main/services/database'
import { initManifest, appendManifestEntry, verifyManifestChain } from '@main/services/manifest'

describe('streamWriteAndHash', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-ingest-'))
    initStorage(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('writes stream to disk and returns SHA-256 + size', async () => {
    const content = Buffer.from('hello mhtml world')
    const stream = Readable.from([content])
    const result = await streamWriteAndHash(
      'case-x',
      'cap-x',
      stream as unknown as ReadableStream<Uint8Array>
    )
    expect(result.hash).toBe(createHash('sha256').update(content).digest('hex'))
    expect(result.sizeBytes).toBe(content.length)
    expect(result.mhtmlPath).toBe(join('case-x', 'cap-x.mhtml'))

    const onDisk = readFileSync(join(tempDir, 'case-x', 'cap-x.mhtml'))
    expect(onDisk.equals(content)).toBe(true)
  })

  it('aborts and deletes partial file when size cap exceeded', async () => {
    const oneMb = Buffer.alloc(1024 * 1024, 0x41)
    async function* gen() {
      for (let i = 0; i < 3; i++) yield oneMb
    }
    const stream = Readable.from(gen())
    await expect(
      streamWriteAndHash(
        'case-x',
        'cap-big',
        stream as unknown as ReadableStream<Uint8Array>,
        2 * 1024 * 1024
      )
    ).rejects.toThrow(/size.*exceed/i)
    expect(existsSync(join(tempDir, 'case-x', 'cap-big.mhtml'))).toBe(false)
  })

  it('hashes large streams in a single pass', async () => {
    const chunk = Buffer.alloc(64 * 1024, 0x7a)
    const expected = createHash('sha256')
    async function* gen() {
      for (let i = 0; i < 10; i++) {
        expected.update(chunk)
        yield chunk
      }
    }
    const stream = Readable.from(gen())
    const result = await streamWriteAndHash(
      'case-x',
      'cap-big-ok',
      stream as unknown as ReadableStream<Uint8Array>
    )
    expect(result.hash).toBe(expected.digest('hex'))
    expect(result.sizeBytes).toBe(64 * 1024 * 10)
  })
})

describe('ingestMhtmlCapture', () => {
  let tempDir: string
  let caseId: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-ingest-pipeline-'))
    initStorage(join(tempDir, 'captures'))
    initDatabase(':memory:')
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

  it('rolls back manifest when DB insert fails', async () => {
    const stream = Readable.from([Buffer.from('x')])
    await expect(
      ingestMhtmlCapture({
        caseId: 'does-not-exist',
        url: 'https://example.com',
        title: 'x',
        timestamp: '2026-04-05T12:00:00.000Z',
        stream: stream as unknown as ReadableStream<Uint8Array>,
        textContent: 'x',
        headers: {},
        browserVersion: '',
        userAgent: '',
        httpStatus: 200,
        extensionVersion: '',
        operatorId: '',
        operatorName: '',
        toolVersion: ''
      })
    ).rejects.toThrow()

    const bogusManifest = join(tempDir, 'captures', 'does-not-exist', 'manifest.jsonl')
    if (existsSync(bogusManifest)) {
      expect(readFileSync(bogusManifest, 'utf-8')).toBe('')
    }
  })
})

describe('verifyCapture', () => {
  let tempDir: string
  let caseId: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-verify-'))
    initStorage(join(tempDir, 'captures'))
    initDatabase(':memory:')
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

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-del-'))
    initStorage(join(tempDir, 'captures'))
    initDatabase(':memory:')
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
