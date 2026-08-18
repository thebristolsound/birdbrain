/**
 * Invariant tests over report.html and certification.html.
 *
 * PR #216 took three review rounds and seventeen findings, all of one class:
 * the document named a file the package did not contain, or asserted something
 * the export had not established. Each was fixed individually, which is why it
 * took three rounds — the class was never closed.
 *
 * These tests close it. Rather than asserting one wording per known defect,
 * they assert two properties over a matrix of export shapes:
 *
 *   1. Every artefact path the document cites exists in the package.
 *   2. Every companion file the document names exists in the package.
 *
 * A new module, a new citation, or a new export mode is covered automatically.
 * The point is that a future defect of this class fails here without anyone
 * having predicted its specific shape.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import sharp from 'sharp'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { defaultCaptureStore } from '@main/services/captureStore'
import { appendManifestEntry, initManifest } from '@main/services/manifest'
import {
  ingestMhtmlCapture,
  createCaptureLifecycle,
  type CaptureLifecycle
} from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { generateReport } from '@main/services/export'
import { saveAnnotations } from '@main/services/annotations'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { buildSyntheticToken } from '../../helpers/timestampFixtures'
import type { ExportOptions } from '@shared/types'

function readStoredZipEntries(path: string): Map<string, Buffer> {
  const zip = readFileSync(path)
  const entries = new Map<string, Buffer>()
  let offset = 0
  while (offset < zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8)
    const compressedSize = zip.readUInt32LE(offset + 18)
    const nameLength = zip.readUInt16LE(offset + 26)
    const extraLength = zip.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = zip.subarray(nameStart, nameStart + nameLength).toString('utf-8')
    if (method !== 0) throw new Error(`Unexpected compressed ZIP entry in test: ${name}`)
    entries.set(name, zip.subarray(dataStart, dataStart + compressedSize))
    offset = dataStart + compressedSize
  }
  return entries
}

/**
 * Artefact paths the document cites. Deliberately matches only fully-qualified
 * filenames: the methodology and verification sections legitimately mention the
 * bare directories `pages/`, `screenshots/` and `timestamps/` in prose, and
 * naming a directory is not a claim that a particular file is present.
 */
const ARTIFACT_CITATION = /\b(?:pages|screenshots|timestamps)\/[A-Za-z0-9._-]+\.[A-Za-z0-9]+/g

/**
 * Companion files. Named as a closed set rather than scraped, because a
 * document naming a file it invented should fail rather than be tolerated by a
 * pattern loose enough to match it.
 */
const COMPANION_FILES = [
  'evidence.json',
  'manifest.jsonl',
  'certification.html',
  'signing-public-key.pem',
  'tsa-root.pem',
  'tsa-intermediates.pem',
  'VERIFY.md',
  'report.html'
]

function citedArtifacts(html: string): string[] {
  return [...new Set(html.match(ARTIFACT_CITATION) ?? [])]
}

function citedCompanions(html: string): string[] {
  // <code>name</code> is how the documents refer to companion files.
  const inCode = [...html.matchAll(/<code>([^<]+)<\/code>/g)].map((m) => m[1].trim())
  return [...new Set(inCode.filter((n) => COMPANION_FILES.includes(n)))]
}

/** The property under test, applied to one rendered document. */
function assertEveryCitationResolves(
  label: string,
  html: string,
  entries: Map<string, Buffer>
): void {
  const missingArtifacts = citedArtifacts(html).filter((p) => !entries.has(p))
  expect(missingArtifacts, `${label} cites artefact paths absent from the package`).toEqual([])

  const missingCompanions = citedCompanions(html).filter((n) => !entries.has(n))
  expect(missingCompanions, `${label} names companion files absent from the package`).toEqual([])
}

describe('report citation invariants', () => {
  let tempDir: string
  let caseId: string
  let captureLifecycle: CaptureLifecycle

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-invariant-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    initSettings(tempDir)
    updateSettings({
      operatorName: 'Test Operator',
      operatorRole: 'Analyst',
      operatorOrganization: 'Test Org'
    })

    const c = createCase({ name: 'Invariant Case', description: 'Citation invariants' })
    caseId = c.id
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'captures', caseId))
    captureLifecycle = createCaptureLifecycle({
      selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
    })
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function png(): Promise<Buffer> {
    return sharp({
      create: { width: 30, height: 30, channels: 4, background: { r: 7, g: 7, b: 7, alpha: 1 } }
    })
      .png()
      .toBuffer()
  }

  /**
   * The screenshot goes through ingest rather than being written to disk
   * afterwards. That distinction matters: only the ingest path records
   * `screenshotHash` on the capture, and a capture without one cannot exhibit
   * the defects that cite a screenshot from the capture record. Writing the
   * file directly produced captures no real export would ever see, and made
   * these scenarios pass against code that was genuinely broken.
   */
  async function ingest(payload: string, url: string, title: string, screenshot?: Buffer) {
    const stream = Readable.from([Buffer.from(payload)])
    return ingestMhtmlCapture({
      caseId,
      url,
      title,
      timestamp: '2026-04-05T12:00:00.000Z',
      stream: stream as unknown as ReadableStream<Uint8Array>,
      textContent: payload,
      screenshot,
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0'
    })
  }

  async function exportZip(include: ExportOptions['include'], name: string) {
    const outputPath = join(tempDir, `${name}.zip`)
    await generateReport(
      caseId,
      { format: 'zip', include, investigatorName: 'Test', outputPath },
      captureLifecycle
    )
    return readStoredZipEntries(outputPath)
  }

  const FULL: ExportOptions['include'] = {
    captures: true,
    screenshots: true,
    auditTrail: true,
    annotations: 'burned'
  }

  // Each scenario is a shape the export can take. The assertion is identical
  // across all of them; only the world differs.
  const scenarios: Array<{
    name: string
    include: ExportOptions['include']
    setup: () => Promise<void>
  }> = [
    {
      name: 'everything included',
      include: FULL,
      setup: async () => {
        await ingest('<html>a</html>', 'https://example.com/a', 'A', await png())
      }
    },
    {
      name: 'no verification run',
      include: { ...FULL, auditTrail: false },
      setup: async () => {
        await ingest('<html>b</html>', 'https://example.com/b', 'B', await png())
      }
    },
    {
      name: 'screenshots excluded',
      include: { ...FULL, screenshots: false },
      setup: async () => {
        await ingest('<html>c</html>', 'https://example.com/c', 'C', await png())
      }
    },
    {
      name: 'annotations burned in',
      include: FULL,
      setup: async () => {
        const { capture } = await ingest(
          '<html>d</html>',
          'https://example.com/d',
          'D',
          await png()
        )
        saveAnnotations({
          captureId: capture.id,
          shapes: [{ kind: 'redact', id: 'r', x: 2, y: 2, w: 8, h: 8, mode: 'solid' }],
          imageWidth: 30,
          imageHeight: 30
        })
      }
    },
    {
      name: 'page archive deleted after ingest',
      include: FULL,
      setup: async () => {
        const { capture } = await ingest(
          '<html>e</html>',
          'https://example.com/e',
          'E',
          await png()
        )
        rmSync(defaultCaptureStore.artifactPaths(caseId, capture.id, 'mhtml').abs)
      }
    },
    {
      name: 'duplicate content hash sharing one token',
      include: FULL,
      setup: async () => {
        const payload = '<html>dupe</html>'
        const a = await ingest(payload, 'https://example.com/dup-a', 'Dup A', await png())
        await ingest(payload, 'https://example.com/dup-b', 'Dup B', await png())
        appendManifestEntry(join(tempDir, 'captures', caseId), {
          type: 'timestamp',
          caseId,
          captureContentHash: a.capture.hash,
          timestamp: '2026-04-05T12:01:00.000Z',
          tsaToken: buildSyntheticToken({
            contentHash: a.capture.hash,
            genTime: new Date('2026-04-05T12:01:00.000Z'),
            tsaDnsName: 'tsa.example.com'
          }).toString('base64'),
          operatorId: 'op',
          operatorName: 'Test Operator',
          toolVersion: '0.1.0'
        })
      }
    },
    {
      name: 'non-default time-stamping authority',
      include: FULL,
      setup: async () => {
        updateSettings({ tsaUrl: 'https://tsa.example.org/timestamp' })
        await ingest('<html>f</html>', 'https://example.com/f', 'F', await png())
      }
    },
    {
      name: 'case with no captures',
      include: FULL,
      setup: async () => {}
    }
  ]

  for (const [index, scenario] of scenarios.entries()) {
    it(`cites nothing absent from the package — ${scenario.name}`, async () => {
      await scenario.setup()
      const entries = await exportZip(scenario.include, `invariant-${index}`)

      const report = entries.get('report.html')
      expect(report, 'report.html must be in the package').toBeDefined()
      assertEveryCitationResolves('report.html', report!.toString('utf-8'), entries)

      const certification = entries.get('certification.html')
      expect(certification, 'certification.html must be in the package').toBeDefined()
      assertEveryCitationResolves('certification.html', certification!.toString('utf-8'), entries)
    })
  }

  it('detects a dangling citation when one is introduced', async () => {
    // Guards the guard: if the matcher stopped recognising artefact citations,
    // every scenario above would pass vacuously and this suite would be theatre.
    await ingest('<html>g</html>', 'https://example.com/g', 'G', await png())
    const entries = await exportZip(FULL, 'invariant-detect')

    const tampered =
      entries.get('report.html')!.toString('utf-8') +
      `<p>See <code>pages/00000000-0000-0000-0000-000000000000.mhtml</code>.</p>`

    expect(() => assertEveryCitationResolves('tampered', tampered, entries)).toThrow()
  })
})
