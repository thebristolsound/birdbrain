import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { getCase, listCases } from '@main/services/db/caseRepo'
import { listCaptures } from '@main/services/db/captureRepo'
import { listSelectors } from '@main/services/db/selectorRepo'
import { listNotes } from '@main/services/db/noteRepo'
import { initStorage, getStorageRoot } from '@main/services/storage'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSigningKey, resetSigningKey } from '@main/services/signingKey'
import { readEntries, verifyManifestChain } from '@main/services/manifest'
import { defaultCaptureStore } from '@main/services/captureStore'
import {
  inspectCaseArchive,
  importCaseArchive,
  CASE_ARCHIVE_SCHEMA_VERSION
} from '@main/services/caseArchive'
import { DEMO_CASE_ARCHIVE_FILENAME, DEMO_CASE_OPERATOR_NAME } from '@shared/constants'
import { MANIFEST_FILENAME } from '@shared/constants'

/**
 * Known-answer test for the shipped demonstration Case Archive (#405, R7).
 *
 * The fixture is a frozen binary: it was produced once by
 * `pnpm build:demo-fixture` and committed. Nothing else in the suite would
 * notice a schema move that the frozen archive can no longer satisfy — the
 * first person to find out would be an operator on their first launch. These
 * assertions read the shipped bytes against the CURRENT schema, so that failure
 * lands in CI instead, and the fix is to regenerate the fixture.
 */
const FIXTURE = resolve(__dirname, '../../../resources', DEMO_CASE_ARCHIVE_FILENAME)

describe('bundled demo case archive', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-demo-fixture-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    resetSigningKey()
    initSigningKey(tempDir, { confirmUnprotectedKey: () => true })
    initSettings(tempDir)
    updateSettings({ operatorName: 'Importing Operator' })
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('ships at the path the seeding code looks for', () => {
    expect(existsSync(FIXTURE)).toBe(true)
  })

  it('verifies against the key bundled in its own header', () => {
    const report = inspectCaseArchive(FIXTURE)

    expect(report.verification.overallValid).toBe(true)
    expect(report.verification.chainValid).toBe(true)
    expect(report.verification.artifactFailureCount).toBe(0)
    expect(report.verification.captureHashFailureCount).toBe(0)
    // Not a range check: a fixture written by a NEWER archive schema than the
    // release importing it is refused outright by inspectCaseArchive, so a
    // regenerated fixture must never outrun the constant.
    expect(report.schemaVersion).toBeLessThanOrEqual(CASE_ARCHIVE_SCHEMA_VERSION)
  })

  it('carries the fixed synthetic attribution rather than the building machine', () => {
    const report = inspectCaseArchive(FIXTURE)
    expect(report.sourceOperatorName).toBe(DEMO_CASE_OPERATOR_NAME)
  })

  it('imports against the current schema as a demonstration case', async () => {
    const { newCaseId } = await importCaseArchive(FIXTURE, {
      operatorName: DEMO_CASE_OPERATOR_NAME
    })

    const imported = getCase(newCaseId)
    expect(imported?.isDemo).toBe(true)
    expect(listCases().filter((c) => c.isDemo)).toHaveLength(1)
    // Content the tour points at: the viewer tabs, the Signals screen and the
    // Notes screen all need something on them for their coach marks to mean
    // anything, so the fixture is asserted to still carry all three.
    expect(listCaptures(newCaseId).length).toBeGreaterThanOrEqual(3)
    expect(listSelectors(newCaseId).length).toBeGreaterThanOrEqual(1)
    expect(listNotes(newCaseId).length).toBeGreaterThanOrEqual(1)
  })

  it('lands with a chain that still verifies after the import entry is appended', async () => {
    const { newCaseId } = await importCaseArchive(FIXTURE, {
      operatorName: DEMO_CASE_OPERATOR_NAME
    })

    const caseDir = join(getStorageRoot(), newCaseId)
    expect(verifyManifestChain(caseDir).valid).toBe(true)

    const entries = readEntries(readFileSync(join(caseDir, MANIFEST_FILENAME), 'utf-8'))
    const importEntry = entries.find((e) => e.type === 'import')
    // The custody entry names the fixture, not an empty string and not whatever
    // the local operator happens to be called: it is a truthful record that a
    // bundled fixture was imported by the app itself.
    expect(importEntry?.operatorName).toBe(DEMO_CASE_OPERATOR_NAME)
  })

  it('brings every capture artifact onto disk', async () => {
    const { newCaseId } = await importCaseArchive(FIXTURE, {
      operatorName: DEMO_CASE_OPERATOR_NAME
    })

    for (const capture of listCaptures(newCaseId)) {
      expect(defaultCaptureStore.readArtifact(newCaseId, capture.id, 'mhtml')).toBeTruthy()
      // Screenshots are what the tour's first viewer tab shows; a fixture that
      // lost them would leave the Screenshot tab blank on a fresh install.
      expect(defaultCaptureStore.readArtifact(newCaseId, capture.id, 'png')).toBeTruthy()
    }
  })

  it('is captured only from reserved .invalid hosts, so no third-party bytes ship', async () => {
    const { newCaseId } = await importCaseArchive(FIXTURE, {
      operatorName: DEMO_CASE_OPERATOR_NAME
    })

    for (const capture of listCaptures(newCaseId)) {
      expect(new URL(capture.url).hostname.endsWith('.invalid')).toBe(true)
    }
  })
})
