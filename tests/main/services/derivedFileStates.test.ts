import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import {
  accessSync,
  chmodSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, initDatabase } from '@main/services/db/core'
import { initStorage } from '@main/services/storage'
import { generateReport } from '@main/services/export'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { listDerivedFilesForCase } from '@main/services/db/derivedFileRepo'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import { PACKAGE_ROOT_FILES } from '../../../src/packages/evidence-package-layout/index'
import { HAS_OPENSSL } from '../../helpers/openssl'
import { HAS_JQ } from '../../helpers/jq'
import { seedMixedKindCase, seedUnanchoredDerivedFile } from '../../helpers/mixedKindCase'
import type { ExportOptions } from '@shared/types'

// The whole state space a Derived File can be in at export time, exported in
// both classes and checked for mutual consistency (#1156 round 5).
//
// Four review rounds each found the next corner of one calculation: the entry
// question decided by a read failure, the read decided by a probe, the
// disclosure decided separately from both. Enumerating the space is what ends
// that, because the property under test is not any one wording — it is that
// the package, the index, the two documents, the four counts and the two
// shipped verifiers describe the same object.
//
// Axes: entry {present, absent} x bytes {readable, exists-unreadable, absent}
// x chain {verified, broken}. Twelve states, each exported as an Evidence
// Package and as a Working Copy.

const sh = (dir: string): number => {
  try {
    execFileSync('/bin/sh', [PACKAGE_ROOT_FILES.verifyScript], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return 0
  } catch (error) {
    return (error as { status?: number }).status ?? 1
  }
}

function readStoredZipEntries(path: string): Map<string, Buffer> {
  const zip = readFileSync(path)
  const entries = new Map<string, Buffer>()
  let offset = 0
  while (offset < zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = zip.readUInt32LE(offset + 18)
    const nameLength = zip.readUInt16LE(offset + 26)
    const extraLength = zip.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = zip.subarray(nameStart, nameStart + nameLength).toString('utf-8')
    entries.set(name, zip.subarray(dataStart, dataStart + compressedSize))
    offset = dataStart + compressedSize
  }
  return entries
}

function unpack(entries: Map<string, Buffer>, dir: string): void {
  for (const [name, bytes] of entries) {
    const out = join(dir, name)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, bytes)
  }
}

type Entry = 'present' | 'absent'
type Bytes = 'readable' | 'unreadable' | 'gone'
type Chain = 'verified' | 'broken'

interface StateCase {
  entry: Entry
  bytes: Bytes
  chain: Chain
}

const STATES: StateCase[] = (['present', 'absent'] as Entry[]).flatMap((entry) =>
  (['readable', 'unreadable', 'gone'] as Bytes[]).flatMap((bytes) =>
    (['verified', 'broken'] as Chain[]).map((chain) => ({ entry, bytes, chain }))
  )
)

interface EvidenceIndex {
  exhibits: Array<{
    id: string
    derivedFiles: Array<{ derivation: string; contentHash: string; path: string }>
  }>
}

interface MarkerContents {
  derivedFileCount: number
  unanchoredDerivedFileCount: number
  unverifiableDerivedFileCount: number
  missingDerivedFileCount: number
}

/**
 * The consistency property, asserted identically for every state. Nothing here
 * knows which state it is looking at: what it checks is that the package's own
 * accounts of itself agree.
 */
function assertConsistent(options: {
  label: string
  entries: Map<string, Buffer>
  /** Package-relative path of the derived file under test, when one is expected. */
  subjectPath: string
  /** Every derived-file row the Case holds, so the counts can be summed. */
  caseDerivedFileCount: number
  /** Whether this state's manifest was edited, so anchoring cannot be established. */
  chainBroken: boolean
}): void {
  const { label, entries, subjectPath, caseDerivedFileCount, chainBroken } = options
  const report = entries.get('report.html')!.toString('utf-8')
  const certification = entries.get('certification.html')!.toString('utf-8')
  const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as EvidenceIndex

  const inZip = entries.has(subjectPath)
  const listed = evidence.exhibits.some((exhibit) =>
    exhibit.derivedFiles.some((file) => file.path === subjectPath)
  )
  // Enclosed in the zip iff listed in the index. The index is what a reviewer
  // reconciles the package against, and a row for a file the zip lacks (or a
  // file with no row) is the two disagreeing about the same bytes.
  expect(listed, `${label}: evidence.json row and zip entry disagree`).toBe(inZip)

  // Every path the index names is in the zip, and none carries a null path.
  for (const exhibit of evidence.exhibits) {
    for (const file of exhibit.derivedFiles) {
      expect(file.path, `${label}: evidence.json lists a null path`).toBeTruthy()
      expect(entries.has(file.path), `${label}: evidence.json names ${file.path}`).toBe(true)
    }
  }

  // The report names the file as enclosed iff it is enclosed. "is enclosed
  // beside it" is the sentence that named a path the zip did not contain.
  const namedEnclosed = report.includes(subjectPath)
  expect(namedEnclosed, `${label}: report cites ${subjectPath} but the zip lacks it`).toBe(inZip)

  // Two axes, asserted separately, because the certification stated them as
  // one and so described a file it does not enclose as enclosed.
  //
  // ENCLOSURE: three clauses that partition the Case's derived files, each
  // file in exactly one, summing to the total however the state falls out.
  const counts = {
    enclosed: countIn(certification, /(\d+) derived files? enclosed/),
    missing: countIn(certification, /(\d+) derived files? named by a manifest entry whose stored/),
    unanchored: countIn(certification, /(\d+) unanchored derived files?/),
    unverifiable: countIn(certification, /(\d+) derived files? counted above whose anchoring/)
  }
  const stated = counts.enclosed + counts.missing + counts.unanchored
  expect(stated, `${label}: certification counts ${stated} of ${caseDerivedFileCount}`).toBe(
    caseDerivedFileCount
  )
  // And the enclosed count is the zip's own, read off the index that says what
  // the package holds — not off what the chain said about anchoring.
  const indexedDerived = evidence.exhibits.reduce(
    (total, exhibit) => total + exhibit.derivedFiles.length,
    0
  )
  expect(counts.enclosed, `${label}: certification enclosed vs evidence.json rows`).toBe(
    indexedDerived
  )

  // DISCLOSURE: anchoring cuts the same files the other way. A broken chain
  // leaves every entry-named file unvouched for, so the clause is present and
  // never larger than the files it re-counts; a verified one omits it.
  expect(counts.unverifiable, `${label}: anchoring disclosure`).toBe(
    chainBroken ? caseDerivedFileCount - counts.unanchored : 0
  )
  expect(
    counts.unverifiable,
    `${label}: disclosure is a re-count, not a bucket`
  ).toBeLessThanOrEqual(counts.enclosed + counts.missing)
}

/** First capture group of the first match, or 0 when the clause is absent. */
function countIn(html: string, pattern: RegExp): number {
  const match = pattern.exec(html)
  return match ? Number(match[1]) : 0
}

const RUNS = HAS_OPENSSL && HAS_JQ

describe('derived file states, end to end (#1156)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-derived-states-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator', operatorRole: '', operatorOrganization: '' })
  })

  afterEach(() => {
    closeDatabase()
    // chmod back, or the temp-directory removal fails on the unreadable file.
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 2 })
    }
  })

  for (const state of STATES) {
    const label = `entry ${state.entry} / bytes ${state.bytes} / chain ${state.chain}`

    it(`is internally consistent: ${label}`, async () => {
      const fixture = await seedMixedKindCase({ tempDir, name: label })
      const lifecycle = createCaptureLifecycle({
        selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
      })

      // The subject: the capture's anchored thumbnail when the state wants an
      // entry, and an extra row on the attachment that no entry names when it
      // does not. Both are real products of the app — the backfill writes the
      // first, and X34 the second.
      const thumbnail = listDerivedFilesForCase(fixture.caseId).find(
        (file) => file.exhibitId === fixture.captureId
      )!
      let storedPath = thumbnail.path
      let subjectPath = fixture.thumbnailPackagePath
      if (state.entry === 'absent') {
        const extra = seedUnanchoredDerivedFile(tempDir, fixture.caseId, fixture.attachment.id)
        storedPath = extra.storedPath
        subjectPath = `attachments/${fixture.attachment.id}_text.txt`
      }
      const absolute = join(tempDir, 'captures', storedPath)

      if (state.bytes === 'gone') rmSync(absolute)
      if (state.bytes === 'unreadable') {
        chmodSync(absolute, 0o000)
        let stillReadable: boolean
        try {
          accessSync(absolute, constants.R_OK)
          stillReadable = true
        } catch {
          stillReadable = false
        }
        // Running as root defeats the mode bits, and there is no portable way
        // to make a file unreadable to a process that can read anything. The
        // state is then not producible here and is reported rather than
        // asserted against a file that is in fact readable.
        if (stillReadable) {
          chmodSync(absolute, 0o644)
          return
        }
      }
      if (state.chain === 'broken') {
        const manifestPath = join(tempDir, 'captures', fixture.caseId, 'manifest.jsonl')
        const lines = readFileSync(manifestPath, 'utf-8').trim().split('\n')
        const edited = JSON.parse(lines[0]) as Record<string, unknown>
        edited.operatorName = 'TAMPERED'
        lines[0] = JSON.stringify(edited)
        writeFileSync(manifestPath, lines.join('\n') + '\n')
      }

      const caseDerivedFileCount = listDerivedFilesForCase(fixture.caseId).length
      const base: ExportOptions = {
        format: 'zip',
        include: {
          captures: true,
          screenshots: true,
          auditTrail: true,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath: join(tempDir, 'evidence.zip')
      }

      await generateReport(fixture.caseId, base, lifecycle)
      const evidenceEntries = readStoredZipEntries(base.outputPath)
      assertConsistent({
        label: `evidence package, ${label}`,
        entries: evidenceEntries,
        subjectPath,
        caseDerivedFileCount,
        chainBroken: state.chain === 'broken'
      })

      // The Working Copy carries no report and no certification by design
      // (#399, ADR-0010), so its half of the property is the marker: the files
      // it encloses are the rows it lists, and the four counts still partition
      // the Case.
      const workingCopyPath = join(tempDir, 'working-copy.zip')
      await generateReport(
        fixture.caseId,
        {
          ...base,
          exportClass: 'working-copy',
          include: { ...base.include, auditTrail: false },
          outputPath: workingCopyPath
        },
        lifecycle
      )
      const wcEntries = readStoredZipEntries(workingCopyPath)
      expect(wcEntries.has('report.html')).toBe(false)
      expect(wcEntries.has('certification.html')).toBe(false)
      const marker = JSON.parse(wcEntries.get('WORKING-COPY.json')!.toString('utf-8')) as {
        contents: MarkerContents
        captures: Array<{ derivedFiles: Array<{ path: string }> }>
        exhibits: Array<{ derivedFiles: Array<{ path: string }> }>
      }
      const markerPaths = [...marker.captures, ...marker.exhibits].flatMap((row) =>
        row.derivedFiles.map((file) => file.path)
      )
      for (const path of markerPaths) {
        expect(wcEntries.has(path), `working copy lists ${path}`).toBe(true)
      }
      expect(markerPaths.includes(subjectPath), `${label}: working copy row and zip disagree`).toBe(
        wcEntries.has(subjectPath)
      )
      const { contents } = marker
      // The same two axes as the certification: the three enclosure counts
      // partition the Case, and the unverifiable count re-cuts them by
      // anchoring rather than adding a fourth bucket.
      expect(
        contents.derivedFileCount +
          contents.unanchoredDerivedFileCount +
          contents.missingDerivedFileCount,
        `${label}: working copy counts`
      ).toBe(caseDerivedFileCount)
      expect(contents.derivedFileCount, `${label}: working copy enclosure`).toBe(markerPaths.length)
      expect(contents.unverifiableDerivedFileCount, `${label}: working copy disclosure`).toBe(
        state.chain === 'broken' ? caseDerivedFileCount - contents.unanchoredDerivedFileCount : 0
      )

      // Both shipped verifiers, on the same package, must reach the same
      // verdict: the app-side core the binary is built from, and verify.sh.
      if (RUNS) {
        const dir = join(tempDir, 'unpacked')
        unpack(evidenceEntries, dir)
        const programmatic = verifyEvidencePackage(dir)
        const script = sh(dir)
        expect(
          script === 0,
          `${label}: verify.sh exit ${script} vs core pass=${programmatic.pass}\n` +
            JSON.stringify(programmatic.checks, null, 2)
        ).toBe(programmatic.pass)
      }

      if (state.bytes === 'unreadable') chmodSync(absolute, 0o644)
    })
  }
})
