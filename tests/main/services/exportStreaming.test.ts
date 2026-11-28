import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase } from '@main/services/db/core'
import * as manifest from '@main/services/manifest'
import type { CaptureLifecycle } from '@main/services/captureLifecycle'
import { generateReport } from '@main/services/export'
import { PACKAGE_FILE_CHUNK_BYTES } from '@main/services/packageFile'
import { createStoredZip } from '@main/services/zip'
import { readStoredZip } from '@main/services/zipRead'
import {
  ingestLargePage,
  openStreamedExportCase,
  streamedExportOptions
} from '../../helpers/streamedExportCase'

// The export writes its zip one chunk at a time (#932). These pin that what it writes is the
// zip the in-memory writer builds from the same members, for a page archive many chunks
// long, and that a file changed between the export's first read and the zip write stops it.
// The export's peak memory is pinned in exportMemory.test.ts.

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

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-export-stream-'))
    ;({ caseId, lifecycle } = await openStreamedExportCase(tempDir))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('writes the zip the in-memory writer builds from the same members', async () => {
    const pages = [pageBytes(1), pageBytes(2), pageBytes(3)]
    for (const [n, bytes] of pages.entries()) await ingestLargePage(caseId, n, bytes)
    const outputPath = join(tempDir, 'large.zip')

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 28, 9, 30, 0))
    await generateReport(caseId, streamedExportOptions(outputPath), lifecycle)

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
    const { capture } = await ingestLargePage(caseId, 0, pageBytes(1))
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

    await expect(
      generateReport(caseId, streamedExportOptions(outputPath), lifecycle)
    ).rejects.toThrow(
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
})
