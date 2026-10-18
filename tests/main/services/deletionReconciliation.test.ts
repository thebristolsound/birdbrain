import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, appendFileSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { Readable } from 'stream'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture, deleteCapture, listCaptures } from '@main/services/db/captureRepo'
import { appendManifestEntry, initManifest, verifyManifestChain } from '@main/services/manifest'
import { scanUnreconciledDeletions } from '@main/services/deletionReconciliation'
import { ingestMhtmlCapture } from '@main/services/captureLifecycle'
import { exportCaseArchive, importCaseArchive } from '@main/services/caseArchive'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import type { Capture } from '@shared/types'

// #622. The state under test is the write-ahead crash window inside
// withDeletionEntry: the signed deletion entry is on disk and fsynced, the row
// is not yet gone. The chain verifies — correctly — so only a join against the
// database can see it.

describe('scanUnreconciledDeletions', () => {
  let tempDir: string
  let storageRoot: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-reconcile-'))
    storageRoot = join(tempDir, 'captures')
    initStorage(storageRoot)
    await initDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function makeCase(name: string): { caseId: string; caseDir: string } {
    const caseId = createCase({ name }).id
    ensureCaseDir(caseId)
    const caseDir = join(storageRoot, caseId)
    initManifest(caseDir)
    return { caseId, caseDir }
  }

  function addCapture(caseId: string, url: string): Capture {
    return insertCapture({
      caseId,
      url,
      title: url,
      hash: createHash('sha256').update(url).digest('hex'),
      timestamp: '2026-04-05T12:00:00.000Z',
      format: 'mhtml'
    })
  }

  // The crash artefact: a valid, fully-formed deletion entry appended while the
  // row is still live. Mirrors what withDeletionEntry leaves behind when the
  // process dies between the fsync and the row delete.
  function appendDeletion(
    caseDir: string,
    capture: Capture,
    overrides: { caseId?: string; reason?: string; operatorName?: string } = {}
  ): number {
    return appendManifestEntry(caseDir, {
      type: 'deletion',
      captureId: capture.id,
      caseId: overrides.caseId ?? capture.caseId,
      timestamp: '2026-04-05T13:30:00.000Z',
      contentHash: capture.hash,
      operatorId: 'op-1',
      operatorName: overrides.operatorName ?? 'Test Operator',
      toolVersion: '0.1.0',
      ...(overrides.reason !== undefined ? { reason: overrides.reason } : {})
    }).index
  }

  it('reports a deletion entry whose capture row is still live in the scanned case', () => {
    const { caseId, caseDir } = makeCase('Crash Case')
    const capture = addCapture(caseId, 'https://example.com/a')
    const index = appendDeletion(caseDir, capture)

    // Precondition: the chain is valid. The finding's claim depends on it.
    expect(verifyManifestChain(caseDir).valid).toBe(true)

    const report = scanUnreconciledDeletions()

    expect(report.available).toBe(true)
    expect(report.casesScanned).toBe(1)
    expect(report.unscanned).toEqual([])
    expect(report.findings).toEqual([
      {
        caseId,
        caseName: 'Crash Case',
        captureId: capture.id,
        manifestIndex: index,
        entryTimestamp: '2026-04-05T13:30:00.000Z',
        operatorName: 'Test Operator'
      }
    ])
  })

  it('carries the entry reason through when one was recorded (#580)', () => {
    const { caseId, caseDir } = makeCase('Reasoned')
    const capture = addCapture(caseId, 'https://example.com/reason')
    appendDeletion(caseDir, capture, { reason: 'pipeline self-test cleanup' })

    const [finding] = scanUnreconciledDeletions().findings
    expect(finding.reason).toBe('pipeline self-test cleanup')
  })

  it('reports nothing for a clean case whose deletion completed', () => {
    const { caseId, caseDir } = makeCase('Clean Case')
    const capture = addCapture(caseId, 'https://example.com/b')
    appendDeletion(caseDir, capture)
    // The half the crash never reached.
    expect(deleteCapture(capture.id)).toBe(true)

    const report = scanUnreconciledDeletions()
    expect(report.findings).toEqual([])
    expect(report.casesScanned).toBe(1)
    expect(report.available).toBe(true)
  })

  it('reports nothing for a case with no deletion entries at all', () => {
    const { caseId } = makeCase('Untouched')
    addCapture(caseId, 'https://example.com/c')

    const report = scanUnreconciledDeletions()
    expect(report.findings).toEqual([])
    expect(report.casesScanned).toBe(1)
  })

  // The wording claims a valid chain. Over a chain that does not verify, the
  // scan must say it did not look rather than say it found nothing.
  it('reports a chain-invalid case as unscanned, never as an unreconciled deletion', () => {
    const { caseId, caseDir } = makeCase('Broken Chain')
    const capture = addCapture(caseId, 'https://example.com/d')
    appendDeletion(caseDir, capture)
    // Rewrite the deletion entry's operatorName in place: the recomputed entry
    // hash no longer matches, so the chain breaks over the very entry a finding
    // would otherwise be raised for.
    const manifestPath = join(caseDir, 'manifest.jsonl')
    writeFileSync(
      manifestPath,
      readFileSync(manifestPath, 'utf-8').replace('"Test Operator"', '"Somebody Else"')
    )
    expect(verifyManifestChain(caseDir).valid).toBe(false)

    const report = scanUnreconciledDeletions()
    expect(report.findings).toEqual([])
    expect(report.casesScanned).toBe(0)
    expect(report.unscanned).toEqual([
      { caseId, caseName: 'Broken Chain', reason: 'Entry hash mismatch' }
    ])
  })

  it('reports an unparseable manifest line as unscanned', () => {
    const { caseId, caseDir } = makeCase('Corrupt')
    const capture = addCapture(caseId, 'https://example.com/e')
    appendDeletion(caseDir, capture)
    appendFileSync(join(caseDir, 'manifest.jsonl'), 'not json\n')

    const report = scanUnreconciledDeletions()
    expect(report.findings).toEqual([])
    expect(report.unscanned).toEqual([{ caseId, caseName: 'Corrupt', reason: 'Invalid JSON' }])
  })

  // readManifestSnapshot returns an empty buffer for a missing file rather than
  // throwing, and verifyManifestChainText reports an empty chain as valid. So
  // this case used to increment casesScanned and feed the panel's "every
  // deletion is reconciled" line: a check whose whole purpose is reconciling
  // manifests against the database, reporting a missing manifest as clean.
  // Note this is keyed on the file being absent, not on it being empty —
  // initManifest creates an empty file and that state is legitimate.
  it('reports a missing manifest as unscanned, not as a verified case', () => {
    const { caseId, caseDir } = makeCase('Lost Manifest')
    addCapture(caseId, 'https://example.com/lost')
    rmSync(join(caseDir, 'manifest.jsonl'))

    const report = scanUnreconciledDeletions()
    expect(report.available).toBe(true)
    expect(report.findings).toEqual([])
    expect(report.casesScanned).toBe(0)
    expect(report.unscanned).toHaveLength(1)
    expect(report.unscanned[0]).toMatchObject({ caseId, caseName: 'Lost Manifest' })
    expect(report.unscanned[0].reason).toContain('manifest is missing')
  })

  it('reports an unreadable manifest as unscanned rather than throwing', () => {
    const { caseId, caseDir } = makeCase('Unreadable')
    // A directory where the manifest file belongs: readFileSync throws EISDIR,
    // which is the class of fault (permissions, a mount gone) the scan must
    // survive without taking the whole panel down.
    rmSync(join(caseDir, 'manifest.jsonl'))
    mkdirSync(join(caseDir, 'manifest.jsonl'))

    const report = scanUnreconciledDeletions()
    expect(report.available).toBe(true)
    expect(report.findings).toEqual([])
    expect(report.unscanned).toHaveLength(1)
    expect(report.unscanned[0]).toMatchObject({ caseId, caseName: 'Unreadable' })
    expect(report.unscanned[0].reason).toContain('manifest unreadable')
  })

  // An imported chain carries the SOURCE installation's caseId in every entry,
  // and archive import remaps colliding ids. Joining on the entry's caseId
  // would therefore alias a finding onto an unrelated case's capture.
  it('does not raise a finding when the live row belongs to another case', () => {
    const { caseId: importedCaseId, caseDir: importedDir } = makeCase('Imported')
    const { caseId: otherCaseId } = makeCase('Other')
    const foreignCapture = addCapture(otherCaseId, 'https://example.com/foreign')
    // The entry names the source case it came from, not the case it now lives
    // in — and its captureId collides with a live row in a third case.
    appendDeletion(importedDir, foreignCapture, { caseId: 'source-installation-case-id' })

    const report = scanUnreconciledDeletions()
    expect(report.findings).toEqual([])
    expect(report.casesScanned).toBe(2)
    expect(report.unscanned).toEqual([])
    expect(importedCaseId).not.toBe(otherCaseId)
  })

  it('finds the entry when the same capture id IS live in the scanned case', () => {
    // The mirror of the test above: identical entry shape, but the row lives in
    // the scanned case, so the finding is real.
    const { caseId, caseDir } = makeCase('Scanned')
    const capture = addCapture(caseId, 'https://example.com/local')
    appendDeletion(caseDir, capture, { caseId: 'source-installation-case-id' })

    const report = scanUnreconciledDeletions()
    expect(report.findings.map((f) => f.captureId)).toEqual([capture.id])
    expect(report.findings[0].caseId).toBe(caseId)
  })

  it('reports every unreconciled entry across multiple cases', () => {
    const first = makeCase('First')
    const second = makeCase('Second')
    const a = addCapture(first.caseId, 'https://example.com/1')
    const b = addCapture(second.caseId, 'https://example.com/2')
    appendDeletion(first.caseDir, a)
    appendDeletion(second.caseDir, b)

    const report = scanUnreconciledDeletions()
    expect(report.findings.map((f) => f.caseName).sort()).toEqual(['First', 'Second'])
    expect(report.casesScanned).toBe(2)
  })

  // #1815. A Capture an archive import renamed is deleted under the id its
  // signed entry carries, so its trailing entry names that id, not the row's.
  describe('a Case an import renamed', () => {
    beforeEach(() => {
      initSettings(tempDir)
      updateSettings({ operatorName: 'Test Operator' })
      resetInstallationId()
      initInstallationId(tempDir)
    })

    afterEach(() => {
      resetInstallationId()
    })

    async function ingest(caseId: string, name: string): Promise<Capture> {
      const { capture } = await ingestMhtmlCapture({
        caseId,
        url: `https://example.com/${name}`,
        title: name,
        timestamp: '2026-04-05T12:00:00.000Z',
        stream: Readable.from([Buffer.from(name)]) as unknown as ReadableStream<Uint8Array>,
        textContent: name,
        headers: {},
        browserVersion: '',
        userAgent: '',
        httpStatus: 200,
        extensionVersion: '',
        operatorId: 'op-1',
        operatorName: 'Test Operator',
        toolVersion: '0.1.0'
      })
      return capture
    }

    // Exported and imported on this installation while the source is still
    // here, so the import gives each Capture row a new id.
    async function renamedImport(sourceId: string): Promise<{ caseId: string; caseDir: string }> {
      const archive = join(tempDir, `${sourceId}.birdbrain`)
      await exportCaseArchive(sourceId, archive)
      const { newCaseId } = await importCaseArchive(archive)
      return { caseId: newCaseId, caseDir: join(storageRoot, newCaseId) }
    }

    const scannedIn = (caseId: string) =>
      scanUnreconciledDeletions().findings.filter((finding) => finding.caseId === caseId)

    it('reports a trailing deletion under the signed id whose renamed row survived', async () => {
      const source = makeCase('Source')
      const signed = await ingest(source.caseId, 'renamed')
      const imported = await renamedImport(source.caseId)
      const [row] = listCaptures(imported.caseId)
      expect(row.id).not.toBe(signed.id)

      const index = appendDeletion(imported.caseDir, { ...row, id: signed.id })

      expect(scannedIn(imported.caseId)).toEqual([
        expect.objectContaining({ captureId: row.id, manifestIndex: index })
      ])
      expect(scannedIn(source.caseId)).toEqual([])
    })

    it('reports nothing once the renamed row is gone', async () => {
      const source = makeCase('Source')
      const signed = await ingest(source.caseId, 'gone')
      const imported = await renamedImport(source.caseId)
      const [row] = listCaptures(imported.caseId)
      appendDeletion(imported.caseDir, { ...row, id: signed.id })
      expect(deleteCapture(row.id)).toBe(true)

      expect(scannedIn(imported.caseId)).toEqual([])
    })

    // The source Case signed a deletion of its own before the export. Only a
    // row its own signed entry names may answer for an inherited entry.
    it('reports an inherited deletion only against the row it names', async () => {
      const source = makeCase('Source')
      const deleted = await ingest(source.caseId, 'deleted-at-source')
      const kept = await ingest(source.caseId, 'kept')
      appendDeletion(source.caseDir, deleted)
      expect(deleteCapture(deleted.id)).toBe(true)
      const imported = await renamedImport(source.caseId)
      const [row] = listCaptures(imported.caseId)
      expect(row.id).not.toBe(kept.id)

      expect(scannedIn(imported.caseId)).toEqual([])
    })

    it('reports an inherited deletion whose row survived against the renamed row', async () => {
      const source = makeCase('Source')
      const interrupted = await ingest(source.caseId, 'interrupted-at-source')
      const index = appendDeletion(source.caseDir, interrupted)
      const imported = await renamedImport(source.caseId)
      const [row] = listCaptures(imported.caseId)

      expect(scannedIn(imported.caseId)).toEqual([
        expect.objectContaining({ captureId: row.id, manifestIndex: index })
      ])
    })
  })

  it('returns an unavailable report rather than throwing when the database is closed', () => {
    makeCase('Doomed')
    closeDatabase()

    const report = scanUnreconciledDeletions()
    expect(report).toMatchObject({
      available: false,
      casesScanned: 0,
      findings: [],
      unscanned: []
    })
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
