import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  accessSync,
  chmodSync,
  constants,
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import sharp from 'sharp'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase, updateCase } from '@main/services/db/caseRepo'
import {
  deleteCapture,
  insertCapture,
  listCaptures,
  setCaptureTrustedTime
} from '@main/services/db/captureRepo'
import { listExhibits } from '@main/services/db/exhibitRepo'
import { listDerivedFilesForCase } from '@main/services/db/derivedFileRepo'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { appendFutureEntry } from '../../helpers/futureManifestEntry'
import { defaultCaptureStore } from '@main/services/captureStore'
import * as manifest from '@main/services/manifest'
import * as waybackRefRepo from '@main/services/db/waybackRefRepo'
import { createWaybackRef } from '@main/services/db/waybackRefRepo'
import {
  appendManifestEntry,
  getManifestHead,
  initManifest,
  verifyManifestChain
} from '@main/services/manifest'
import { canonicalStringify, parseTimestampToken } from '@shared/verify'
import { TRUSTED_TIME_LABELS, TRUSTED_TIME_UNNAMED_TSA } from '@shared/trustedTimeDisclosure'
import { ingestMhtmlCapture } from '@main/services/captureLifecycle'
import { createCaptureLifecycle, type CaptureLifecycle } from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import {
  verifyCaptures,
  generateReport,
  getExportPreflight,
  buildNotesMarkdown,
  noteTravelsWithSelection
} from '@main/services/export'
import { createNote } from '@main/services/db/noteRepo'
import { saveAnnotations, upsertPin, deletePin } from '@main/services/annotations'
import { buildSyntheticToken } from '../../helpers/timestampFixtures'
import {
  seedMixedKindCase,
  seedUnanchoredDerivedFile,
  type MixedKindCase
} from '../../helpers/mixedKindCase'
import { initSettings, updateSettings } from '@main/services/settings'
import {
  getInstallationId,
  initInstallationId,
  resetInstallationId
} from '@main/services/installationId'
import type { ExportOptions, Note } from '@shared/types'

// Skipped rather than failed when jq is absent: unlike openssl, jq is not a
// keystone proof — it is the convenience command the runbook offers for finding
// unsigned entries, and the fact those entries exist is asserted without it.
const HAS_JQ = (() => {
  try {
    execFileSync('jq', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

// A pre-signing manifest entry: schemaVersion 1, no `signature` key at all.
// Written as the genesis entry because a chain may go v1 -> v2 as the tool was
// upgraded but never back — verifyManifestChain rejects a v1 entry after a
// signed one as a schema downgrade, which is a different finding entirely.
async function seedLegacyGenesisCapture(caseId: string, caseDir: string) {
  const bytes = 'legacy bytes'
  const capture = insertCapture({
    caseId,
    url: 'https://legacy.example/page',
    title: 'Legacy Page',
    hash: createHash('sha256').update(bytes).digest('hex'),
    timestamp: '2026-04-05T11:00:00.000Z'
  })
  await defaultCaptureStore.writeMhtmlStream(
    caseId,
    capture.id,
    Readable.from([Buffer.from(bytes)]) as unknown as ReadableStream<Uint8Array>
  )

  const body = {
    type: 'capture',
    captureId: capture.id,
    caseId,
    url: 'https://legacy.example/page',
    timestamp: '2026-04-05T11:00:00.000Z',
    contentHash: capture.hash,
    sizeBytes: Buffer.byteLength(bytes),
    operatorId: 'op',
    operatorName: '',
    toolVersion: '0.0.1',
    index: 0,
    prevHash: '',
    schemaVersion: 1
  }
  writeFileSync(
    join(caseDir, 'manifest.jsonl'),
    JSON.stringify({
      ...body,
      entryHash: createHash('sha256').update(canonicalStringify(body)).digest('hex')
    }) + '\n'
  )

  return capture
}

const sha256Hex = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

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

async function ingest(
  caseId: string,
  payload: string,
  url = 'https://example.com',
  title = 'Test'
) {
  const stream = Readable.from([Buffer.from(payload)])
  return ingestMhtmlCapture({
    caseId,
    url,
    title,
    timestamp: '2026-04-05T12:00:00.000Z',
    stream: stream as unknown as ReadableStream<Uint8Array>,
    textContent: payload,
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

describe('export', () => {
  let tempDir: string
  let caseId: string
  let captureLifecycle: CaptureLifecycle

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-export-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    initSettings(tempDir)
    // Default: operator name set so existing tests pass
    updateSettings({ operatorName: 'Test Operator', operatorRole: '', operatorOrganization: '' })

    const c = createCase({ name: 'Export Test Case', description: 'Test case for export' })
    caseId = c.id
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'captures', caseId))
    const selectorLifecycle = createSelectorLifecycle({ emitRematched: () => {} })
    captureLifecycle = createCaptureLifecycle({ selectorLifecycle })
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('verifyCaptures marks verified when hash matches', async () => {
    await ingest(caseId, '<html><body>Test content</body></html>')

    const results = await verifyCaptures(listCaptures(caseId), captureLifecycle)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('verified')
    expect(results[0].storedHash).toBe(results[0].computedHash)
  })

  it('verifyCaptures marks tampered when file bytes change after ingest', async () => {
    const { capture } = await ingest(caseId, '<html><body>Original</body></html>')
    writeFileSync(join(tempDir, 'captures', capture.mhtmlPath!), 'mutated bytes')

    const results = await verifyCaptures(listCaptures(caseId), captureLifecycle)
    expect(results[0].status).toBe('tampered')
  })

  it('verifyCaptures marks missing when MHTML file is gone', async () => {
    const { capture } = await ingest(caseId, '<html><body>Vanishing</body></html>')
    rmSync(join(tempDir, 'captures', capture.mhtmlPath!))

    const results = await verifyCaptures(listCaptures(caseId), captureLifecycle)
    expect(results[0].status).toBe('missing')
  })

  it('verifyCaptures marks legacy for pre-MHTML HTML captures', async () => {
    insertCapture({
      caseId,
      url: 'https://legacy.example',
      title: 'Legacy',
      hash: 'x'.repeat(64),
      timestamp: '2024-01-01T00:00:00Z'
    })

    const results = await verifyCaptures(listCaptures(caseId), captureLifecycle)
    expect(results[0].status).toBe('legacy')
  })

  it('generates HTML report with audit trail', async () => {
    await ingest(
      caseId,
      '<html><body>Page content</body></html>',
      'https://example.com',
      'Test Page'
    )

    const outputPath = join(tempDir, 'report.html')
    const options: ExportOptions = {
      format: 'html',
      include: {
        captures: true,
        screenshots: false,
        auditTrail: true,
        notes: false,
        annotations: 'none'
      },
      exportClass: 'evidence',
      outputPath
    }

    await generateReport(caseId, options, captureLifecycle)
    expect(existsSync(outputPath)).toBe(true)

    const content = readFileSync(outputPath, 'utf-8')
    expect(content).toContain('Export Test Case')
    // The Operator is the only signer vocabulary (#399): the report names the
    // operator from settings, and the Investigator vestige is gone.
    expect(content).toContain('Test Operator')
    expect(content).not.toContain('Investigator')
    expect(content).toContain('example.com')
    expect(content).toContain('Birdbrain')
    expect(content).toContain('Exhibit index and verification results')
    expect(content).toContain('Verified')
  })

  it('reports chain captures the package does not contain rather than omitting them', async () => {
    const { capture } = await ingest(
      caseId,
      '<html><body>Packaged evidence</body></html>',
      'https://example.com/packaged',
      'Packaged Page'
    )

    // A capture entry signed into the chain whose row and files are gone, with no
    // deletion entry to account for it — the state the pipeline self-test used to
    // leave behind (#580). The chain claims two captures; the package holds one.
    appendManifestEntry(join(tempDir, 'captures', caseId), {
      type: 'capture',
      captureId: 'orphan-capture-id',
      caseId,
      url: 'birdbrain://pipeline-test',
      timestamp: '2026-04-05T12:00:00.000Z',
      contentHash: createHash('sha256').update('orphan').digest('hex'),
      sizeBytes: 0,
      operatorId: 'op',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })

    const outputPath = join(tempDir, 'orphan-evidence.zip')
    await generateReport(
      caseId,
      {
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
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      warnings: { unreconciledChainCaptureCount: number; unreconciledChainCaptureIds: string[] }
      captures: Array<{ id: string }>
    }

    expect(evidence.warnings.unreconciledChainCaptureCount).toBe(1)
    expect(evidence.warnings.unreconciledChainCaptureIds).toEqual(['orphan-capture-id'])
    expect(evidence.captures.map((c) => c.id)).toEqual([capture.id])
  })

  it('does not report a chain capture that carries a matching deletion entry', async () => {
    const { capture } = await ingest(
      caseId,
      '<html><body>Deleted evidence</body></html>',
      'https://example.com/deleted',
      'Deleted Page'
    )
    await captureLifecycle.delete(capture.id, 'pipeline-test')

    const outputPath = join(tempDir, 'deleted-evidence.zip')
    await generateReport(
      caseId,
      {
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
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      warnings: { unreconciledChainCaptureCount: number }
    }
    const manifest = entries.get('manifest.jsonl')!.toString('utf-8')

    expect(manifest).toContain('"reason":"pipeline-test"')
    expect(evidence.warnings.unreconciledChainCaptureCount).toBe(0)
  })

  it('generates a self-contained evidence ZIP with manifest, report, keys, and captures', async () => {
    const { capture } = await ingest(
      caseId,
      '<html><body>Packaged evidence</body></html>',
      'https://example.com/evidence',
      'Evidence Page'
    )
    // A real DigiCert token, but over the digest in content-hash.txt rather
    // than this capture's — so it attests other content and is no stamp for it.
    // Its certificates are still gathered into tsa-intermediates.pem, which is
    // what the count below reads (#1108).
    const token = readFileSync(join(process.cwd(), 'tests/fixtures/timestamp/digicert-token.der'))
    appendManifestEntry(join(tempDir, 'captures', caseId), {
      type: 'timestamp',
      caseId,
      captureContentHash: capture.hash,
      timestamp: '2026-04-05T12:01:00.000Z',
      tsaToken: token.toString('base64'),
      operatorId: 'op',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })

    const outputPath = join(tempDir, 'evidence.zip')
    const options: ExportOptions = {
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
    }

    await generateReport(caseId, options, captureLifecycle)
    const entries = readStoredZipEntries(outputPath)

    expect(entries.has('evidence.json')).toBe(true)
    expect(entries.has('manifest.jsonl')).toBe(true)
    expect(entries.has('report.html')).toBe(true)
    expect(entries.has('signing-public-key.pem')).toBe(true)
    expect(entries.has('tsa-root.pem')).toBe(true)
    expect(entries.has('tsa-intermediates.pem')).toBe(true)
    expect(entries.has(`pages/${capture.id}.mhtml`)).toBe(true)
    expect(entries.has(`timestamps/${capture.id}.tst`)).toBe(false)
    expect(
      entries
        .get('tsa-root.pem')!
        .toString('utf-8')
        .match(/BEGIN CERTIFICATE/g)?.length
    ).toBe(1)
    expect(
      entries
        .get('tsa-intermediates.pem')!
        .toString('utf-8')
        .match(/BEGIN CERTIFICATE/g)?.length
    ).toBeGreaterThan(1)

    const manifest = entries.get('manifest.jsonl')!.toString('utf-8')
    expect(manifest).toContain('"type":"capture"')
    expect(manifest).toContain('"signature"')

    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      captures: Array<{
        id: string
        mhtmlPath: string
        mhtmlSha256: string
        trustedTime: string
        timestampTokenPaths: string[]
      }>
      verificationMaterials: { manifestPath: string; signingPublicKeyPath: string }
      warnings: { unstampedCaptureCount: number }
    }

    const mhtml = entries.get(`pages/${capture.id}.mhtml`)!
    expect(evidence.verificationMaterials.manifestPath).toBe('manifest.jsonl')
    expect(evidence.verificationMaterials.signingPublicKeyPath).toBe('signing-public-key.pem')
    expect(evidence.warnings.unstampedCaptureCount).toBe(1)
    expect(evidence.captures[0]).toMatchObject({
      id: capture.id,
      mhtmlPath: `pages/${capture.id}.mhtml`,
      mhtmlSha256: createHash('sha256').update(mhtml).digest('hex'),
      trustedTime: 'pending',
      // Unstamped and cites nothing: the token the manifest carries does not
      // bind this capture, so the package encloses no token file for it and
      // the index names none (#1108).
      timestampTokenPaths: []
    })
  })

  it('records a signed, hash-chained export entry on the case manifest (#124)', async () => {
    await ingest(caseId, '<html><body>Audited export</body></html>', 'https://example.com', 'A')

    const caseDir = join(tempDir, 'captures', caseId)
    const headBefore = getManifestHead(caseDir)

    const outputPath = join(tempDir, 'audited-evidence.zip')
    const options: ExportOptions = {
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
    }
    await generateReport(caseId, options, captureLifecycle)

    const manifest = readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>)

    const exportEntries = manifest.filter((e) => e.type === 'export')
    expect(exportEntries).toHaveLength(1)
    const entry = exportEntries[0]

    expect(entry.caseId).toBe(caseId)
    expect(entry.operatorId).toBe(getInstallationId())
    expect(entry.operatorName).toBe('Test Operator')
    expect(typeof entry.packageHash).toBe('string')
    expect((entry.packageHash as string).length).toBe(64)
    expect(typeof entry.timestamp).toBe('string')
    expect(entry.verificationResult).toMatchObject({
      overallValid: true,
      captureCount: 1,
      verifiedCount: 1,
      tamperedCount: 0,
      missingCount: 0
    })

    // Signed + chained to the prior head.
    expect(typeof entry.signature).toBe('string')
    expect((entry.signature as string).length).toBeGreaterThan(0)
    expect(entry.index).toBe(headBefore.nextIndex)
    expect(entry.prevHash).toBe(headBefore.prevHash)

    // The whole chain (capture + export) still verifies.
    expect(verifyManifestChain(caseDir).valid).toBe(true)

    // The export entry's packageHash matches sha256(canonicalStringify(sortedArtifacts))
    // recomputed from the bundled evidence.json artifact list.
    const entries = readStoredZipEntries(outputPath)
    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      artifacts: Array<{ path: string; sha256: string; sizeBytes: number }>
    }
    const sorted = [...evidence.artifacts].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0
    )
    const expectedHash = createHash('sha256')
      .update(canonicalStringify(sorted), 'utf-8')
      .digest('hex')
    expect(entry.packageHash).toBe(expectedHash)
  })

  // #398: the export entry's signed line ships inside the package it records,
  // outside `artifacts` and outside packageHash, exactly like evidence.json.
  it('ships the signed export entry as export-entry.json, outside artifacts and packageHash', async () => {
    await ingest(caseId, '<html><body>Entry shipped</body></html>', 'https://example.com', 'E')

    const caseDir = join(tempDir, 'captures', caseId)
    const outputPath = join(tempDir, 'entry-evidence.zip')
    await generateReport(
      caseId,
      {
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
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    const exportEntryText = entries.get('export-entry.json')!.toString('utf-8')
    const bundledManifest = entries.get('manifest.jsonl')!.toString('utf-8')

    // Byte fidelity: the live manifest IS the bundled copy plus this line.
    expect(readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')).toBe(
      bundledManifest + exportEntryText
    )

    // The entry extends the bundled chain head — the linkage the verifier
    // checks before trusting the entry's scope.
    const entry = JSON.parse(exportEntryText) as Record<string, unknown>
    const bundledLines = bundledManifest.split('\n').filter((l) => l.trim())
    const bundledHead = JSON.parse(bundledLines[bundledLines.length - 1]) as Record<string, unknown>
    expect(entry.type).toBe('export')
    expect(entry.prevHash).toBe(bundledHead.entryHash)
    expect(entry.index).toBe((bundledHead.index as number) + 1)
    expect(typeof entry.signature).toBe('string')

    // The entryHash recomputes over the canonical body (minus hash + signature).
    const { entryHash, signature: _sig, ...body } = entry
    void _sig
    expect(createHash('sha256').update(canonicalStringify(body)).digest('hex')).toBe(entryHash)

    // Outside artifacts (and therefore outside packageHash, whose recipe covers
    // exactly the artifact list — pinned by the packageHash recompute test).
    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      artifacts: Array<{ path: string }>
    }
    expect(evidence.artifacts.some((a) => a.path === 'export-entry.json')).toBe(false)
  })

  it('omits scope and captureIds entirely on a case-scoped export entry', async () => {
    await ingest(caseId, '<html><body>Case scoped</body></html>', 'https://example.com', 'C')

    const outputPath = join(tempDir, 'case-scoped-evidence.zip')
    await generateReport(
      caseId,
      {
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
      },
      captureLifecycle
    )

    // Raw line, not the parsed object: the omission is a byte-level property —
    // present-means-selection is what keeps case-scoped entries hash-identical
    // to pre-scope ones (#398 intake ruling).
    const line = readStoredZipEntries(outputPath).get('export-entry.json')!.toString('utf-8')
    expect(line).not.toContain('"scope"')
    expect(line).not.toContain('"captureIds"')
  })

  // #398 acceptance criteria 1 and 4: artifact membership follows the
  // selection, the manifest ships complete regardless, and a case with a
  // deletion still exports and reconciles end to end.
  it('selection export packages only the selection while the manifest ships complete', async () => {
    const { capture: selected } = await ingest(
      caseId,
      '<html><body>Selected</body></html>',
      'https://example.com/selected',
      'Selected'
    )
    const { capture: unselected } = await ingest(
      caseId,
      '<html><body>Unselected</body></html>',
      'https://example.com/unselected',
      'Unselected'
    )
    const { capture: doomed } = await ingest(
      caseId,
      '<html><body>Doomed</body></html>',
      'https://example.com/doomed',
      'Doomed'
    )
    await captureLifecycle.delete(doomed.id, 'no longer needed')

    const caseDir = join(tempDir, 'captures', caseId)
    const outputPath = join(tempDir, 'selection-evidence.zip')
    await generateReport(
      caseId,
      {
        format: 'zip',
        include: {
          captures: true,
          screenshots: false,
          auditTrail: true,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath,
        captureIds: [selected.id]
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)

    // Artifact membership follows the selection...
    expect([...entries.keys()].filter((k) => k.startsWith('pages/'))).toEqual([
      `pages/${selected.id}.mhtml`
    ])
    // ...while the bundled manifest is the complete chain: the unselected
    // capture and the deletion both remain visible in it.
    const bundledManifest = entries.get('manifest.jsonl')!.toString('utf-8')
    expect(bundledManifest).toContain(unselected.id)
    expect(bundledManifest).toContain(doomed.id)
    expect(bundledManifest).toContain('"type":"deletion"')

    // The signed entry records the scope, and only the selection is verified.
    const entry = JSON.parse(entries.get('export-entry.json')!.toString('utf-8')) as {
      scope: string
      captureIds: string[]
      verificationResult: { captureCount: number; verifiedCount: number }
    }
    expect(entry.scope).toBe('selection')
    expect(entry.captureIds).toEqual([selected.id])
    expect(entry.verificationResult).toMatchObject({ captureCount: 1, verifiedCount: 1 })
    expect(readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')).toBe(
      bundledManifest + entries.get('export-entry.json')!.toString('utf-8')
    )

    // The index covers the selection, and deliberately unselected captures are
    // NOT reported as unreconciled chain orphans (#580 stays for real orphans).
    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      captures: Array<{ id: string }>
      warnings: { unreconciledChainCaptureCount: number }
    }
    expect(evidence.captures.map((c) => c.id)).toEqual([selected.id])
    expect(evidence.warnings.unreconciledChainCaptureCount).toBe(0)

    // The report states the ADR-0009 reconciliation plainly.
    const report = entries.get('report.html')!.toString('utf-8')
    expect(report).toContain('Selection-scoped export')
    expect(report).toContain('export-entry.json')
    expect(report).toContain('1 of the')
  })

  it('loads pinned Wayback references per exported capture, and only those in scope', async () => {
    const { capture: selected } = await ingest(
      caseId,
      '<html><body>Selected</body></html>',
      'https://example.com/selected',
      'Selected'
    )
    const { capture: unselected } = await ingest(
      caseId,
      '<html><body>Unselected</body></html>',
      'https://example.com/unselected',
      'Unselected'
    )
    // One pin on each capture, distinguishable in the rendered report.
    for (const [capture, cdx] of [
      [selected, '20250101000000'],
      [unselected, '20240202000000']
    ] as const) {
      createWaybackRef({
        captureId: capture.id,
        snapshot: {
          timestamp: `${cdx.slice(0, 4)}-${cdx.slice(4, 6)}-${cdx.slice(6, 8)}T00:00:00.000Z`,
          snapshotUrl: `https://web.archive.org/web/${cdx}/${capture.url}`,
          originalUrl: capture.url,
          statusCode: 200,
          mimeType: 'text/html'
        },
        checkedAt: '2026-04-06T09:00:00.000Z'
      })
    }

    const listSpy = vi.spyOn(waybackRefRepo, 'listWaybackRefs')
    const outputPath = join(tempDir, 'wayback-scope.zip')
    await generateReport(
      caseId,
      {
        format: 'zip',
        include: {
          captures: true,
          screenshots: false,
          auditTrail: false,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath,
        captureIds: [selected.id]
      },
      captureLifecycle
    )

    // Read per capture from the repo, not inferred from the lookup or the URL.
    expect(listSpy.mock.calls).toEqual([[selected.id]])
    listSpy.mockRestore()

    const report = readStoredZipEntries(outputPath).get('report.html')!.toString('utf-8')
    expect(report).toContain('https://web.archive.org/web/20250101000000/')
    // The unselected capture's pin has no exhibit to hang off in this package.
    expect(report).not.toContain('20240202000000')
  })

  it('states the selection scope in a standalone HTML export without package-only copy', async () => {
    const { capture: selected } = await ingest(
      caseId,
      '<html><body>Selected</body></html>',
      'https://example.com/selected',
      'Selected'
    )
    await ingest(
      caseId,
      '<html><body>Unselected</body></html>',
      'https://example.com/unselected',
      'Unselected'
    )

    const outputPath = join(tempDir, 'selection-report.html')
    await generateReport(
      caseId,
      {
        format: 'html',
        include: {
          captures: true,
          screenshots: false,
          auditTrail: true,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath,
        captureIds: [selected.id]
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    expect(html).toContain('Selection-scoped export')
    expect(html).toContain('1 of the')
    // A standalone report encloses nothing, so the packaged-manifest sentence
    // (and its export-entry.json reference) must not appear.
    expect(html).not.toContain('export-entry.json')
  })

  it('rejects a selection naming captures the case does not hold', async () => {
    await ingest(caseId, '<html><body>Only capture</body></html>', 'https://example.com', 'Only')

    await expect(
      generateReport(
        caseId,
        {
          format: 'zip',
          include: {
            captures: true,
            screenshots: false,
            auditTrail: true,
            notes: false,
            annotations: 'none'
          },
          exportClass: 'evidence',
          outputPath: join(tempDir, 'never-written.zip'),
          captureIds: ['not-a-real-capture-id']
        },
        captureLifecycle
      )
    ).rejects.toThrow(/not-a-real-capture-id/)
    expect(existsSync(join(tempDir, 'never-written.zip'))).toBe(false)
  })

  it('rejects an empty selection', async () => {
    await ingest(caseId, '<html><body>Only capture</body></html>', 'https://example.com', 'Only')

    await expect(
      generateReport(
        caseId,
        {
          format: 'zip',
          include: {
            captures: true,
            screenshots: false,
            auditTrail: true,
            notes: false,
            annotations: 'none'
          },
          exportClass: 'evidence',
          outputPath: join(tempDir, 'never-written.zip'),
          captureIds: []
        },
        captureLifecycle
      )
    ).rejects.toThrow(/at least one exhibit/)
  })

  it('rolls the export entry back when the zip write fails', async () => {
    await ingest(caseId, '<html><body>Rollback check</body></html>', 'https://example.com', 'R')

    const caseDir = join(tempDir, 'captures', caseId)
    const headBefore = getManifestHead(caseDir)
    // A directory as outputPath makes writeFileSync throw AFTER the entry was
    // appended — the manifest must not keep recording an export that produced
    // no package.
    const dirAsOutput = join(tempDir, 'i-am-a-directory')
    mkdirSync(dirAsOutput)

    await expect(
      generateReport(
        caseId,
        {
          format: 'zip',
          include: {
            captures: true,
            screenshots: false,
            auditTrail: true,
            notes: false,
            annotations: 'none'
          },
          exportClass: 'evidence',
          outputPath: dirAsOutput
        },
        captureLifecycle
      )
    ).rejects.toThrow()

    expect(getManifestHead(caseDir)).toEqual(headBefore)
  })

  it('content-addresses screenshots into screenshots/<sha256>.png and records them in artifacts[] (#118)', async () => {
    const screenshot = Buffer.from('screenshot-png-bytes-for-export')
    const { capture } = await ingestMhtmlCapture({
      caseId,
      url: 'https://example.com/shot',
      title: 'Shot',
      timestamp: '2026-04-05T12:00:00.000Z',
      stream: Readable.from([Buffer.from('mhtml')]) as unknown as ReadableStream<Uint8Array>,
      textContent: 'extracted text for export',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0',
      screenshot
    })

    const outputPath = join(tempDir, 'shot-evidence.zip')
    await generateReport(
      caseId,
      {
        format: 'zip',
        include: {
          captures: true,
          screenshots: true,
          auditTrail: true,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    const expectedDigest = createHash('sha256').update(screenshot).digest('hex')
    const expectedPath = `screenshots/${expectedDigest}.png`

    // Content-addressed: the file exists, its name equals its digest, bytes match.
    expect(entries.has(expectedPath)).toBe(true)
    expect(entries.get(expectedPath)).toEqual(screenshot)

    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      captures: Array<{
        id: string
        screenshotPath: string | null
        screenshotSha256: string | null
        textSha256: string | null
      }>
      artifacts: Array<{ path: string; sha256: string; sizeBytes: number }>
    }

    // Per-capture record is self-describing.
    const rec = evidence.captures.find((c) => c.id === capture.id)!
    expect(rec.screenshotPath).toBe(expectedPath)
    expect(rec.screenshotSha256).toBe(expectedDigest)
    expect(rec.textSha256).toBe(capture.textHash)

    // The artifact is registered with a matching sha256.
    const artifact = evidence.artifacts.find((a) => a.path === expectedPath)!
    expect(artifact.sha256).toBe(expectedDigest)
    expect(artifact.sizeBytes).toBe(screenshot.length)
  })

  it('emits one content-addressed screenshot entry when two captures share bytes (#152)', async () => {
    const screenshot = Buffer.from('identical-screenshot-bytes-across-captures')
    const base = {
      caseId,
      timestamp: '2026-04-05T12:00:00.000Z',
      stream: Readable.from([Buffer.from('mhtml')]) as unknown as ReadableStream<Uint8Array>,
      textContent: 'extracted text for export',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0',
      screenshot
    }
    const { capture: captureA } = await ingestMhtmlCapture({
      ...base,
      url: 'https://example.com/a',
      title: 'A',
      stream: Readable.from([Buffer.from('mhtml')]) as unknown as ReadableStream<Uint8Array>
    })
    const { capture: captureB } = await ingestMhtmlCapture({
      ...base,
      url: 'https://example.com/b',
      title: 'B',
      stream: Readable.from([Buffer.from('mhtml')]) as unknown as ReadableStream<Uint8Array>
    })

    const outputPath = join(tempDir, 'shot-dedupe.zip')
    await generateReport(
      caseId,
      {
        format: 'zip',
        include: {
          captures: true,
          screenshots: true,
          auditTrail: true,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    const expectedDigest = createHash('sha256').update(screenshot).digest('hex')
    const expectedPath = `screenshots/${expectedDigest}.png`

    // Exactly one content-addressed screenshot entry, no duplicate.
    const screenshotKeys = [...entries.keys()].filter((k) => k.startsWith('screenshots/'))
    expect(screenshotKeys).toEqual([expectedPath])
    expect(entries.get(expectedPath)).toEqual(screenshot)

    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      captures: Array<{
        id: string
        screenshotPath: string | null
        screenshotSha256: string | null
      }>
      artifacts: Array<{ path: string }>
    }

    // Both capture records reference the shared content-addressed path.
    const recA = evidence.captures.find((c) => c.id === captureA.id)!
    const recB = evidence.captures.find((c) => c.id === captureB.id)!
    expect(recA.screenshotPath).toBe(expectedPath)
    expect(recA.screenshotSha256).toBe(expectedDigest)
    expect(recB.screenshotPath).toBe(expectedPath)
    expect(recB.screenshotSha256).toBe(expectedDigest)

    // The artifact is registered exactly once.
    expect(evidence.artifacts.filter((a) => a.path === expectedPath)).toHaveLength(1)
  })

  it('omits screenshots from the package when include.screenshots is false (#152)', async () => {
    const screenshot = Buffer.from('screenshot-bytes-should-not-leak')
    const { capture } = await ingestMhtmlCapture({
      caseId,
      url: 'https://example.com/shot',
      title: 'Shot',
      timestamp: '2026-04-05T12:00:00.000Z',
      stream: Readable.from([Buffer.from('mhtml')]) as unknown as ReadableStream<Uint8Array>,
      textContent: 'extracted text for export',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0',
      screenshot
    })

    const outputPath = join(tempDir, 'shot-no-screenshots.zip')
    await generateReport(
      caseId,
      {
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
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    // No content-addressed screenshot file is bundled.
    expect([...entries.keys()].some((k) => k.startsWith('screenshots/'))).toBe(false)

    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      captures: Array<{
        id: string
        screenshotPath: string | null
        screenshotSha256: string | null
      }>
      artifacts: Array<{ path: string }>
    }
    const rec = evidence.captures.find((c) => c.id === capture.id)!
    expect(rec.screenshotPath).toBeNull()
    expect(rec.screenshotSha256).toBeNull()
    expect(evidence.artifacts.some((a) => a.path.startsWith('screenshots/'))).toBe(false)
  })

  it('renders Trusted Time as a column orthogonal to integrity status', async () => {
    await ingest(caseId, '<html><body>Two axes</body></html>', 'https://example.com', 'Axes')

    const outputPath = join(tempDir, 'axes.html')
    const options: ExportOptions = {
      format: 'html',
      include: {
        captures: true,
        screenshots: false,
        auditTrail: true,
        notes: false,
        annotations: 'none'
      },
      exportClass: 'evidence',
      outputPath
    }

    await generateReport(caseId, options, captureLifecycle)
    const content = readFileSync(outputPath, 'utf-8')

    // Integrity and trusted time are orthogonal: a freshly-captured (un-stamped)
    // capture is integrity-Verified AND on a local clock carrying no token.
    expect(content).toContain('Trusted time')
    expect(content).toContain('Verified')
    expect(content).toContain('Local clock — no RFC 3161 token')
  })

  it('counts only the selection when preflight is scoped to selected captures', async () => {
    // The dialog opened from the selection toolbar must not warn about
    // unstamped captures the operator did not select: they are not going to
    // export (PR #842 review).
    const { capture: selected } = await ingest(
      caseId,
      '<html><body>Selected</body></html>',
      'https://example.com/selected',
      'S'
    )
    await ingest(
      caseId,
      '<html><body>Unselected</body></html>',
      'https://example.com/unselected',
      'U'
    )

    expect(getExportPreflight(caseId)).toMatchObject({
      captureCount: 2,
      unstampedCaptureCount: 2
    })
    expect(getExportPreflight(caseId, [selected.id])).toMatchObject({
      captureCount: 1,
      unstampedCaptureCount: 1
    })
    // An empty selection is still a selection: it counts nothing, rather than
    // falling back to the whole case.
    expect(getExportPreflight(caseId, [])).toMatchObject({
      captureCount: 0,
      unstampedCaptureCount: 0
    })
  })

  it('reports un-stamped captures in preflight and the HTML summary without blocking export', async () => {
    await ingest(caseId, '<html><body>Needs trusted time</body></html>', 'https://example.com', 'T')

    const preflight = getExportPreflight(caseId)
    expect(preflight).toMatchObject({
      captureCount: 1,
      stampedCaptureCount: 0,
      unstampedCaptureCount: 1,
      pendingCaptureCount: 1,
      noneCaptureCount: 0
    })

    const outputPath = join(tempDir, 'warning.html')
    await generateReport(
      caseId,
      {
        format: 'html',
        include: {
          captures: true,
          screenshots: false,
          auditTrail: true,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle
    )

    const content = readFileSync(outputPath, 'utf-8')
    expect(content).toMatch(/\d+ exhibits? without trusted time/)
    // Whitespace-tolerant: the sentence wraps across source lines in the
    // template literal, so the emitted HTML carries a newline mid-phrase.
    expect(content).toMatch(/export\s+was\s+not\s+blocked/i)
  })

  // #492: the preflight counts are printed in certification.html beside per-capture
  // rows resolved from the manifest alone. A capture with no manifest entry whose
  // mirror claims rfc3161 used to be counted as stamped, so the document could claim
  // trusted time above a row rendering the same capture as "Local clock only".
  it('counts trusted time from the manifest when the mirror overclaims', () => {
    const capture = insertCapture({
      caseId,
      url: 'https://legacy.example',
      title: 'Legacy',
      hash: 'y'.repeat(64),
      timestamp: '2024-01-01T00:00:00Z'
    })
    setCaptureTrustedTime(capture.id, 'rfc3161')

    expect(getExportPreflight(caseId)).toMatchObject({
      captureCount: 1,
      stampedCaptureCount: 0,
      unstampedCaptureCount: 1,
      pendingCaptureCount: 0,
      noneCaptureCount: 1
    })
  })

  // #581. A case older than per-entry signing carries both kinds of entry. The
  // report used to render every integrity-verified exhibit as plain "Verified",
  // so a reader could not tell which exhibits an RSA signature actually covered
  // without opening manifest.jsonl. Order matters: the chain may go v1 -> v2 as
  // the tool was upgraded, never back, so the legacy entry has to be written
  // first — a v1 entry after a signed one is tampering and verifyManifestChain
  // rejects it as a schema downgrade.
  it('names per-exhibit signature status when the chain mixes signed and legacy entries', async () => {
    const caseDir = join(tempDir, 'captures', caseId)
    await seedLegacyGenesisCapture(caseId, caseDir)

    await ingest(caseId, '<html><body>Signed</body></html>', 'https://example.com/signed', 'Signed')

    expect(verifyManifestChain(caseDir).valid).toBe(true)

    const outputPath = join(tempDir, 'mixed-evidence.zip')
    await generateReport(
      caseId,
      {
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
      },
      captureLifecycle
    )

    const report = readStoredZipEntries(outputPath).get('report.html')!.toString('utf-8')
    expect(report).toContain('Entry signature')
    expect(report).toContain('Absent (pre-signing tool version)')
    // Both states in one document: the disclosure is worthless if the unsigned
    // row reads the same as the signed one.
    expect(report).toContain('carries an RSA signature over its entry')
  })

  // The runbook is the by-hand proof, so asserting its prose is not enough: run
  // the identification command it now gives against a real mixed chain and check
  // it names the unsigned entry and only that one. If the command drifts from
  // what jq accepts, or from the shape the export actually writes, this fails.
  it.skipIf(!HAS_JQ)(
    'ships a VERIFY.md whose unsigned-entry command finds the legacy entry',
    async () => {
      const caseDir = join(tempDir, 'captures', caseId)
      await seedLegacyGenesisCapture(caseId, caseDir)
      await ingest(
        caseId,
        '<html><body>Signed</body></html>',
        'https://example.com/signed',
        'Signed'
      )

      const outputPath = join(tempDir, 'runbook-evidence.zip')
      await generateReport(
        caseId,
        {
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
        },
        captureLifecycle
      )

      const entries = readStoredZipEntries(outputPath)
      const runbook = entries.get('VERIFY.md')!.toString('utf-8')
      expect(runbook).toContain('Not every entry is signed')

      // Lift the jq filter out of the shipped document rather than restating it,
      // so the command under test is the one a reader is actually given.
      const filter = runbook.match(/jq -r '([^']+)' manifest\.jsonl/)?.[1]
      expect(filter).toBeDefined()

      const manifestPath = join(tempDir, 'runbook-manifest.jsonl')
      writeFileSync(manifestPath, entries.get('manifest.jsonl')!)
      const found = execFileSync('jq', ['-r', filter!, manifestPath], { encoding: 'utf-8' })
        .trim()
        .split('\n')
        .filter(Boolean)

      // Exactly one line. A filter that over-matched — listing the signed entry
      // too — would send a reader chasing a signature that is legitimately there.
      expect(found).toHaveLength(1)
      expect(found[0]).toBe('index 0 capture — unsigned')
    }
  )

  // A capture the chain never recorded has no signature to report and must not
  // borrow the signed wording by defaulting.
  it('reports no manifest entry rather than a signature status for an unchained capture', async () => {
    const orphan = insertCapture({
      caseId,
      url: 'https://unchained.example',
      title: 'Unchained',
      hash: createHash('sha256').update('unchained').digest('hex'),
      timestamp: '2026-04-05T10:00:00.000Z'
    })
    await defaultCaptureStore.writeMhtmlStream(
      caseId,
      orphan.id,
      Readable.from([Buffer.from('unchained')]) as unknown as ReadableStream<Uint8Array>
    )

    const outputPath = join(tempDir, 'unchained-evidence.zip')
    await generateReport(
      caseId,
      {
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
      },
      captureLifecycle
    )

    const report = readStoredZipEntries(outputPath).get('report.html')!.toString('utf-8')
    expect(report).toContain('No manifest entry')
  })

  it('does not record overallValid:true when auditTrail is excluded (no verifications)', async () => {
    await ingest(caseId, '<html><body>Unverified export</body></html>', 'https://example.com', 'U')

    const caseDir = join(tempDir, 'captures', caseId)
    const outputPath = join(tempDir, 'unverified-evidence.zip')
    const options: ExportOptions = {
      format: 'zip',
      include: {
        captures: true,
        screenshots: false,
        auditTrail: false,
        notes: false,
        annotations: 'none'
      },
      exportClass: 'evidence',
      outputPath
    }
    await generateReport(caseId, options, captureLifecycle)

    const manifest = readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>)

    const exportEntry = manifest.find((e) => e.type === 'export')!
    expect(exportEntry.verificationResult).toMatchObject({
      overallValid: false,
      captureCount: 1,
      verifiedCount: 0,
      tamperedCount: 0,
      missingCount: 0
    })
  })

  // X25: a capture this build is too old to verify is neither verified,
  // tampered nor missing, and the report names it rather than a broken chain.
  it('counts a verifier-too-old capture in no bucket and labels it by name', async () => {
    await ingest(caseId, '<html><body>Newer chain</body></html>', 'https://example.com', 'N')
    const caseDir = join(tempDir, 'captures', caseId)
    const manifestPath = join(caseDir, 'manifest.jsonl')
    writeFileSync(manifestPath, appendFutureEntry(readFileSync(manifestPath, 'utf-8'), caseId))

    const outputPath = join(tempDir, 'too-old-evidence.zip')
    const options: ExportOptions = {
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
    }
    await generateReport(caseId, options, captureLifecycle)

    const exportEntry = readFileSync(manifestPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((e) => e.type === 'export')!
    expect(exportEntry.verificationResult).toEqual({
      overallValid: false,
      captureCount: 1,
      verifiedCount: 0,
      tamperedCount: 0,
      missingCount: 0
    })
    const report = readStoredZipEntries(outputPath).get('report.html')!.toString('utf-8')
    expect(report).toContain('Not readable by this build')
    expect(report).toContain('not a finding of alteration')
    // The legend always lists 'Chain broken'; this is the capture's own detail.
    expect(report).not.toContain('Sequence and custody cannot be demonstrated for this entry')
  })

  // #1662: the report names the state "Changed since capture", while every
  // machine-read field in the package keeps the stored value `tampered` that
  // existing packages and older verifiers read.
  it('labels a changed capture by its display name and still ships the stored value tampered', async () => {
    const { capture } = await ingest(caseId, '<html><body>Changed</body></html>')
    writeFileSync(join(tempDir, 'captures', capture.mhtmlPath!), 'mutated bytes')
    const manifestPath = join(tempDir, 'captures', caseId, 'manifest.jsonl')

    const outputPath = join(tempDir, 'changed-evidence.zip')
    const options: ExportOptions = {
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
    }
    await generateReport(caseId, options, captureLifecycle)

    const entries = readStoredZipEntries(outputPath)
    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      captures: Array<{ id: string; integrityStatus?: string }>
    }
    expect(evidence.captures).toEqual([
      expect.objectContaining({ id: capture.id, integrityStatus: 'tampered' })
    ])
    const exportEntry = readFileSync(manifestPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((e) => e.type === 'export')!
    expect(exportEntry.verificationResult).toMatchObject({ verifiedCount: 0, tamperedCount: 1 })

    const report = entries.get('report.html')!.toString('utf-8')
    // The legend names the state once whatever the case holds; a second
    // occurrence is this capture's own state.
    expect(report.split('Changed since capture').length - 1).toBeGreaterThan(1)
    expect(report).toContain('The stored bytes no longer recompute to the recorded digest.')
    expect(report).toMatch(/capture recorded there as changed since capture,\s+chain-broken/)
    expect(report).not.toMatch(/\bAltered\b|\bTampered\b/)
  })

  it('writes no zip when the export audit append throws', async () => {
    await ingest(caseId, '<html><body>Orphan check</body></html>', 'https://example.com', 'O')

    // The entry is appended BEFORE the zip is written (#398, so its signed line
    // can be packaged as export-entry.json), so a signing failure leaves no
    // orphaned package behind — nothing has been written at all.
    const spy = vi.spyOn(manifest, 'appendManifestEntry').mockImplementation(() => {
      throw new Error('signing key failure')
    })

    const outputPath = join(tempDir, 'orphan-evidence.zip')
    const options: ExportOptions = {
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
    }

    try {
      await expect(generateReport(caseId, options, captureLifecycle)).rejects.toThrow(
        /signing key failure/
      )
      expect(existsSync(outputPath)).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  it('generates report without optional sections', async () => {
    await ingest(caseId, 'payload', 'https://example.com', 'Minimal')

    const outputPath = join(tempDir, 'minimal.html')
    const options: ExportOptions = {
      format: 'html',
      include: {
        captures: true,
        screenshots: false,
        auditTrail: false,
        notes: false,
        annotations: 'none'
      },
      exportClass: 'evidence',
      outputPath
    }

    await generateReport(caseId, options, captureLifecycle)
    const content = readFileSync(outputPath, 'utf-8')
    expect(content).toContain('Export Test Case')
    // With no verification run, the report must decline to make an integrity
    // finding rather than silently reproducing a stale one.
    expect(content).toContain('No verification was run for this export.')
    expect(content).toContain('Not verified in this export')
  })

  it('escapes HTML in report output', async () => {
    await ingest(caseId, 'payload', 'https://example.com', '<script>alert("xss")</script>')

    const outputPath = join(tempDir, 'escaped.html')
    await generateReport(
      caseId,
      {
        format: 'html',
        include: {
          captures: true,
          screenshots: false,
          auditTrail: false,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle
    )

    const content = readFileSync(outputPath, 'utf-8')
    expect(content).not.toContain('<script>alert')
    expect(content).toContain('&lt;script&gt;')
  })

  it('burns annotations into the embedded screenshot when include.annotations is burned', async () => {
    const c = createCase({ name: 'Burn' })
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://example.com',
      title: 'X',
      hash: 'h',
      timestamp: new Date().toISOString()
    })
    ensureCaseDir(c.id)
    const pngPath = defaultCaptureStore.artifactPaths(c.id, cap.id, 'png').abs
    const white = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    })
      .png()
      .toBuffer()
    writeFileSync(pngPath, white)

    saveAnnotations({
      captureId: cap.id,
      shapes: [{ kind: 'redact', id: 'r', x: 20, y: 20, w: 40, h: 40, mode: 'solid' }],
      imageWidth: 100,
      imageHeight: 100
    })

    const outPath = join(tempDir, 'report.html')
    const options: ExportOptions = {
      format: 'html',
      include: {
        captures: true,
        screenshots: true,
        auditTrail: false,
        notes: false,
        annotations: 'burned'
      },
      exportClass: 'evidence',
      outputPath: outPath
    }
    await generateReport(c.id, options, captureLifecycle)

    const html = readFileSync(outPath, 'utf-8')
    const match = html.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)
    if (!match) throw new Error('No base64 image found in exported HTML')
    const buf = Buffer.from(match[1], 'base64')
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
    const pixelAt = (x: number, y: number): [number, number, number] => {
      const idx = (y * info.width + x) * info.channels
      return [data[idx], data[idx + 1], data[idx + 2]]
    }
    expect(pixelAt(40, 40)).toEqual([0, 0, 0])
    expect(pixelAt(80, 80)).toEqual([255, 255, 255])
  })

  // --- report.html must never cite a file the package does not contain ---

  it('reports a missing page archive as absent even when no verification runs', async () => {
    const { capture } = await ingest(caseId, '<html>gone</html>', 'https://example.com/gone', 'G')
    // Delete the stored archive after ingest, then export without an audit trail
    // so no verification result exists to infer absence from.
    rmSync(defaultCaptureStore.artifactPaths(caseId, capture.id, 'mhtml').abs)

    const outputPath = join(tempDir, 'missing-archive.zip')
    await generateReport(
      caseId,
      {
        format: 'zip',
        include: {
          captures: true,
          screenshots: false,
          auditTrail: false,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    const html = entries.get('report.html')!.toString('utf-8')

    expect(entries.has(`pages/${capture.id}.mhtml`)).toBe(false)
    expect(html).not.toContain(`pages/${capture.id}.mhtml`)
    expect(html).toContain('Stored page archive not available')
  })

  it('cites no screenshot path when screenshots are excluded from the package', async () => {
    const { capture } = await ingest(caseId, '<html>s</html>', 'https://example.com/s', 'S')
    ensureCaseDir(caseId)
    const png = await sharp({
      create: { width: 10, height: 10, channels: 4, background: { r: 1, g: 1, b: 1, alpha: 1 } }
    })
      .png()
      .toBuffer()
    writeFileSync(defaultCaptureStore.artifactPaths(caseId, capture.id, 'png').abs, png)

    const outputPath = join(tempDir, 'no-screenshots.zip')
    await generateReport(
      caseId,
      {
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
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    const html = entries.get('report.html')!.toString('utf-8')

    expect([...entries.keys()].some((k) => k.startsWith('screenshots/'))).toBe(false)
    // The methodology section still explains content-addressing in prose; what
    // must not appear is a citation of a specific screenshot file.
    expect(html).not.toMatch(/screenshots\/[0-9a-f]{64}\.png/)
  })

  it('names the shared timestamp token path for captures with a duplicate content hash', async () => {
    const payload = '<html>dupe</html>'
    const a = await ingest(caseId, payload, 'https://example.com/a', 'A')
    const b = await ingest(caseId, payload, 'https://example.com/b', 'B')
    expect(a.capture.hash).toBe(b.capture.hash)

    // A token that actually stamps the shared digest: only an admitted token is
    // packaged now, so the dedup rule can only be shown with one (#1108).
    const token = buildSyntheticToken({
      contentHash: a.capture.hash,
      genTime: new Date('2026-04-05T12:01:00.000Z'),
      tsaDnsName: 'tsa.example.com'
    })
    appendManifestEntry(join(tempDir, 'captures', caseId), {
      type: 'timestamp',
      caseId,
      captureContentHash: a.capture.hash,
      timestamp: '2026-04-05T12:01:00.000Z',
      tsaToken: token.toString('base64'),
      operatorId: 'op',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })

    const outputPath = join(tempDir, 'dupe-token.zip')
    await generateReport(
      caseId,
      {
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
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    const html = entries.get('report.html')!.toString('utf-8')
    const tokenPaths = [...entries.keys()].filter((k) => k.startsWith('timestamps/'))

    // One token file is packaged for the shared hash; both exhibits must cite it
    // rather than each naming a file after its own capture id.
    expect(tokenPaths).toHaveLength(1)
    for (const cited of html.match(/timestamps\/[\w-]+\.tst/g) ?? []) {
      expect(tokenPaths).toContain(cited)
    }
  })

  it('does not describe companion files for a standalone HTML export', async () => {
    await ingest(caseId, '<html>standalone</html>')
    const outputPath = join(tempDir, 'standalone.html')
    await generateReport(
      caseId,
      {
        format: 'html',
        include: {
          captures: true,
          screenshots: false,
          auditTrail: true,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    expect(html).toContain('This is a standalone report, not an evidence package')
    expect(html).toContain('These steps require the evidence package')
    expect(html).not.toContain('Companion files in this evidence package')
    // The verification steps still name pages/ generically — deliberately, so a
    // reader knows what to request. What must not appear is a per-exhibit
    // citation of a file this export did not write.
    expect(html).not.toMatch(/pages\/[0-9a-f-]{36}\.mhtml/)
    expect(html).not.toMatch(/timestamps\/[0-9a-f-]{36}\.tst/)
  })

  it('discloses burned annotations when shapes exist but no pins do', async () => {
    const c = createCase({ name: 'Shapes only' })
    ensureCaseDir(c.id)
    const white = await sharp({
      create: {
        width: 50,
        height: 50,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    })
      .png()
      .toBuffer()
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://example.com',
      title: 'X',
      hash: 'h',
      screenshotHash: createHash('sha256').update(white).digest('hex'),
      timestamp: new Date().toISOString()
    })
    writeFileSync(defaultCaptureStore.artifactPaths(c.id, cap.id, 'png').abs, white)

    // A redaction burns pixels without producing any pin — the case where
    // inferring "annotated" from pins.length silently omits the disclosure.
    saveAnnotations({
      captureId: cap.id,
      shapes: [{ kind: 'redact', id: 'r', x: 10, y: 10, w: 20, h: 20, mode: 'solid' }],
      imageWidth: 50,
      imageHeight: 50
    })

    const outputPath = join(tempDir, 'shapes-only.html')
    await generateReport(
      c.id,
      {
        format: 'html',
        include: {
          captures: true,
          screenshots: true,
          auditTrail: false,
          notes: false,
          annotations: 'burned'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    expect(html).toContain('annotations burned in for legibility')
    // The digest belongs to the unannotated original, not to the pixels shown,
    // and the caption must say so rather than inviting a false mismatch.
    expect(html).toContain('unannotated original SHA-256')
    expect(html).toContain('that mismatch is expected rather than evidence of alteration')
  })

  it('escapes an unparseable capture timestamp instead of emitting it as markup', async () => {
    const c = createCase({ name: 'Bad clock' })
    insertCapture({
      caseId: c.id,
      url: 'https://example.com',
      title: 'X',
      hash: 'h',
      timestamp: '<img src=x onerror=alert(1)>'
    })

    const outputPath = join(tempDir, 'bad-timestamp.html')
    await generateReport(
      c.id,
      {
        format: 'html',
        include: {
          captures: true,
          screenshots: false,
          auditTrail: false,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  // --- the report must not assert more than the export established ---

  it('does not have the operator attest to a verification run that did not happen', async () => {
    await ingest(caseId, '<html>unverified</html>')
    const outputPath = join(tempDir, 'no-verify.html')
    await generateReport(
      caseId,
      {
        format: 'html',
        include: {
          captures: true,
          screenshots: false,
          auditTrail: false,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    // The signature block is the statement an operator signs; it must not claim
    // digests were recomputed when nothing recomputed them.
    expect(html).not.toMatch(/those produced by the tool at the verification run/)
    expect(html).toMatch(/No verification was run for this\s+export/)
    expect(html).toContain('I make no statement about')
  })

  it('qualifies the attestation statement rather than claiming it for every capture', async () => {
    await ingest(caseId, '<html>scope</html>')
    const outputPath = join(tempDir, 'scope.html')
    await generateReport(
      caseId,
      {
        format: 'html',
        include: {
          captures: true,
          screenshots: false,
          auditTrail: true,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    expect(html).toContain('whose exhibit records a verified result')
    expect(html).toMatch(/never for the package as a whole/)
    // The unconditional form claimed every capture rehashed, contradicting any
    // exhibit recorded as altered, absent or unverified.
    expect(html).not.toMatch(/That the stored bytes of each capture recompute/)
  })

  it('takes trusted time from the manifest, not the capture row mirror', async () => {
    const { capture } = await ingest(caseId, '<html>mirror</html>')
    // Corrupt the rebuildable mirror so it claims trusted time the manifest
    // cannot support. The exhibit must follow the manifest.
    setCaptureTrustedTime(capture.id, 'rfc3161')

    const outputPath = join(tempDir, 'stale-mirror.html')
    await generateReport(
      caseId,
      {
        format: 'html',
        include: {
          captures: true,
          screenshots: false,
          auditTrail: false,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    // A v2+ capture with no timestamp entry is 'pending' by the manifest, so
    // that is what the exhibit must state — not the mirror's 'rfc3161'.
    expect(html).toContain('Local clock — no RFC 3161 token')
    expect(html).toContain(TRUSTED_TIME_LABELS.pending)
    expect(html).not.toContain('RFC 3161 token retained')
  })

  it('labels an exhibit image with the digest of the bytes it reproduces', async () => {
    const c = createCase({ name: 'Sidecar drift' })
    ensureCaseDir(c.id)
    const png = await sharp({
      create: { width: 20, height: 20, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } }
    })
      .png()
      .toBuffer()
    // Record a digest that does not match the bytes on disk, as happens when the
    // sidecar changes after ingest.
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://example.com',
      title: 'X',
      hash: 'h',
      screenshotHash: 'f'.repeat(64),
      timestamp: new Date().toISOString()
    })
    writeFileSync(defaultCaptureStore.artifactPaths(c.id, cap.id, 'png').abs, png)

    const outputPath = join(tempDir, 'sidecar-drift.html')
    await generateReport(
      c.id,
      {
        format: 'html',
        include: {
          captures: true,
          screenshots: true,
          auditTrail: false,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    const actual = createHash('sha256').update(png).digest('hex')
    expect(html).toContain(`image SHA-256 ${actual}`)
    expect(html).toContain('no longer matches the digest recorded for it')
    expect(html).toContain('f'.repeat(64))
  })

  it('claims RFC 3161 trusted time only when the token is in the package', async () => {
    const { capture } = await ingest(caseId, '<html>tt</html>')
    // A synthetic token whose messageImprint matches the capture hash, so
    // trusted-time resolution actually yields rfc3161 rather than pending.
    const token = buildSyntheticToken({
      contentHash: capture.hash,
      genTime: new Date('2026-04-05T12:01:00.000Z'),
      tsaDnsName: 'tsa.example.com'
    })
    appendManifestEntry(join(tempDir, 'captures', caseId), {
      type: 'timestamp',
      caseId,
      captureContentHash: capture.hash,
      timestamp: '2026-04-05T12:01:00.000Z',
      tsaToken: token.toString('base64'),
      operatorId: 'op',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })

    const outputPath = join(tempDir, 'tt-consistency.zip')
    await generateReport(
      caseId,
      {
        format: 'zip',
        // auditTrail off, so the claim comes from the manifest fallback rather
        // than from a verification result — the path that read a stale mirror.
        include: {
          captures: true,
          screenshots: false,
          auditTrail: false,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    const html = entries.get('report.html')!.toString('utf-8')
    const packagedTokens = [...entries.keys()].filter((k) => k.startsWith('timestamps/'))

    // The trusted-time index and the token paths come from one manifest
    // snapshot, so a claimed token is always a packaged token.
    expect(packagedTokens).toHaveLength(1)
    expect(html).toContain('RFC 3161 token retained')
    expect(html).toContain(TRUSTED_TIME_LABELS.rfc3161)
    expect(html).toContain(packagedTokens[0])
  })

  it('encloses no token for a capture whose token attests other content (#1108)', async () => {
    const { capture } = await ingest(caseId, '<html>wrong imprint</html>')
    // Known answer: the DigiCert fixture stamps the digest recorded beside it
    // in content-hash.txt, and that digest is not this capture's. The packager
    // has to read the token the way the resolver does — as no stamp for this
    // exhibit — or the package encloses a token for a capture its own documents
    // call unstamped.
    const token = readFileSync(join(process.cwd(), 'tests/fixtures/timestamp/digicert-token.der'))
    const stampedDigest = readFileSync(
      join(process.cwd(), 'tests/fixtures/timestamp/content-hash.txt'),
      'utf-8'
    ).trim()
    expect(parseTimestampToken(token).messageImprintHex).toBe(stampedDigest)
    expect(stampedDigest).not.toBe(capture.hash)
    appendManifestEntry(join(tempDir, 'captures', caseId), {
      type: 'timestamp',
      caseId,
      captureContentHash: capture.hash,
      timestamp: '2026-04-05T12:01:00.000Z',
      tsaToken: token.toString('base64'),
      operatorId: 'op',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })

    const outputPath = join(tempDir, 'wrong-imprint.zip')
    await generateReport(
      caseId,
      {
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
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      captures: Array<{ id: string; trustedTime: string; timestampTokenPaths: string[] }>
      warnings: { unstampedCaptureCount: number }
    }
    const html = entries.get('report.html')!.toString('utf-8')

    expect([...entries.keys()].filter((k) => k.startsWith('timestamps/'))).toEqual([])
    expect(evidence.captures[0]).toMatchObject({
      id: capture.id,
      trustedTime: 'pending',
      timestampTokenPaths: []
    })
    expect(evidence.warnings.unstampedCaptureCount).toBe(1)
    expect(html).not.toMatch(/timestamps\/[\w-]+\.tst/)
  })

  it('encloses no token for a capture whose token does not parse (#1108)', async () => {
    const { capture } = await ingest(caseId, '<html>unparseable</html>')
    // The resolver's other ground for refusing a token: it never parses, so
    // there is no imprint to compare and the capture stays pending.
    const token = Buffer.from('this is not a DER timestamp token', 'utf-8')
    appendManifestEntry(join(tempDir, 'captures', caseId), {
      type: 'timestamp',
      caseId,
      captureContentHash: capture.hash,
      timestamp: '2026-04-05T12:01:00.000Z',
      tsaToken: token.toString('base64'),
      operatorId: 'op',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })

    const outputPath = join(tempDir, 'unparseable-token.zip')
    await generateReport(
      caseId,
      {
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
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      captures: Array<{ id: string; trustedTime: string; timestampTokenPaths: string[] }>
    }

    expect([...entries.keys()].filter((k) => k.startsWith('timestamps/'))).toEqual([])
    expect(evidence.captures[0]).toMatchObject({
      id: capture.id,
      trustedTime: 'pending',
      timestampTokenPaths: []
    })
  })

  it('encloses the binding token when the manifest also carries one that does not (#1108)', async () => {
    const { capture } = await ingest(caseId, '<html>two tokens</html>')
    // The refused token is appended FIRST, so packaging the first entry naming
    // this digest would enclose bytes that attest something else under a path
    // the documents cite as this capture's stamp.
    const refused = readFileSync(join(process.cwd(), 'tests/fixtures/timestamp/digicert-token.der'))
    const binding = buildSyntheticToken({
      contentHash: capture.hash,
      genTime: new Date('2026-04-05T12:01:00.000Z'),
      tsaDnsName: 'tsa.example.com'
    })
    for (const tsaToken of [refused, binding]) {
      appendManifestEntry(join(tempDir, 'captures', caseId), {
        type: 'timestamp',
        caseId,
        captureContentHash: capture.hash,
        timestamp: '2026-04-05T12:01:00.000Z',
        tsaToken: tsaToken.toString('base64'),
        operatorId: 'op',
        operatorName: 'Test Operator',
        toolVersion: '0.1.0'
      })
    }

    const outputPath = join(tempDir, 'binding-token.zip')
    await generateReport(
      caseId,
      {
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
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      captures: Array<{ id: string; trustedTime: string; timestampTokenPaths: string[] }>
    }

    const tokenPath = `timestamps/${capture.id}.tst`
    expect([...entries.keys()].filter((k) => k.startsWith('timestamps/'))).toEqual([tokenPath])
    expect(entries.get(tokenPath)).toEqual(binding)
    expect(evidence.captures[0]).toMatchObject({
      id: capture.id,
      trustedTime: 'rfc3161',
      timestampTokenPaths: [tokenPath]
    })
  })

  it('does not name the configured TSA for a token that carries no authority (#519)', async () => {
    const { capture } = await ingest(caseId, '<html>unnamed</html>')
    // A valid token whose TSTInfo omits the tsa GeneralName — the identity of
    // the issuer is not recoverable from the token, so the report must not fill
    // it in from this install's settings.
    const token = buildSyntheticToken({
      contentHash: capture.hash,
      genTime: new Date('2026-04-05T12:01:00.000Z')
    })
    appendManifestEntry(join(tempDir, 'captures', caseId), {
      type: 'timestamp',
      caseId,
      captureContentHash: capture.hash,
      timestamp: '2026-04-05T12:01:00.000Z',
      tsaToken: token.toString('base64'),
      operatorId: 'op',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })

    const outputPath = join(tempDir, 'unnamed-tsa.html')
    await generateReport(
      caseId,
      {
        format: 'html',
        include: {
          captures: true,
          screenshots: false,
          auditTrail: false,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    expect(html).toContain(TRUSTED_TIME_LABELS.rfc3161)
    expect(html).toContain(
      `${TRUSTED_TIME_UNNAMED_TSA} asserts that the capture content digest existed no later ` +
        'than 2026-04-05T12:01:00Z'
    )
    expect(html).not.toContain('the configured RFC 3161 authority')
  })

  it('numbers legend entries with the pin numbers burned into the image', async () => {
    const c = createCase({ name: 'Pins' })
    ensureCaseDir(c.id)
    const white = await sharp({
      create: {
        width: 60,
        height: 60,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    })
      .png()
      .toBuffer()
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://example.com',
      title: 'X',
      hash: 'h',
      timestamp: new Date().toISOString()
    })
    writeFileSync(defaultCaptureStore.artifactPaths(c.id, cap.id, 'png').abs, white)
    saveAnnotations({
      captureId: cap.id,
      shapes: [{ kind: 'redact', id: 'r', x: 5, y: 5, w: 10, h: 10, mode: 'solid' }],
      imageWidth: 60,
      imageHeight: 60
    })
    // Pins are numbered MAX(number)+1 and deletion does not renumber, so after
    // removing the first two the survivors are 3 and 4. A legend that lets the
    // browser count from 1 would then disagree with the burned image.
    const p1 = upsertPin({ captureId: cap.id, body: 'One' })
    const p2 = upsertPin({ captureId: cap.id, body: 'Two' })
    upsertPin({ captureId: cap.id, body: 'Third pin, first surviving entry.' })
    upsertPin({ captureId: cap.id, body: 'Fourth pin.' })
    deletePin(p1.id)
    deletePin(p2.id)

    const outputPath = join(tempDir, 'pins.html')
    await generateReport(
      c.id,
      {
        format: 'html',
        include: {
          captures: true,
          screenshots: true,
          auditTrail: false,
          notes: false,
          annotations: 'burned'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    expect(html).toContain('<li value="3">')
    expect(html).toContain('<li value="4">')
  })

  it('does not make package claims on the cover of a standalone export', async () => {
    await ingest(caseId, '<html>cover</html>')
    const outputPath = join(tempDir, 'cover-standalone.html')
    await generateReport(
      caseId,
      {
        format: 'html',
        include: {
          captures: true,
          screenshots: false,
          auditTrail: true,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    expect(html).toContain('Captures described')
    expect(html).not.toContain('Captures in package')
    // No archive is emitted, so the cover must not tally archives as present.
    expect(html).not.toContain('Page archive present')
    expect(html).toContain('not enclosed with it')
  })

  it('does not attest cover tallies to a verification run that did not happen', async () => {
    await ingest(caseId, '<html>tally</html>')
    const outputPath = join(tempDir, 'cover-noverify.zip')
    await generateReport(
      caseId,
      {
        format: 'zip',
        include: {
          captures: true,
          screenshots: false,
          auditTrail: false,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle
    )

    const html = readStoredZipEntries(outputPath).get('report.html')!.toString('utf-8')
    expect(html).not.toContain('The integrity count is produced by the verification run')
    expect(html).toMatch(/No verification was run for this export/)
    expect(html).toContain('the figure is not a finding of failure')
  })

  it('requires an independently obtained trust anchor for a non-default TSA', async () => {
    updateSettings({ tsaUrl: 'https://tsa.example.org/timestamp' })
    await ingest(caseId, '<html>tsa</html>')
    const outputPath = join(tempDir, 'custom-tsa.zip')
    await generateReport(
      caseId,
      {
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
      },
      captureLifecycle
    )

    const html = readStoredZipEntries(outputPath).get('report.html')!.toString('utf-8')
    expect(html).toContain('No trust anchor is bundled for the configured authority')
    expect(html).toContain('trust anchor you obtain independently')
    // Must not tell a reviewer that chaining to the bundled file proves anything.
    expect(html).not.toContain('which carries the authority’s trust anchor')
  })

  // #1169 fix round. The cover's configured-authority field states what this
  // installation had set when the package was built. An operator who stamped
  // through a custom authority and later switched timestamping off exports a
  // package whose retained tokens still need that authority's root, so the cover
  // names the endpoint and marks it not contacted rather than denying one is
  // configured — the round-2 review found the denial contradicting the
  // verification section of the same document two pages later. The procedure still
  // cites the tokens' own issuer, because the cover states configuration and not
  // who signed a token retained from earlier.
  it('names the configured authority as not contacted and still derives the anchor from the tokens (declined, custom TSA)', async () => {
    updateSettings({ tsaUrl: 'https://tsa.example.org/timestamp' })
    await ingest(caseId, '<html>tsa</html>')
    updateSettings({ tsaEnabled: false })
    const outputPath = join(tempDir, 'declined-custom-tsa.zip')
    await generateReport(
      caseId,
      {
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
      },
      captureLifecycle
    )

    const html = readStoredZipEntries(outputPath).get('report.html')!.toString('utf-8')
    expect(html).toContain(
      'Not contacted — trusted timestamping is switched off for this installation'
    )
    expect(html).toContain('https://tsa.example.org/timestamp')
    // The document may not both deny and assert that an authority is configured.
    expect(html).not.toContain('None — trusted timestamping is switched off')
    expect(html).toContain('No trust anchor is bundled for the configured authority')
    // The cover states configuration, not who signed a retained token, so neither
    // the step nor the alert may take the issuer from it — and the issuer the
    // tokens name is a self-assertion until the independent anchor validates it.
    expect(html).not.toContain('from the authority named on the cover')
    expect(html).toContain('from the authority that issued the tokens')
    expect(html).toContain('a name the token asserts about itself')
  })

  // --- Operator identity gating and report rendering ---

  it('generateReport throws when operator name is blank', async () => {
    updateSettings({ operatorName: '' })
    await ingest(caseId, '<html>test</html>')
    const outputPath = join(tempDir, 'blocked.html')
    await expect(
      generateReport(
        caseId,
        {
          format: 'html',
          include: {
            captures: true,
            screenshots: false,
            auditTrail: false,
            notes: false,
            annotations: 'none'
          },
          exportClass: 'evidence',
          outputPath
        },
        captureLifecycle
      )
    ).rejects.toThrow(/operator name/i)
  })

  it('generateReport throws when operator name is whitespace-only', async () => {
    updateSettings({ operatorName: '   ' })
    await ingest(caseId, '<html>test</html>')
    const outputPath = join(tempDir, 'blocked-ws.html')
    await expect(
      generateReport(
        caseId,
        {
          format: 'html',
          include: {
            captures: true,
            screenshots: false,
            auditTrail: false,
            notes: false,
            annotations: 'none'
          },
          exportClass: 'evidence',
          outputPath
        },
        captureLifecycle
      )
    ).rejects.toThrow(/operator name/i)
  })

  it('generated report includes installationId and operator identity', async () => {
    updateSettings({
      operatorName: 'Alex Smith',
      operatorRole: 'Researcher',
      operatorOrganization: 'Independent Research Group'
    })
    await ingest(caseId, '<html>test</html>')
    const outputPath = join(tempDir, 'identity.html')
    await generateReport(
      caseId,
      {
        format: 'html',
        include: {
          captures: true,
          screenshots: false,
          auditTrail: false,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle
    )

    const content = readFileSync(outputPath, 'utf-8')
    expect(content).toContain('Alex Smith')
    expect(content).toContain('Researcher')
    expect(content).toContain('Independent Research Group')
    // installationId is a UUID — verify its label is present
    expect(content).toContain('Installation identifier')
  })

  it('reports granular per-item progress through the verify and screenshot stages', async () => {
    const screenshot = Buffer.from('progress-png-bytes')
    const base = {
      caseId,
      timestamp: '2026-04-05T12:00:00.000Z',
      textContent: 'text',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0',
      screenshot
    }
    await ingestMhtmlCapture({
      ...base,
      url: 'https://example.com/1',
      title: '1',
      stream: Readable.from([Buffer.from('mhtml-1')]) as unknown as ReadableStream<Uint8Array>
    })
    await ingestMhtmlCapture({
      ...base,
      url: 'https://example.com/2',
      title: '2',
      stream: Readable.from([Buffer.from('mhtml-2')]) as unknown as ReadableStream<Uint8Array>
    })

    const outputPath = join(tempDir, 'progress.zip')
    const steps: Array<{ step: string; percent: number }> = []
    await generateReport(
      caseId,
      {
        format: 'zip',
        include: {
          captures: true,
          screenshots: true,
          auditTrail: true,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      captureLifecycle,
      (step, percent) => steps.push({ step, percent })
    )

    const labels = steps.map((s) => s.step)
    expect(labels).toContain('Loading captures...')
    expect(labels).toContain('Verifying capture 1 of 2...')
    expect(labels).toContain('Verifying capture 2 of 2...')
    expect(labels).toContain('Loading screenshot 1 of 2...')
    expect(labels).toContain('Loading screenshot 2 of 2...')
    expect(steps.at(-1)).toEqual({ step: 'Complete', percent: 100 })

    // Percent is monotonic non-decreasing so the bar never jumps backwards.
    const percents = steps.map((s) => s.percent)
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1])
    }
  })

  describe('export classes and notes as package content (#399)', () => {
    const EVIDENCE_INCLUDE: ExportOptions['include'] = {
      captures: true,
      screenshots: false,
      auditTrail: true,
      notes: true,
      annotations: 'none'
    }

    function lastManifestEntry(): Record<string, unknown> {
      const jsonl = readFileSync(join(tempDir, 'captures', caseId, 'manifest.jsonl'), 'utf-8')
      const lines = jsonl.split('\n').filter((l) => l.trim().length > 0)
      return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>
    }

    it('ships notes.md in an Evidence Package, inside the artifact index', async () => {
      await ingest(caseId, '<html><body>Content</body></html>')
      createNote({ caseId, title: 'Finding one', body: 'The page linked to the paste site.' })

      const outputPath = join(tempDir, 'with-notes.zip')
      await generateReport(
        caseId,
        { format: 'zip', include: EVIDENCE_INCLUDE, exportClass: 'evidence', outputPath },
        captureLifecycle
      )

      const entries = readStoredZipEntries(outputPath)
      const notesMd = entries.get('notes.md')!.toString('utf-8')
      expect(notesMd).toContain('## Finding one')
      expect(notesMd).toContain('The page linked to the paste site.')
      expect(notesMd).toContain('Operator work product')

      // Inside the index and therefore inside packageHash: notes.md went
      // through add(), so its digest is pinned like every packaged document.
      const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
        artifacts: Array<{ path: string; sha256: string }>
      }
      const artifact = evidence.artifacts.find((a) => a.path === 'notes.md')
      expect(artifact?.sha256).toBe(
        createHash('sha256').update(entries.get('notes.md')!).digest('hex')
      )
    })

    // AC 5: the Court exhibit excludes Notes — proven at the byte level, as
    // the exact zip entry-list difference between the two evidence presets.
    it('Court exhibit differs from the Full bundle by exactly notes.md', async () => {
      await ingest(caseId, '<html><body>Content</body></html>')
      createNote({ caseId, title: 'Kept out of court exhibit', body: 'note body' })

      const fullPath = join(tempDir, 'full.zip')
      const courtPath = join(tempDir, 'court.zip')
      await generateReport(
        caseId,
        { format: 'zip', include: EVIDENCE_INCLUDE, exportClass: 'evidence', outputPath: fullPath },
        captureLifecycle
      )
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: { ...EVIDENCE_INCLUDE, notes: false },
          exportClass: 'evidence',
          outputPath: courtPath
        },
        captureLifecycle
      )

      const fullNames = [...readStoredZipEntries(fullPath).keys()].sort()
      const courtNames = [...readStoredZipEntries(courtPath).keys()].sort()
      expect(fullNames).toContain('notes.md')
      expect(courtNames).not.toContain('notes.md')
      expect(courtNames).toEqual(fullNames.filter((n) => n !== 'notes.md'))
    })

    it('writes notes.md even when the case has no notes, so exclusion stays distinguishable', async () => {
      await ingest(caseId, '<html><body>Content</body></html>')

      const outputPath = join(tempDir, 'no-notes.zip')
      await generateReport(
        caseId,
        { format: 'zip', include: EVIDENCE_INCLUDE, exportClass: 'evidence', outputPath },
        captureLifecycle
      )

      const notesMd = readStoredZipEntries(outputPath).get('notes.md')!.toString('utf-8')
      expect(notesMd).toContain('0 notes')
    })

    // The Working Copy's whole entry list, as a known answer: pages, notes and
    // the marker — and none of the evidentiary files (#399, ADR-0010).
    it('a Working Copy zip contains exactly the marker, pages and notes', async () => {
      updateCase({ id: caseId, caseNumber: 'CPS 2026/114' })
      getDb().prepare('UPDATE cases SET is_demo = 1 WHERE id = ?').run(caseId)
      const { capture } = await ingest(caseId, '<html><body>WC</body></html>')
      createNote({ caseId, title: 'Draft note', body: 'working copy body' })

      const outputPath = join(tempDir, 'working-copy.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: { ...EVIDENCE_INCLUDE, auditTrail: false },
          exportClass: 'working-copy',
          purposeOrAuthority: 'Internal review',
          outputPath
        },
        captureLifecycle
      )

      const entries = readStoredZipEntries(outputPath)
      expect([...entries.keys()].sort()).toEqual([
        'WORKING-COPY.json',
        'notes.md',
        `pages/${capture.id}.mhtml`
      ])

      const marker = JSON.parse(entries.get('WORKING-COPY.json')!.toString('utf-8')) as {
        exportClass: string
        statement: string
        case: {
          name: string
          caseNumber: string | null
          isDemo: boolean
          demoStatement?: string
        }
        purposeOrAuthority: string | null
        contents: { captureCount: number; screenshotCount: number; noteCount: number }
        artifacts: Array<{ path: string }>
      }
      expect(marker.exportClass).toBe('working-copy')
      expect(marker.statement).toContain('non-evidentiary')
      expect(marker.statement).toContain('cannot be verified')
      expect(marker.case.caseNumber).toBe('CPS 2026/114')
      expect(marker.case.isDemo).toBe(true)
      expect(marker.case.demoStatement).toContain('fixture data')
      expect(marker.purposeOrAuthority).toBe('Internal review')
      expect(marker.contents).toEqual({
        captureCount: 1,
        screenshotCount: 0,
        noteCount: 1,
        exhibitCountsByKind: {},
        derivedFileCount: 0,
        unanchoredDerivedFileCount: 0,
        unverifiableDerivedFileCount: 0,
        missingDerivedFileCount: 0
      })
      expect(marker.artifacts.map((a) => a.path).sort()).toEqual([
        'notes.md',
        `pages/${capture.id}.mhtml`
      ])
    })

    it('a Working Copy packages the operator-facing screenshot keyed by capture id', async () => {
      const screenshot = Buffer.from('raw-screenshot-bytes')
      const { capture } = await ingestMhtmlCapture({
        caseId,
        url: 'https://example.com/shot',
        title: 'Shot',
        timestamp: '2026-04-05T12:00:00.000Z',
        stream: Readable.from([
          Buffer.from('<html><body>Shot</body></html>')
        ]) as unknown as ReadableStream<Uint8Array>,
        textContent: 'shot',
        headers: {},
        browserVersion: '',
        userAgent: '',
        httpStatus: 200,
        extensionVersion: '',
        operatorId: 'op',
        operatorName: '',
        toolVersion: '0.1.0',
        screenshot
      })

      const outputPath = join(tempDir, 'wc-shots.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: {
            captures: true,
            screenshots: true,
            auditTrail: false,
            notes: false,
            annotations: 'none'
          },
          exportClass: 'working-copy',
          outputPath
        },
        captureLifecycle
      )

      const entries = readStoredZipEntries(outputPath)
      expect(entries.get(`screenshots/${capture.id}.png`)).toEqual(screenshot)
      expect([...entries.keys()].sort()).toEqual([
        'WORKING-COPY.json',
        `pages/${capture.id}.mhtml`,
        `screenshots/${capture.id}.png`
      ])
    })

    // R4's two known answers on the manifest entry: a Working Copy appends an
    // entry carrying exportClass 'working-copy'; an evidence export's entry
    // OMITS the key — never null, never 'evidence'.
    it('records exportClass on the Working Copy export entry and keeps the chain valid', async () => {
      await ingest(caseId, '<html><body>Audit</body></html>')

      const outputPath = join(tempDir, 'wc-audit.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: { ...EVIDENCE_INCLUDE, auditTrail: false },
          exportClass: 'working-copy',
          outputPath
        },
        captureLifecycle
      )

      const entry = lastManifestEntry()
      expect(entry.type).toBe('export')
      expect(entry.exportClass).toBe('working-copy')
      expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)
    })

    it('omits the exportClass key entirely from an evidence export entry', async () => {
      await ingest(caseId, '<html><body>Audit</body></html>')

      const outputPath = join(tempDir, 'ev-audit.zip')
      await generateReport(
        caseId,
        { format: 'zip', include: EVIDENCE_INCLUDE, exportClass: 'evidence', outputPath },
        captureLifecycle
      )

      const entry = lastManifestEntry()
      expect(entry.type).toBe('export')
      // Key absence, not a null/'evidence' value: the omit-when-absent
      // discipline keeps evidence entries byte-identical to pre-#399 ones.
      expect(Object.prototype.hasOwnProperty.call(entry, 'exportClass')).toBe(false)
    })

    it('rejects a Working Copy with a non-zip format', async () => {
      await ingest(caseId, '<html><body>Content</body></html>')

      await expect(
        generateReport(
          caseId,
          {
            format: 'html',
            include: { ...EVIDENCE_INCLUDE, auditTrail: false },
            exportClass: 'working-copy',
            outputPath: join(tempDir, 'wc.html')
          },
          captureLifecycle
        )
      ).rejects.toThrow(/working copy.*zip/i)
    })

    it('records caseNumber and isDemo in evidence.json and drops investigatorName', async () => {
      updateCase({ id: caseId, caseNumber: 'REF-9' })
      await ingest(caseId, '<html><body>Content</body></html>')

      const outputPath = join(tempDir, 'case-fields.zip')
      await generateReport(
        caseId,
        { format: 'zip', include: EVIDENCE_INCLUDE, exportClass: 'evidence', outputPath },
        captureLifecycle
      )

      const evidence = JSON.parse(
        readStoredZipEntries(outputPath).get('evidence.json')!.toString('utf-8')
      ) as { case: { caseNumber: string | null; isDemo: boolean } }
      expect(evidence.case.caseNumber).toBe('REF-9')
      expect(evidence.case.isDemo).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(evidence, 'investigatorName')).toBe(false)
    })

    // Frozen known answer for the notes serializer: fixed input, exact bytes.
    it('buildNotesMarkdown output is byte-stable for a fixed input', () => {
      const note = (over: Partial<Note>): Note => ({
        id: 'n1',
        caseId: 'c1',
        title: 'Title',
        body: 'Body text.',
        createdAt: '2026-08-01T10:00:00.000Z',
        updatedAt: '2026-08-02T11:00:00.000Z',
        ...over
      })

      const md = buildNotesMarkdown('Case X', '2026-08-24T00:00:00.000Z', [
        note({ id: 'n1', title: 'First finding', captureId: 'cap-1' }),
        note({ id: 'n2', title: '', body: '', sourceUrl: 'https://example.com/src' })
      ])

      expect(md).toBe(
        '# Operator notes — Case X\n' +
          '\n' +
          'Exported 2026-08-24T00:00:00.000Z. 2 notes.\n' +
          '\n' +
          'Operator work product: these notes were written by the operator in Birdbrain. They are\n' +
          'not captured page content and are not anchored in the capture manifest chain.\n' +
          '\n' +
          '---\n' +
          '\n' +
          '## First finding\n' +
          '\n' +
          '- Created: 2026-08-01T10:00:00.000Z\n' +
          '- Updated: 2026-08-02T11:00:00.000Z\n' +
          '- Attached to capture: cap-1\n' +
          '\n' +
          'Body text.\n' +
          '\n' +
          '---\n' +
          '\n' +
          '## Untitled note\n' +
          '\n' +
          '- Created: 2026-08-01T10:00:00.000Z\n' +
          '- Updated: 2026-08-02T11:00:00.000Z\n' +
          '- Source URL: https://example.com/src\n' +
          '\n' +
          '_(no text)_\n'
      )
    })

    // The same frozen known answer for the scoped header (#985): a scope
    // argument adds the subset statement and changes nothing else, so the bytes
    // a recipient reads are pinned for both shapes of the file.
    it('buildNotesMarkdown states the selection scope byte-for-byte when one is given', () => {
      const md = buildNotesMarkdown(
        'Case X',
        '2026-08-24T00:00:00.000Z',
        [
          {
            id: 'n1',
            caseId: 'c1',
            title: 'First finding',
            body: 'Body text.',
            captureId: 'cap-1',
            createdAt: '2026-08-01T10:00:00.000Z',
            updatedAt: '2026-08-02T11:00:00.000Z'
          }
        ],
        { selectedCaptureCount: 1, caseCaptureCount: 4, omittedNoteCount: 3 }
      )

      expect(md).toBe(
        '# Operator notes — Case X\n' +
          '\n' +
          'Exported 2026-08-24T00:00:00.000Z. 1 note.\n' +
          '\n' +
          'Operator work product: these notes were written by the operator in Birdbrain. They are\n' +
          'not captured page content and are not anchored in the capture manifest chain.\n' +
          '\n' +
          "Selection-scoped export: this export covers 1 of the case's 4 captures, and this\n" +
          'file holds the notes attached to them. 3 notes in the case are not included\n' +
          'here: a note attached to no capture, or to a capture outside the selection, is left\n' +
          'behind by the scope, and so is a note attached to a selected capture that also points\n' +
          "at another of the case's captures this export leaves out.\n" +
          '\n' +
          '---\n' +
          '\n' +
          '## First finding\n' +
          '\n' +
          '- Created: 2026-08-01T10:00:00.000Z\n' +
          '- Updated: 2026-08-02T11:00:00.000Z\n' +
          '- Attached to capture: cap-1\n' +
          '\n' +
          'Body text.\n'
      )
    })

    it('reads a single omitted note in the singular', () => {
      const md = buildNotesMarkdown('Case X', '2026-08-24T00:00:00.000Z', [], {
        selectedCaptureCount: 2,
        caseCaptureCount: 3,
        omittedNoteCount: 1
      })

      expect(md).toContain('1 note in the case is not included')
    })

    // The same frozen known answer for a note carrying an anchor (#985): the
    // anchored capture is printed when the row pointer does not already name
    // it, and is left unstated when the two agree.
    it('buildNotesMarkdown states an anchored capture the row does not name', () => {
      const md = buildNotesMarkdown('Case X', '2026-08-24T00:00:00.000Z', [
        {
          id: 'n1',
          caseId: 'c1',
          title: 'Anchored only',
          body: 'Body text.',
          anchor: { kind: 'capture', captureId: 'cap-9' },
          createdAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-02T11:00:00.000Z'
        }
      ])

      expect(md).toBe(
        '# Operator notes — Case X\n' +
          '\n' +
          'Exported 2026-08-24T00:00:00.000Z. 1 note.\n' +
          '\n' +
          'Operator work product: these notes were written by the operator in Birdbrain. They are\n' +
          'not captured page content and are not anchored in the capture manifest chain.\n' +
          '\n' +
          '---\n' +
          '\n' +
          '## Anchored only\n' +
          '\n' +
          '- Created: 2026-08-01T10:00:00.000Z\n' +
          '- Updated: 2026-08-02T11:00:00.000Z\n' +
          '- Anchored to capture: cap-9\n' +
          '\n' +
          'Body text.\n'
      )
    })

    it('states the anchored capture once when both pointers agree', () => {
      const md = buildNotesMarkdown('Case X', '2026-08-24T00:00:00.000Z', [
        {
          id: 'n1',
          caseId: 'c1',
          title: 'Both pointers',
          body: 'Body text.',
          captureId: 'cap-1',
          anchor: { kind: 'capture', captureId: 'cap-1' },
          createdAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-02T11:00:00.000Z'
        }
      ])

      expect(md).toContain('- Attached to capture: cap-1\n')
      expect(md).not.toContain('- Anchored to capture:')
    })
  })

  // #985: a selection-scoped export ships the notes attached to the selected
  // captures and nothing else, and says how many it left behind.
  describe('notes follow the selection scope (#985)', () => {
    const mentionNode = (targetId: string, label = 'Page', targetType = 'capture') => ({
      type: 'mention',
      attrs: { targetType, targetId, label }
    })
    const captureMentionDoc = (targetId: string, label?: string, targetType?: string): string =>
      JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'see ' }, mentionNode(targetId, label, targetType)]
          }
        ]
      })

    const NOTES_INCLUDE: ExportOptions['include'] = {
      captures: true,
      screenshots: false,
      auditTrail: true,
      notes: true,
      annotations: 'none'
    }

    async function seedTwoCapturesAndThreeNotes(): Promise<{
      selected: { id: string }
      unselected: { id: string }
    }> {
      const { capture: selected } = await ingest(
        caseId,
        '<html><body>Selected</body></html>',
        'https://example.com/selected',
        'Selected'
      )
      const { capture: unselected } = await ingest(
        caseId,
        '<html><body>Unselected</body></html>',
        'https://example.com/unselected',
        'Unselected'
      )
      createNote({
        caseId,
        captureId: selected.id,
        title: 'Note on the selected capture',
        body: 'about the exported page'
      })
      createNote({
        caseId,
        captureId: unselected.id,
        title: 'Note on the unselected capture',
        body: 'names an unrelated subject'
      })
      createNote({
        caseId,
        title: 'Unattached case note',
        body: 'a hypothesis about a third party'
      })
      return { selected, unselected }
    }

    it('an Evidence Package ships only the selected captures notes', async () => {
      const { selected } = await seedTwoCapturesAndThreeNotes()

      const outputPath = join(tempDir, 'scoped-notes.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: NOTES_INCLUDE,
          exportClass: 'evidence',
          outputPath,
          captureIds: [selected.id]
        },
        captureLifecycle
      )

      const notesMd = readStoredZipEntries(outputPath).get('notes.md')!.toString('utf-8')
      expect(notesMd).toContain('## Note on the selected capture')
      expect(notesMd).toContain('about the exported page')
      // The two the selection withholds, body text included: the disclosure
      // this ticket exists to stop is the note text, not just its title.
      expect(notesMd).not.toContain('Note on the unselected capture')
      expect(notesMd).not.toContain('names an unrelated subject')
      expect(notesMd).not.toContain('Unattached case note')
      expect(notesMd).not.toContain('a hypothesis about a third party')
      // ...and the file says it is a subset rather than leaving the recipient
      // to read one note as the case's whole work product.
      expect(notesMd).toContain('Exported')
      expect(notesMd).toContain('1 note.')
      expect(notesMd).toContain('2 notes in the case are not included')
    })

    it('the certification counts the notes the package actually holds', async () => {
      const { selected } = await seedTwoCapturesAndThreeNotes()

      const outputPath = join(tempDir, 'scoped-notes-cert.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: NOTES_INCLUDE,
          exportClass: 'evidence',
          outputPath,
          captureIds: [selected.id]
        },
        captureLifecycle
      )

      const certification = readStoredZipEntries(outputPath)
        .get('certification.html')!
        .toString('utf-8')
      expect(certification).toContain('1 operator note')
      expect(certification).not.toContain('3 operator notes')
    })

    it('the report states how many notes the scope left out', async () => {
      const { selected } = await seedTwoCapturesAndThreeNotes()

      const outputPath = join(tempDir, 'scoped-notes-report.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: NOTES_INCLUDE,
          exportClass: 'evidence',
          outputPath,
          captureIds: [selected.id]
        },
        captureLifecycle
      )

      const report = readStoredZipEntries(outputPath).get('report.html')!.toString('utf-8')
      expect(report).toContain('Selection-scoped export')
      expect(report).toContain('<code>notes.md</code> follows the same scope')
      expect(report).toContain('leaves out 2')
    })

    it('says nothing about notes in the report when the export excludes them', async () => {
      const { selected } = await seedTwoCapturesAndThreeNotes()

      const outputPath = join(tempDir, 'court-scoped.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: { ...NOTES_INCLUDE, notes: false },
          exportClass: 'evidence',
          outputPath,
          captureIds: [selected.id]
        },
        captureLifecycle
      )

      const entries = readStoredZipEntries(outputPath)
      expect([...entries.keys()]).not.toContain('notes.md')
      const report = entries.get('report.html')!.toString('utf-8')
      expect(report).toContain('Selection-scoped export')
      expect(report).not.toContain('follows the same scope')
    })

    it('a scoped Working Copy scopes notes.md and counts it in the marker', async () => {
      const { selected } = await seedTwoCapturesAndThreeNotes()

      const outputPath = join(tempDir, 'scoped-working-copy.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: { ...NOTES_INCLUDE, auditTrail: false },
          exportClass: 'working-copy',
          outputPath,
          captureIds: [selected.id]
        },
        captureLifecycle
      )

      const entries = readStoredZipEntries(outputPath)
      const notesMd = entries.get('notes.md')!.toString('utf-8')
      expect(notesMd).toContain('## Note on the selected capture')
      expect(notesMd).not.toContain('Unattached case note')
      // The Working Copy has no report and no certification, so the header is
      // the only place its recipient can read the omission.
      expect(notesMd).toContain('2 notes in the case are not included')

      const marker = JSON.parse(entries.get('WORKING-COPY.json')!.toString('utf-8')) as {
        contents: { noteCount: number }
      }
      expect(marker.contents.noteCount).toBe(1)
    })

    it('a whole-case export still ships every note, with no scope statement', async () => {
      await seedTwoCapturesAndThreeNotes()

      const outputPath = join(tempDir, 'whole-case-notes.zip')
      await generateReport(
        caseId,
        { format: 'zip', include: NOTES_INCLUDE, exportClass: 'evidence', outputPath },
        captureLifecycle
      )

      const entries = readStoredZipEntries(outputPath)
      const notesMd = entries.get('notes.md')!.toString('utf-8')
      expect(notesMd).toContain('## Note on the selected capture')
      expect(notesMd).toContain('## Note on the unselected capture')
      expect(notesMd).toContain('## Unattached case note')
      expect(notesMd).toContain('3 notes.')
      expect(notesMd).not.toContain('Selection-scoped export')

      const certification = entries.get('certification.html')!.toString('utf-8')
      expect(certification).toContain('3 operator notes')
    })

    it('withholds a note that names no capture, whatever its anchor points at', async () => {
      const { selected } = await seedTwoCapturesAndThreeNotes()
      createNote({
        caseId,
        title: 'Anchored to the selected capture',
        body: 'carries no capture_id',
        anchor: JSON.stringify({ kind: 'capture', captureId: selected.id })
      })

      const outputPath = join(tempDir, 'anchor-only-withheld-null-row.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: NOTES_INCLUDE,
          exportClass: 'evidence',
          outputPath,
          captureIds: [selected.id]
        },
        captureLifecycle
      )

      const notesMd = readStoredZipEntries(outputPath).get('notes.md')!.toString('utf-8')
      expect(notesMd).not.toContain('Anchored to the selected capture')
      expect(notesMd).not.toContain('carries no capture_id')
      expect(notesMd).toContain('1 note.')
      expect(notesMd).toContain('3 notes in the case are not included')
    })

    // `notes.capture_id` is ON DELETE SET NULL while `anchor_json` is plain
    // TEXT that keeps the deleted id, so a stale anchor is a dangling pointer
    // rather than a statement about the selection. Treating it as one would
    // withhold the note from every scoped export, including select-all, and
    // the header would attribute the omission to a capture the case no longer
    // holds.
    it('ships a note whose anchor names a capture the case no longer holds', async () => {
      const { selected, unselected } = await seedTwoCapturesAndThreeNotes()
      createNote({
        caseId,
        captureId: selected.id,
        title: 'Anchor outlived its capture',
        body: 'attached to the exported page',
        anchor: JSON.stringify({ kind: 'capture', captureId: unselected.id })
      })
      expect(deleteCapture(unselected.id)).toBe(true)

      const outputPath = join(tempDir, 'stale-anchor-included.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: NOTES_INCLUDE,
          exportClass: 'evidence',
          outputPath,
          captureIds: [selected.id]
        },
        captureLifecycle
      )

      const notesMd = readStoredZipEntries(outputPath).get('notes.md')!.toString('utf-8')
      expect(notesMd).toContain('## Anchor outlived its capture')
      expect(notesMd).toContain(`- Attached to capture: ${selected.id}`)
      expect(notesMd).toContain(`- Anchored to capture: ${unselected.id}`)
    })

    it('ships a subset of both candidate answers to the open scope question', () => {
      // Two selected captures, so the enumeration below reaches the shape where
      // both pointers are selected but name different captures.
      const selected = new Set(['cap-in', 'cap-also-in'])
      const inCase = new Set(['cap-in', 'cap-also-in', 'cap-out'])
      const base = {
        id: 'n1',
        caseId: 'c1',
        title: 't',
        body: 'b',
        createdAt: '2026-08-01T10:00:00.000Z',
        updatedAt: '2026-08-01T10:00:00.000Z'
      }
      const pointers = [undefined, 'cap-in', 'cap-also-in', 'cap-out', 'cap-deleted']
      const shapes: Note[] = pointers.flatMap((captureId) =>
        pointers.map((anchored) => ({
          ...base,
          ...(captureId === undefined ? {} : { captureId }),
          ...(anchored === undefined
            ? {}
            : { anchor: { kind: 'capture' as const, captureId: anchored } })
        }))
      )
      // (B) read the row pointer; (C) read either pointer. The third candidate,
      // reading the anchor alone, was withdrawn on 2026-08-31 as one that ships
      // an empty notes.md for every export the shipped interface can produce.
      const readsRowPointer = (note: Note): boolean =>
        note.captureId !== undefined && selected.has(note.captureId)
      const readsEitherPointer = (note: Note): boolean =>
        (note.captureId !== undefined && selected.has(note.captureId)) ||
        (note.anchor !== undefined && selected.has(note.anchor.captureId))

      // A Capture Mention is a third pointer; every shape above gains each one.
      const withMentions: Note[] = shapes.flatMap((note) => [
        note,
        ...pointers
          .filter((id): id is string => id !== undefined)
          .map((mentioned) => ({ ...note, bodyDoc: captureMentionDoc(mentioned) }))
      ])

      const shipped = withMentions.filter((note) =>
        noteTravelsWithSelection(note, selected, inCase)
      )
      expect(shipped.length).toBeGreaterThan(0)
      for (const note of shipped) {
        expect(readsRowPointer(note)).toBe(true)
        expect(readsEitherPointer(note)).toBe(true)
      }
    })

    it('withholds a note whose anchor points outside the selection', async () => {
      const { selected, unselected } = await seedTwoCapturesAndThreeNotes()
      createNote({
        caseId,
        captureId: selected.id,
        title: 'Row says selected, anchor says otherwise',
        body: 'quotes the withheld page',
        anchor: JSON.stringify({ kind: 'capture', captureId: unselected.id })
      })

      const outputPath = join(tempDir, 'anchor-outside-withheld.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: NOTES_INCLUDE,
          exportClass: 'evidence',
          outputPath,
          captureIds: [selected.id]
        },
        captureLifecycle
      )

      const notesMd = readStoredZipEntries(outputPath).get('notes.md')!.toString('utf-8')
      expect(notesMd).not.toContain('Row says selected, anchor says otherwise')
      expect(notesMd).not.toContain('quotes the withheld page')
      expect(notesMd).toContain('1 note.')
      expect(notesMd).toContain('3 notes in the case are not included')
    })

    it('withholds a note anchored only to an unselected capture', async () => {
      const { selected, unselected } = await seedTwoCapturesAndThreeNotes()
      createNote({
        caseId,
        title: 'Anchored to the unselected capture',
        body: 'names the withheld subject',
        anchor: JSON.stringify({ kind: 'capture', captureId: unselected.id })
      })

      const outputPath = join(tempDir, 'anchor-only-withheld.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: NOTES_INCLUDE,
          exportClass: 'evidence',
          outputPath,
          captureIds: [selected.id]
        },
        captureLifecycle
      )

      const notesMd = readStoredZipEntries(outputPath).get('notes.md')!.toString('utf-8')
      expect(notesMd).not.toContain('Anchored to the unselected capture')
      expect(notesMd).not.toContain('names the withheld subject')
      expect(notesMd).toContain('3 notes in the case are not included')
    })

    it('withholds a note whose text mentions a capture outside the selection', async () => {
      const { selected, unselected } = await seedTwoCapturesAndThreeNotes()
      createNote({
        caseId,
        captureId: selected.id,
        title: 'Mentions the unselected capture',
        bodyDoc: captureMentionDoc(unselected.id, 'Withheld page title')
      })

      const outputPath = join(tempDir, 'mention-outside-withheld.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: NOTES_INCLUDE,
          exportClass: 'evidence',
          outputPath,
          captureIds: [selected.id]
        },
        captureLifecycle
      )

      const notesMd = readStoredZipEntries(outputPath).get('notes.md')!.toString('utf-8')
      expect(notesMd).not.toContain('Mentions the unselected capture')
      expect(notesMd).not.toContain('Withheld page title')
      expect(notesMd).toContain('3 notes in the case are not included')
    })

    it('reads Capture Mentions to withhold, ignoring other kinds and deleted captures', () => {
      const selected = new Set(['cap-in', 'cap-also-in'])
      const inCase = new Set(['cap-in', 'cap-also-in', 'cap-out'])
      const note = (bodyDoc?: string): Note => ({
        id: 'n1',
        caseId: 'c1',
        captureId: 'cap-in',
        title: 't',
        body: 'b',
        ...(bodyDoc === undefined ? {} : { bodyDoc }),
        createdAt: '2026-08-01T10:00:00.000Z',
        updatedAt: '2026-08-01T10:00:00.000Z'
      })
      const travels = (bodyDoc?: string) =>
        noteTravelsWithSelection(note(bodyDoc), selected, inCase)

      expect(travels()).toBe(true)
      expect(travels(captureMentionDoc('cap-also-in'))).toBe(true)
      expect(travels(captureMentionDoc('cap-out'))).toBe(false)
      expect(travels(captureMentionDoc('cap-deleted'))).toBe(true)
      expect(travels(captureMentionDoc('cap-out', 'Tag', 'tag'))).toBe(true)
      expect(
        travels(
          JSON.stringify({
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [mentionNode('cap-also-in'), mentionNode('cap-out')]
              }
            ]
          })
        )
      ).toBe(false)
    })
  })
  // Known-answer tests for the mixed-kind package (#1156). The fixture Case is
  // the one shared with the package-verifier and built-binary tests, so all
  // three describe the same object.
  describe('exhibits of every kind (#1156)', () => {
    let fixture: MixedKindCase

    beforeEach(async () => {
      fixture = await seedMixedKindCase({ tempDir })
    })

    const exportMixed = async (
      name: string,
      options: Partial<ExportOptions> = {}
    ): Promise<Map<string, Buffer>> => {
      const outputPath = join(tempDir, name)
      await generateReport(
        fixture.caseId,
        {
          format: 'zip',
          include: {
            captures: true,
            screenshots: true,
            auditTrail: true,
            notes: false,
            annotations: 'none'
          },
          exportClass: 'evidence',
          outputPath,
          ...options
        },
        captureLifecycle
      )
      return readStoredZipEntries(outputPath)
    }

    it('ships every committed exhibit and derived file under its kind directory', async () => {
      const entries = await exportMixed('mixed-evidence.zip')

      for (const exhibit of fixture.committed) {
        expect(entries.get(exhibit.packagePath), exhibit.packagePath).toEqual(exhibit.bytes)
      }
      // A Capture's thumbnail is a Derived File (X34, D2), so it ships beside
      // the page archive it was computed from.
      expect(entries.has(fixture.thumbnailPackagePath)).toBe(true)
      expect(entries.has(`pages/${fixture.captureId}.mhtml`)).toBe(true)

      const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
        schemaVersion: number
        exhibits: Array<{
          id: string
          kind: string
          origin: string
          exhibitNumber: number
          name: string
          contentHash: string
          path: string | null
          derivedFiles: Array<{ derivation: string; path: string | null; contentHash: string }>
        }>
        artifacts: Array<{ path: string }>
      }
      expect(evidence.schemaVersion).toBe(2)
      expect(evidence.exhibits.map((e) => e.kind)).toEqual([
        'capture',
        'attachment',
        'image',
        'document'
      ])
      // Numbers are the ones the `exhibits` table recorded at commit (X18),
      // never positions in this list.
      expect(evidence.exhibits.map((e) => e.exhibitNumber)).toEqual([
        1,
        ...fixture.committed.map((e) => e.exhibitNumber)
      ])
      const capture = evidence.exhibits[0]
      expect(capture.derivedFiles).toEqual([
        {
          derivation: 'thumbnail',
          path: fixture.thumbnailPackagePath,
          contentHash: sha256Hex(entries.get(fixture.thumbnailPackagePath)!)
        }
      ])
      expect(evidence.exhibits[1].name).toBe('bundle.zip')
      expect(evidence.exhibits[1].origin).toBe('manual-upload')
      // Every enclosed exhibit file is in the artifact index, so packageHash
      // covers it and step 1 of the runbook re-hashes it.
      const indexed = new Set(evidence.artifacts.map((a) => a.path))
      for (const exhibit of fixture.committed) expect(indexed.has(exhibit.packagePath)).toBe(true)
      expect(indexed.has(fixture.thumbnailPackagePath)).toBe(true)
    })

    it('renders one report block per exhibit citing its stored exhibit number', async () => {
      const entries = await exportMixed('mixed-report.zip')
      const report = entries.get('report.html')!.toString('utf-8')

      for (const exhibit of fixture.committed) {
        expect(report).toContain(`Exhibit ${exhibit.exhibitNumber}</span>`)
        expect(report).toContain(exhibit.packagePath)
      }
      expect(report).toContain('Supplied to the tool, not captured by it')
      expect(report).toContain('Kind and origin')

      const certification = entries.get('certification.html')!.toString('utf-8')
      expect(certification).toContain('1 capture, 1 attachment, 1 document, 1 image')
      expect(certification).toContain('1 derived file')
      // The Certification's claims cover every kind, not the captures alone.
      expect(certification).toMatch(/4\s+exhibits\s+in\s+this\s+export/)
    })

    it('scopes a selection over mixed kinds and states what it leaves out', async () => {
      const selected = fixture.document
      const entries = await exportMixed('mixed-selection.zip', {
        captureIds: [fixture.captureId, selected.id]
      })

      expect(entries.has(selected.packagePath)).toBe(true)
      expect(entries.has(fixture.attachment.packagePath)).toBe(false)
      expect(entries.has(fixture.image.packagePath)).toBe(false)

      const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
        exhibits: Array<{ id: string }>
      }
      expect(evidence.exhibits.map((e) => e.id)).toEqual([fixture.captureId, selected.id])

      // The signed statement of scope carries Exhibit ids of every kind, in the
      // field it has always had (D3).
      const exportEntry = JSON.parse(entries.get('export-entry.json')!.toString('utf-8')) as {
        scope: string
        captureIds: string[]
      }
      expect(exportEntry.scope).toBe('selection')
      expect([...exportEntry.captureIds].sort()).toEqual([fixture.captureId, selected.id].sort())

      // #985's disclosure: the count left out is stated, not left to be counted.
      const report = entries.get('report.html')!.toString('utf-8')
      expect(report).toContain('It also leaves out 2 committed exhibit')
    })

    it('discloses an altered exhibit rather than packaging it silently', async () => {
      // The export's verification run covers every kind (X37): bytes that no
      // longer recompute to the digest the chain records are stated as altered
      // on the exhibit's own page and counted out of the cover tally.
      const target = fixture.attachment
      const stored = listExhibits(fixture.caseId).find((e) => e.id === target.id)!
      writeFileSync(join(tempDir, 'captures', stored.path!), 'substituted attachment bytes')

      const entries = await exportMixed('mixed-altered.zip')
      const report = entries.get('report.html')!.toString('utf-8')

      expect(report).toContain('Changed since capture')
      expect(report).not.toContain('Altered')
      expect(report).toContain(
        'The stored bytes no longer recompute to the digest recorded for this exhibit'
      )
      // Counted over every kind: three of the four exhibits verify.
      expect(report).toContain('3 / 4')
    })

    it('states a committed exhibit whose stored bytes are gone as a gap', async () => {
      const target = fixture.image
      const stored = listExhibits(fixture.caseId).find((e) => e.id === target.id)!
      rmSync(join(tempDir, 'captures', stored.path!))

      const entries = await exportMixed('mixed-missing.zip')
      expect(entries.has(target.packagePath)).toBe(false)

      const report = entries.get('report.html')!.toString('utf-8')
      expect(report).toContain('Stored file not available')
      expect(report).toContain('Absent')

      const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
        warnings: { missingContentExhibitCount: number; missingContentExhibitIds: string[] }
        exhibits: Array<{ id: string; path: string | null }>
      }
      expect(evidence.warnings.missingContentExhibitCount).toBe(1)
      expect(evidence.warnings.missingContentExhibitIds).toEqual([target.id])
      expect(evidence.exhibits.find((e) => e.id === target.id)!.path).toBeNull()
    })

    it('states one verification result on the cover and under chain of custody', async () => {
      // Two derivations of the same run is what let the cover print "4 / 4
      // integrity verified - produced by the verification run recorded under
      // Chain of custody" over a section that said "1 of 1 verified".
      const entries = await exportMixed('mixed-tally.zip')
      const report = entries.get('report.html')!.toString('utf-8')

      expect(report).toContain('4 / 4')
      expect(report).toMatch(/Verification run[\s\S]{0,200}?4 of 4 verified/)
      expect(report).not.toContain('1 of 1 verified')
    })

    it('reports the verification run on a selection holding no capture', async () => {
      const entries = await exportMixed('mixed-exhibits-only.zip', {
        captureIds: [fixture.document.id]
      })
      const report = entries.get('report.html')!.toString('utf-8')

      expect(report).toContain('1 / 1')
      expect(report).toMatch(/Verification run[\s\S]{0,200}?1 of 1 verified/)
      // The shape this PR made possible, and the one the cover contradicted:
      // an export whose only exhibits are committed files did run a
      // verification, and the custody section has to say so.
      expect(report).not.toContain('No verification was run for this export')
    })

    it('holds back an unanchored derived file and discloses the omission', async () => {
      // X34's case: the backfill records a thumbnail it could not anchor. The
      // package must not enclose bytes the chain does not cover, evidence.json
      // must not attribute them to an Exhibit, and the report must not claim
      // anchoring for them — but the reader has to be told they exist.
      const unanchored = seedUnanchoredDerivedFile(tempDir, fixture.caseId, fixture.attachment.id)
      const entries = await exportMixed('mixed-unanchored.zip')

      const names = [...entries.keys()]
      expect(names.some((name) => name.endsWith('_text.txt'))).toBe(false)
      expect([...entries.values()].some((bytes) => bytes.equals(unanchored.bytes))).toBe(false)

      const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
        exhibits: Array<{ id: string; derivedFiles: Array<{ derivation: string }> }>
        artifacts: Array<{ path: string }>
      }
      const row = evidence.exhibits.find((e) => e.id === fixture.attachment.id)!
      expect(row.derivedFiles).toEqual([])
      expect(evidence.artifacts.some((a) => a.path.endsWith('_text.txt'))).toBe(false)

      const report = entries.get('report.html')!.toString('utf-8')
      expect(report).toContain('recorded but not anchored, and therefore not enclosed')
      expect(report).toContain('no manifest entry names it')
      expect(report).toContain('nothing in the chain states what was produced')

      const certification = entries.get('certification.html')!.toString('utf-8')
      expect(certification).toContain('1 unanchored derived file recorded and not enclosed')
      // The anchored thumbnail is still counted, and counted once.
      expect(certification).toContain('1 derived file enclosed,')
    })

    it('holds back a no-entry derived file whose bytes are gone, with the X34 cause', async () => {
      // The state that reached neither verifier honestly: no manifest entry
      // names the file AND its bytes cannot be read. Classifying on the read
      // failure first called it anchored, so the report said the chain
      // anchors it and evidence.json listed it with a null path, which the
      // binary then FAILed as a fabricated row on an intact chain.
      const unanchored = seedUnanchoredDerivedFile(tempDir, fixture.caseId, fixture.attachment.id)
      rmSync(join(tempDir, 'captures', unanchored.storedPath))

      const entries = await exportMixed('mixed-noentry-gone.zip')
      const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
        exhibits: Array<{ id: string; derivedFiles: Array<{ derivation: string }> }>
      }
      expect(evidence.exhibits.find((e) => e.id === fixture.attachment.id)!.derivedFiles).toEqual(
        []
      )

      const report = entries.get('report.html')!.toString('utf-8')
      expect(report).toContain('recorded but not anchored, and therefore not enclosed')
      expect(report).toContain('nothing in the chain states what was produced')
      expect(report).not.toContain('The chain anchors 1 file')

      const certification = entries.get('certification.html')!.toString('utf-8')
      expect(certification).toContain('1 unanchored derived file recorded and not enclosed')
      expect(certification).not.toContain('2 derived files')
    })

    it('discloses an anchored derived file whose bytes are gone as a gap', async () => {
      const thumbnail = listDerivedFilesForCase(fixture.caseId).find(
        (file) => file.exhibitId === fixture.captureId
      )!
      rmSync(join(tempDir, 'captures', thumbnail.path))

      const entries = await exportMixed('mixed-anchored-gone.zip')
      expect(entries.has(fixture.thumbnailPackagePath)).toBe(false)

      // Not listed either: a row with a null path is a row the two verifiers
      // read differently, and both already FAIL through the chain-side check.
      const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
        exhibits: Array<{ id: string; derivedFiles: unknown[] }>
      }
      expect(evidence.exhibits.find((e) => e.id === fixture.captureId)!.derivedFiles).toEqual([])

      const report = entries.get('report.html')!.toString('utf-8')
      expect(report).toContain('could not be read and is not enclosed')
      expect(report).toContain('The chain anchors 1 file')

      const certification = entries.get('certification.html')!.toString('utf-8')
      expect(certification).toContain(
        '1 derived file named by a manifest entry whose stored bytes could not be read and are ' +
          'not enclosed'
      )
    })

    it('says the chain did not verify rather than that an entry is absent', async () => {
      // The state the app is most likely to be exporting when it matters: a
      // manifest that has been altered. The `derivation` entry for the
      // thumbnail is still in the chain and still states what was produced and
      // from which bytes, so neither document may say no entry does — and the
      // file is not held back, because the hold-back rule keys on a missing
      // entry and not on a failing chain.
      const manifestPath = join(tempDir, 'captures', fixture.caseId, 'manifest.jsonl')
      const lines = readFileSync(manifestPath, 'utf-8').trim().split('\n')
      const edited = JSON.parse(lines[0]) as Record<string, unknown>
      edited.operatorName = 'TAMPERED'
      lines[0] = JSON.stringify(edited)
      writeFileSync(manifestPath, lines.join('\n') + '\n')

      const entries = await exportMixed('mixed-broken-chain.zip')

      // Still enclosed and still indexed: the entry names it.
      expect(entries.has(fixture.thumbnailPackagePath)).toBe(true)
      const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
        exhibits: Array<{ id: string; derivedFiles: Array<{ derivation: string }> }>
      }
      const captureRow = evidence.exhibits.find((e) => e.id === fixture.captureId)!
      expect(captureRow.derivedFiles.map((d) => d.derivation)).toEqual(['thumbnail'])

      const report = entries.get('report.html')!.toString('utf-8')
      expect(report).toContain('The chain does not verify, so the anchoring of')
      expect(report).toContain('could not be established')
      expect(report).not.toContain('nothing in the chain states what was produced')
      expect(report).not.toContain('recorded but not anchored')

      const certification = entries.get('certification.html')!.toString('utf-8')
      expect(certification).toContain(
        'whose anchoring could not be established because the chain did not verify'
      )
      expect(certification).not.toContain('unanchored derived file')
      // Enclosed, so it is counted as enclosed: the anchoring clause is a
      // re-count of the same file and never the enclosure statement.
      expect(certification).toContain('1 derived file enclosed,')
    })

    it('does not certify a file as enclosed because its chain did not verify', async () => {
      // The two axes crossed: a broken chain AND bytes the export cannot read.
      // The zip and the report both omit the file, correctly; counting it as
      // unverifiable INSTEAD of answering the enclosure question put it under
      // the certification's enclosed clause, so the document claimed to
      // contain a file it does not.
      const thumbnail = listDerivedFilesForCase(fixture.caseId).find(
        (file) => file.exhibitId === fixture.captureId
      )!
      rmSync(join(tempDir, 'captures', thumbnail.path))
      const manifestPath = join(tempDir, 'captures', fixture.caseId, 'manifest.jsonl')
      const lines = readFileSync(manifestPath, 'utf-8').trim().split('\n')
      const edited = JSON.parse(lines[0]) as Record<string, unknown>
      edited.operatorName = 'TAMPERED'
      lines[0] = JSON.stringify(edited)
      writeFileSync(manifestPath, lines.join('\n') + '\n')

      const entries = await exportMixed('mixed-broken-chain-gone.zip')
      expect(entries.has(fixture.thumbnailPackagePath)).toBe(false)
      const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
        exhibits: Array<{ id: string; derivedFiles: unknown[] }>
      }
      expect(evidence.exhibits.find((e) => e.id === fixture.captureId)!.derivedFiles).toEqual([])

      const certification = entries.get('certification.html')!.toString('utf-8')
      expect(certification).not.toContain('1 derived file enclosed')
      expect(certification).toContain(
        '1 derived file named by a manifest entry whose stored bytes could not be read and are ' +
          'not enclosed'
      )
      // And the anchoring gap is still disclosed, over that same file.
      expect(certification).toContain(
        '1 derived file counted above whose anchoring could not be established because the ' +
          'chain did not verify'
      )
    })

    it('says nothing about enclosure in a standalone HTML report', async () => {
      // A standalone report assembles no package, so every derived file would
      // otherwise land in the not-enclosed bucket and be described as a gap
      // over bytes that are on disk and fine. Reached through the IPC handler
      // rather than the dialog, which pins format: 'zip' today.
      const outputPath = join(tempDir, 'standalone.html')
      await generateReport(
        fixture.caseId,
        {
          format: 'html',
          include: {
            captures: true,
            screenshots: true,
            auditTrail: true,
            notes: false,
            annotations: 'none'
          },
          exportClass: 'evidence',
          outputPath
        },
        captureLifecycle
      )
      const report = readFileSync(outputPath, 'utf-8')

      expect(report).toContain('anchored in the chain by its own entry')
      expect(report).toContain('the stored bytes recompute to the digest that entry records')
      expect(report).toContain('This document was exported on its own')
      // None of the package-only language, in either direction.
      expect(report).not.toContain('could not be read and is not enclosed')
      expect(report).not.toContain('is enclosed beside it')
      expect(report).not.toContain('recorded but not anchored')
      expect(report).not.toContain('evidence.json</code>, which indexes what this package')
    })

    it('discloses a lost derived file in a standalone HTML report', async () => {
      // The chain state alone would leave the operator of a Case with a lost
      // derived file untold that it is lost; the packaged report says so, and
      // this one has no reason to be quieter.
      const thumbnail = listDerivedFilesForCase(fixture.caseId).find(
        (file) => file.exhibitId === fixture.captureId
      )!
      rmSync(join(tempDir, 'captures', thumbnail.path))

      const outputPath = join(tempDir, 'standalone-lost.html')
      await generateReport(
        fixture.caseId,
        {
          format: 'html',
          include: {
            captures: true,
            screenshots: true,
            auditTrail: true,
            notes: false,
            annotations: 'none'
          },
          exportClass: 'evidence',
          outputPath
        },
        captureLifecycle
      )
      const report = readFileSync(outputPath, 'utf-8')

      expect(report).toContain('the stored file could not be read')
      expect(report).toContain('anchored in the chain by its own entry')
      // The note's own sentence states that this document encloses nothing at
      // all; what must not appear is a per-file enclosure finding, in either
      // direction, since there is no package for one to be about.
      expect(report).toContain('This document was exported on its own')
      expect(report).not.toContain('could not be read and is not enclosed')
      expect(report).not.toContain('is enclosed beside it')
      expect(report).not.toContain('evidence.json</code>, which indexes what this package')
    })

    it('refuses the export when a capture artifact is present but unreadable', async () => {
      // The Capture path is outside `createPackageReader` (its artifacts are
      // probed and read separately, as they were before #1156), so a read
      // failure there is an error and not a classification: the export fails
      // and writes nothing, rather than quietly narrowing the package. Pinned
      // so that behaviour cannot drift into a silent narrowing, and named in
      // the PR's findings list as a follow-up candidate.
      const mhtml = join(tempDir, 'captures', fixture.caseId, `${fixture.captureId}.mhtml`)
      chmodSync(mhtml, 0o000)
      let stillReadable: boolean
      try {
        accessSync(mhtml, constants.R_OK)
        stillReadable = true
      } catch {
        stillReadable = false
      }
      // Root defeats the mode bits and there is no portable way to make a file
      // unreadable to a process that may read anything.
      if (stillReadable) {
        chmodSync(mhtml, 0o644)
        return
      }

      const outputPath = join(tempDir, 'capture-unreadable.zip')
      try {
        await expect(
          generateReport(
            fixture.caseId,
            {
              format: 'zip',
              include: {
                captures: true,
                screenshots: false,
                auditTrail: false,
                notes: false,
                annotations: 'none'
              },
              exportClass: 'evidence',
              outputPath
            },
            captureLifecycle
          )
        ).rejects.toThrow(/EACCES|permission denied/i)
        expect(existsSync(outputPath)).toBe(false)
      } finally {
        chmodSync(mhtml, 0o644)
      }
    })

    it('ships the same exhibits and derived files in a Working Copy', async () => {
      const entries = await exportMixed('mixed-working-copy.zip', {
        exportClass: 'working-copy',
        include: {
          captures: true,
          screenshots: true,
          auditTrail: false,
          notes: false,
          annotations: 'none'
        }
      })

      for (const exhibit of fixture.committed) {
        expect(entries.get(exhibit.packagePath), exhibit.packagePath).toEqual(exhibit.bytes)
      }
      expect(entries.has(fixture.thumbnailPackagePath)).toBe(true)
      // Still no evidentiary material: the class split is untouched.
      expect(entries.has('manifest.jsonl')).toBe(false)
      expect(entries.has('certification.html')).toBe(false)

      const marker = JSON.parse(entries.get('WORKING-COPY.json')!.toString('utf-8')) as {
        contents: { exhibitCountsByKind: Record<string, number>; derivedFileCount: number }
        exhibits: Array<{ id: string; kind: string }>
      }
      expect(marker.contents.exhibitCountsByKind).toEqual({
        attachment: 1,
        image: 1,
        document: 1
      })
      expect(marker.contents.derivedFileCount).toBe(1)
      expect(marker.exhibits.map((e) => e.kind).sort()).toEqual(['attachment', 'document', 'image'])
    })
  })
})
