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
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import sharp from 'sharp'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
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
import { commitStagedFiles, uploadToStaging } from '@main/services/staging'
import { backfillCase } from '@main/services/exhibitBackfill'
import { saveAnnotations } from '@main/services/annotations'
import { createWaybackRef, importWaybackRefRows } from '@main/services/db/waybackRefRepo'
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
 *
 * The kind directories a committed exhibit ships under (`attachments/`,
 * `images/`, `documents/`) are matched too (#1156), so an exhibit block citing
 * a file the package does not enclose fails here like any other dangling
 * citation.
 *
 * The pattern is applied to the document with absolute URLs removed rather than
 * being loosened (#401). Pinned archive.org references embed the archived page's
 * own URL, and a page archived from `https://example.com/pages/index.html` is
 * not a claim about this package's `pages/` directory — but a lookbehind wide
 * enough to reject that shape (`(?<![\w/.-])`) also stops matching a genuine
 * citation that happens to follow `/`, `.` or `-`, which would weaken the
 * property silently. Stripping the URLs removes the false positive at its source
 * and leaves the word boundary intact.
 */
const ARTIFACT_CITATION =
  /\b(?:pages|screenshots|timestamps|attachments|images|documents)\/[A-Za-z0-9._-]+\.[A-Za-z0-9]+/g

/** Absolute URLs, which are references to somewhere else and never citations. */
const ABSOLUTE_URL = /https?:\/\/[^\s"'<>]+/g

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
  'verify.sh',
  'report.html',
  'export-entry.json'
]

function citedArtifacts(html: string): string[] {
  const withoutUrls = html.replace(ABSOLUTE_URL, ' ')
  return [...new Set(withoutUrls.match(ARTIFACT_CITATION) ?? [])]
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

  /**
   * A pinned corroboration reference, written exactly as the IPC handler writes
   * one — through the repo, from a snapshot shaped like a CDX row. `mimeType`
   * and `statusCode` are left off deliberately in one call below: the repo
   * returns undefined for a NULL column and the report must render anyway.
   */
  function pinSnapshot(
    captureId: string,
    cdxTimestamp: string,
    originalUrl: string,
    extra: { statusCode?: number; mimeType?: string } = { statusCode: 200, mimeType: 'text/html' }
  ) {
    const iso = `${cdxTimestamp.slice(0, 4)}-${cdxTimestamp.slice(4, 6)}-${cdxTimestamp.slice(
      6,
      8
    )}T${cdxTimestamp.slice(8, 10)}:${cdxTimestamp.slice(10, 12)}:${cdxTimestamp.slice(12, 14)}.000Z`
    return createWaybackRef({
      captureId,
      snapshot: {
        timestamp: iso,
        snapshotUrl: `https://web.archive.org/web/${cdxTimestamp}/${originalUrl}`,
        originalUrl,
        ...extra
      },
      checkedAt: '2026-04-06T09:00:00.000Z'
    })
  }

  async function exportZip(include: ExportOptions['include'], name: string) {
    const outputPath = join(tempDir, `${name}.zip`)
    await generateReport(
      caseId,
      { format: 'zip', include, exportClass: 'evidence', outputPath },
      captureLifecycle
    )
    return readStoredZipEntries(outputPath)
  }

  const FULL: ExportOptions['include'] = {
    captures: true,
    screenshots: true,
    auditTrail: true,
    notes: false,
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
    },
    {
      name: 'capture with pinned archive.org references',
      include: FULL,
      setup: async () => {
        const { capture } = await ingest(
          '<html>h</html>',
          'https://example.com/h',
          'H',
          await png()
        )
        pinSnapshot(capture.id, '20250101000000', 'https://example.com/h')
      }
    },
    {
      // #1156: the property now has to hold over a package carrying exhibits of
      // every kind and a derived file, which is where a new block citing a path
      // the packager never wrote would first appear.
      name: 'committed attachment, image and document with a derived file',
      include: FULL,
      setup: async () => {
        await ingest('<html>mixed</html>', 'https://example.com/mixed', 'Mixed', await png())
        const uploads = join(tempDir, 'uploads')
        mkdirSync(uploads, { recursive: true })
        const write = (name: string, bytes: Buffer): string => {
          const path = join(uploads, name)
          writeFileSync(path, bytes)
          return path
        }
        const staged = await uploadToStaging(caseId, [
          write('bundle.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x61, 0x62])),
          write('photo.png', await png()),
          write('statement.pdf', Buffer.from('%PDF-1.7\n%%EOF\n'))
        ])
        await commitStagedFiles(
          caseId,
          staged.map((row) => row.id)
        )
        await backfillCase(caseId, { toolVersion: '0.1.0' })
      }
    },
    {
      name: 'pinned reference whose archived URL mimics a package path',
      include: FULL,
      setup: async () => {
        const { capture } = await ingest(
          '<html>i</html>',
          'https://example.com/pages/index.html',
          'I',
          await png()
        )
        pinSnapshot(capture.id, '20250101000000', 'https://example.com/pages/index.html')
      }
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

  /**
   * The report sends its reader to VERIFY.md and cites that document's step
   * numbers, so its own numbered list has to be the same steps in the same
   * order. Each report item is paired with the runbook heading it summarises;
   * adding, dropping or reordering a step in either document fails here.
   */
  it("lists VERIFY.md's steps in VERIFY.md's order", async () => {
    await ingest('<html>s</html>', 'https://example.com/steps', 'Steps', await png())
    const entries = await exportZip(FULL, 'step-order')
    const report = entries.get('report.html')!.toString('utf-8')
    const runbook = entries.get('VERIFY.md')!.toString('utf-8')

    const list = /<ol class="steps[^"]*">([\s\S]*?)<\/ol>/.exec(report)
    expect(list).not.toBeNull()
    const reportSteps = [...list![1].matchAll(/<li><strong>([^<]+)<\/strong>/g)].map((m) => m[1])
    const runbookSteps = [...runbook.matchAll(/^## Step (\d+) — (.+)$/gm)].map((m) => [
      Number(m[1]),
      m[2]
    ])

    expect(runbookSteps.map(([n]) => n)).toEqual(runbookSteps.map((_, i) => i + 1))
    expect(reportSteps.map((title, i) => [title, runbookSteps[i]?.[1]])).toEqual([
      ['Check file integrity against the index.', 'File integrity (index self-consistency)'],
      ['Check the entry signatures.', 'Entry signature (`schemaVersion` 2 and above)'],
      ['Recompute each entry hash.', 'Recompute `entryHash` (canonicalization recipe)'],
      ['Check the chain linkage.', 'Chain linkage'],
      [
        'Bind the content to its signed entries.',
        'Content bind (load-bearing for the evidence itself)'
      ],
      ['Validate the timestamp tokens.', 'Timestamp (canonical TSA verification)']
    ])
    expect(reportSteps).toHaveLength(runbookSteps.length)
  })

  /**
   * Known-answer coverage of the pinned-reference rendering (#401), the method
   * this change adds to the report. Each assertion is an answer that must not
   * move without someone deciding it should: what the report says a pinned
   * reference does and does not establish, that a package with no pins is
   * unchanged, and that pinning adds nothing to the package.
   */
  describe('pinned archive.org references', () => {
    it('renders them as corroboration and says what they do not establish', async () => {
      const { capture } = await ingest('<html>p</html>', 'https://example.com/p', 'P', await png())
      // Pinned newest-first, as the repo returns them; the exhibit reads oldest
      // first, so the second reference must precede the first in the document.
      pinSnapshot(capture.id, '20250601120000', 'https://example.com/p')
      pinSnapshot(capture.id, '20250101120000', 'https://example.com/p')
      const entries = await exportZip(FULL, 'wayback-pinned')
      const report = entries.get('report.html')!.toString('utf-8')

      expect(report.indexOf('2025-01-01T12:00:00Z')).toBeLessThan(
        report.indexOf('2025-06-01T12:00:00Z')
      )
      expect(report).toContain('The operator pinned 2 archive.org snapshots')

      expect(report).toContain(
        'Corroboration only — archive.org references, not bound to the capture'
      )
      expect(report).toContain(
        'https://web.archive.org/web/20250101120000/https://example.com/p'
      )
      expect(report).toContain('2025-01-01T12:00:00Z')
      // The interval to the capture, stated in words rather than left signed.
      expect(report).toMatch(/\d+d( \d+h)? before capture/)
      // What it establishes, and the two things it does not.
      expect(report).toContain('archive.org listed a snapshot at the stated time')
      expect(report).toContain('does not establish what the archived')
      expect(report).toContain('Birdbrain did not')
    })

    it('renders a reference whose CDX row carried no status or content type', async () => {
      const { capture } = await ingest('<html>q</html>', 'https://example.com/q', 'Q', await png())
      pinSnapshot(capture.id, '20250101120000', 'https://example.com/q', {})
      const entries = await exportZip(FULL, 'wayback-sparse')
      const report = entries.get('report.html')!.toString('utf-8')

      expect(report).toContain(
        'Corroboration only — archive.org references, not bound to the capture'
      )
      expect(report).toContain('looked up 2026-04-06T09:00:00Z')
      expect(report).not.toContain('HTTP undefined')
    })

    it('cannot carry a hostile status code from an imported archive as markup', async () => {
      // The reachable hostile path, end to end: a `.birdbrain` archive is parsed
      // with a bare cast and no schema, `importWaybackRefRows` binds whatever
      // `status_code` it carried, and SQLite INTEGER affinity keeps non-numeric
      // text as TEXT. The known answer is that nothing an archive author wrote
      // into that column reaches report.html as markup.
      const hostile = '"><script>alert(1)</script>'
      const { capture } = await ingest('<html>x</html>', 'https://example.com/x', 'X', await png())
      importWaybackRefRows(
        [
          {
            id: 'hostile-ref',
            capture_id: capture.id,
            snapshot_timestamp: '2025-01-01T12:00:00.000Z',
            snapshot_url: 'https://web.archive.org/web/20250101120000/https://example.com/x',
            original_url: 'https://example.com/x',
            digest: null,
            status_code: hostile,
            mime_type: 'text/html',
            checked_at: '2026-04-06T09:00:00.000Z',
            pinned_at: '2026-04-06T09:00:00.000Z'
          }
        ],
        { newCaseId: caseId, mapId: (id) => id, mapTag: (id) => id, getText: () => '' }
      )

      const entries = await exportZip(FULL, 'wayback-hostile-status')
      const report = entries.get('report.html')!.toString('utf-8')

      // The reference still renders — the package is not silently short a pin.
      expect(report).toContain(
        'Corroboration only — archive.org references, not bound to the capture'
      )
      expect(report).toContain('https://web.archive.org/web/20250101120000/https://example.com/x')
      // But the status is gone rather than rendered, escaped or otherwise: a
      // value that is not a number is not an HTTP status.
      expect(report).not.toContain('<script>alert(1)</script>')
      expect(report).not.toContain(hostile)
      expect(report).not.toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(report).not.toContain('HTTP undefined')
      // The only "HTTP" left is the capture's own HTTP status row.
      expect(report).not.toMatch(/HTTP (?!status\b)/)
    })

    it('leaves a package with no pins exactly as it was', async () => {
      // The backward case in its testable form: nothing about the report or the
      // package changes for a case that has pinned nothing, so packages produced
      // before this change are still the packages this code produces.
      await ingest('<html>r</html>', 'https://example.com/r', 'R', await png())
      const entries = await exportZip(FULL, 'wayback-none')
      const report = entries.get('report.html')!.toString('utf-8')

      expect(report).not.toContain('archive.org references')
      expect(report).not.toContain('web.archive.org')
    })

    it('adds no file to the package — a pin is a reference, never content', async () => {
      const { capture } = await ingest('<html>s</html>', 'https://example.com/s', 'S', await png())
      const before = await exportZip(FULL, 'wayback-before')
      pinSnapshot(capture.id, '20250101120000', 'https://example.com/s')
      const after = await exportZip(FULL, 'wayback-after')

      expect([...after.keys()].sort()).toEqual([...before.keys()].sort())

      // And pinning appended nothing to the chain, so an existing package's
      // verification is untouched. The one entry the second package's manifest
      // has that the first's does not is the first export's own export entry —
      // appended by exporting, not by pinning.
      const entriesOf = (zip: Map<string, Buffer>) =>
        zip
          .get('manifest.jsonl')!
          .toString('utf-8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as { type: string })
      const beforeEntries = entriesOf(before)
      const afterEntries = entriesOf(after)
      expect(afterEntries.slice(0, beforeEntries.length)).toEqual(beforeEntries)
      expect(afterEntries.slice(beforeEntries.length).map((entry) => entry.type)).toEqual([
        'export'
      ])
    })

    it('does not read an external reference as a claim about a packaged path', async () => {
      // The report now carries archive.org URLs that embed the archived page's
      // own path. One of those can look exactly like a package citation, and the
      // property must neither trip on it nor stop seeing the real citation.
      const { capture } = await ingest(
        '<html>t</html>',
        'https://example.com/screenshots/t.png',
        'T',
        await png()
      )
      pinSnapshot(capture.id, '20250101120000', 'https://example.com/screenshots/t.png')
      const entries = await exportZip(FULL, 'wayback-lookalike')
      const report = entries.get('report.html')!.toString('utf-8')

      expect(report).toContain('https://web.archive.org/web/20250101120000/https://example.com/screenshots/t.png')
      assertEveryCitationResolves('report.html', report, entries)
      // Anti-vacuity: the genuine packaged paths are still being detected.
      const cited = citedArtifacts(report)
      expect(cited.some((path) => path.startsWith('pages/'))).toBe(true)
      expect(cited.some((path) => path.startsWith('screenshots/'))).toBe(true)
      expect(cited).not.toContain('screenshots/t.png')
    })
  })

  /**
   * Known answer for an Exhibit whose row carries no number, which a database
   * restored by hand or an imported archive row can hold: the report says the
   * number was not recorded rather than citing "Exhibit 0". A file Exhibit
   * follows the capture rule here, as it did before Member Code citations.
   */
  it('cites a file Exhibit with no recorded number as not recorded', async () => {
    const uploads = join(tempDir, 'uploads')
    mkdirSync(uploads, { recursive: true })
    const path = join(uploads, 'zero.pdf')
    writeFileSync(path, Buffer.from('%PDF-1.7\n%%EOF\n'))
    const staged = await uploadToStaging(caseId, [path])
    await commitStagedFiles(
      caseId,
      staged.map((row) => row.id)
    )
    getDb().prepare('UPDATE exhibits SET exhibit_number = 0 WHERE case_id = ?').run(caseId)

    const report = (await exportZip(FULL, 'unnumbered')).get('report.html')!.toString('utf-8')

    expect(report).toContain('Exhibit (number not recorded) — zero.pdf')
    expect(report).toContain('<span class="exhibit-tag">Exhibit (number not recorded)</span>')
    expect(report).not.toMatch(/Exhibit 0\b/)
  })

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
