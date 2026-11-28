import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { closeDatabase, initDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { ensureCaseDir, initStorage } from '@main/services/storage'
import * as manifest from '@main/services/manifest'
import { initManifest } from '@main/services/manifest'
import {
  createCaptureLifecycle,
  ingestMhtmlCapture,
  type CaptureLifecycle
} from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { generateReport } from '@main/services/export'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { PACKAGE_FILE_CHUNK_BYTES } from '@main/services/packageFile'
import { createStoredZip } from '@main/services/zip'
import { readStoredZip } from '@main/services/zipRead'
import type { ExportOptions } from '@shared/types'

// The export writes its zip one chunk at a time (#932). These pin that what it writes is the
// zip the in-memory writer builds from the same members, for a page archive many chunks
// long, that a file changed between the export's first read and the zip write stops it, and
// that the export's peak memory stays well below the size of the package it writes.

const PAGE_BYTES = 5 * PACKAGE_FILE_CHUNK_BYTES + 4321

function pageBytes(seed: number): Buffer {
  const bytes = Buffer.alloc(PAGE_BYTES)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 13 + seed + (i >>> 12)) & 0xff
  return bytes
}

describe('streamed export', () => {
  let tempDir: string
  let caseId: string
  let lifecycle: CaptureLifecycle

  const options = (outputPath: string): ExportOptions => ({
    format: 'zip',
    include: {
      captures: true,
      screenshots: false,
      auditTrail: true,
      notes: false,
      annotations: 'none'
    },
    exportClass: 'evidence',
    outputPath
  })

  const ingest = async (n: number, bytes: Buffer | Iterable<Buffer>) =>
    ingestMhtmlCapture({
      caseId,
      url: `https://example.com/${n}`,
      title: `Large page ${n}`,
      timestamp: '2026-04-05T12:00:00.000Z',
      stream: Readable.from(
        Buffer.isBuffer(bytes) ? [bytes] : bytes
      ) as unknown as ReadableStream<Uint8Array>,
      textContent: `page ${n}`,
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-export-stream-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator', operatorRole: '', operatorOrganization: '' })
    caseId = createCase({ name: 'Streamed Export Case' }).id
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'captures', caseId))
    lifecycle = createCaptureLifecycle({
      selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('writes the zip the in-memory writer builds from the same members', async () => {
    const pages = [pageBytes(1), pageBytes(2), pageBytes(3)]
    for (const [n, bytes] of pages.entries()) await ingest(n, bytes)
    const outputPath = join(tempDir, 'large.zip')

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 28, 9, 30, 0))
    await generateReport(caseId, options(outputPath), lifecycle)

    const written = readFileSync(outputPath)
    const members = readStoredZip(written)
    const enclosedPages = [...members].filter(([name]) => name.endsWith('.mhtml'))
    expect(enclosedPages.map(([, bytes]) => bytes.length)).toEqual([
      PAGE_BYTES,
      PAGE_BYTES,
      PAGE_BYTES
    ])
    expect(enclosedPages.every(([, bytes]) => pages.some((page) => page.equals(bytes)))).toBe(true)
    const rebuilt = createStoredZip([...members].map(([name, data]) => ({ name, data })))
    expect(written.equals(rebuilt)).toBe(true)
  })

  it('stops, writes no package and keeps no export entry when a page changes before the write', async () => {
    const { capture } = await ingest(0, pageBytes(1))
    const pagePath = join(tempDir, 'captures', capture.mhtmlPath!)
    const outputPath = join(tempDir, 'changed.zip')
    // The export entry is appended after the contents decision read every file and before
    // the zip is written, so a change made here is one only the zip write can see.
    const append = manifest.appendManifestEntry
    vi.spyOn(manifest, 'appendManifestEntry').mockImplementation((...args) => {
      const changed = readFileSync(pagePath)
      changed[2 * PACKAGE_FILE_CHUNK_BYTES] ^= 0xff
      writeFileSync(pagePath, changed)
      return append(...args)
    })

    await expect(generateReport(caseId, options(outputPath), lifecycle)).rejects.toThrow(
      `${pagePath} changed on disk after the export first read it; no package was written.`
    )

    expect(existsSync(outputPath)).toBe(false)
    expect(readdirSync(tempDir).filter((name) => name.endsWith('.partial'))).toEqual([])
    const entryTypes = manifest
      .readEntries(readFileSync(join(tempDir, 'captures', caseId, 'manifest.jsonl'), 'utf-8'))
      .map(({ type }) => type)
    expect(entryTypes).toContain('capture')
    expect(entryTypes).not.toContain('export')
  })

  it('holds a small part of the package in memory while it writes it', async () => {
    // Four 32 MiB page archives, streamed into the Case so ingest never holds one whole.
    const MiB = 1024 * 1024
    const chunk = Buffer.alloc(MiB, 0x61)
    function* page(n: number): Generator<Buffer> {
      yield Buffer.from(`<html>${n}</html>`)
      for (let i = 0; i < 32; i++) yield chunk
    }
    for (let n = 0; n < 4; n++) await ingest(n, page(n))
    const outputPath = join(tempDir, 'memory.zip')

    // maxRSS is the highest resident memory this process has reached, in KiB.
    const before = process.resourceUsage().maxRSS
    await generateReport(
      caseId,
      { ...options(outputPath), include: { ...options(outputPath).include, auditTrail: false } },
      lifecycle
    )
    const grewBytes = (process.resourceUsage().maxRSS - before) * 1024

    const packageBytes = statSync(outputPath).size
    expect(packageBytes).toBeGreaterThan(4 * 32 * MiB)
    expect(grewBytes).toBeLessThan(packageBytes / 3)
  })
})
