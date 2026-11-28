import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase } from '@main/services/db/core'
import type { CaptureLifecycle } from '@main/services/captureLifecycle'
import { generateReport } from '@main/services/export'
import {
  ingestLargePage,
  openStreamedExportCase,
  streamedExportOptions
} from '../../helpers/streamedExportCase'

// The export's peak memory stays well below the size of the package it writes (#932). This
// test has a file to itself because the runner gives each test file its own process, so the
// process's peak memory does not include another suite's.

describe('streamed export memory', () => {
  let tempDir: string
  let caseId: string
  let lifecycle: CaptureLifecycle

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-export-memory-'))
    ;({ caseId, lifecycle } = await openStreamedExportCase(tempDir))
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('holds a small part of the package in memory while it writes it', async () => {
    // Four 32 MiB page archives, streamed into the Case so ingest never holds one whole.
    const MiB = 1024 * 1024
    const chunk = Buffer.alloc(MiB, 0x61)
    function* page(n: number): Generator<Buffer> {
      yield Buffer.from(`<html>${n}</html>`)
      for (let i = 0; i < 32; i++) yield chunk
    }
    for (let n = 0; n < 4; n++) await ingestLargePage(caseId, n, page(n))
    const outputPath = join(tempDir, 'memory.zip')

    const residentBefore = process.memoryUsage().rss
    await generateReport(
      caseId,
      streamedExportOptions(outputPath, { auditTrail: false }),
      lifecycle
    )
    // maxRSS, in KiB, is the highest resident memory the process has reached, so the
    // export's own peak is at most this far above the memory it started from. A higher peak
    // reached before the export makes this larger, never smaller.
    const grewBytes = process.resourceUsage().maxRSS * 1024 - residentBefore

    const packageBytes = statSync(outputPath).size
    expect(packageBytes).toBeGreaterThan(4 * 32 * MiB)
    expect(grewBytes).toBeLessThan(packageBytes / 3)
  })
})
