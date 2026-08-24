import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { spawnSync } from 'child_process'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { appendManifestEntry, initManifest } from '@main/services/manifest'
import {
  ingestMhtmlCapture,
  createCaptureLifecycle
} from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { generateReport } from '@main/services/export'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { canonicalStringify } from '@shared/verify'
import { buildSyntheticToken } from '../helpers/timestampFixtures'
import type { ExportOptions } from '@shared/types'

// Integration test for the BUILT SEA binary (#122 §11). It is GATED on the
// binary existing: `pnpm test` on a fresh checkout SKIPs these (the unit-level
// verifier coverage lives in tests/shared/verify/evidencePackage.test.ts). To
// run them: `pnpm build:verifier` first, then `pnpm test`.
const binaryName = process.platform === 'win32' ? 'birdbrain-verify.exe' : 'birdbrain-verify'
const binaryPath = resolve(__dirname, '..', '..', 'dist', 'verifier', binaryName)
const haveBinary = existsSync(binaryPath)

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

function unzipToDir(zipPath: string, destDir: string): void {
  for (const [name, bytes] of readStoredZipEntries(zipPath)) {
    const out = join(destDir, name)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, bytes)
  }
}

describe.skipIf(!haveBinary)('built verifier binary', () => {
  let tempDir: string
  let pkgDir: string
  let selPkgDir: string
  let captureId: string
  let unselectedCaptureId: string

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-binverify-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator', operatorRole: '', operatorOrganization: '' })

    const c = createCase({ name: 'Binary Verify Case', description: 'binary fixture' })
    const caseId = c.id
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'captures', caseId))
    const selectorLifecycle = createSelectorLifecycle({ emitRematched: () => {} })
    const captureLifecycle = createCaptureLifecycle({ selectorLifecycle })

    const screenshot = Buffer.from('screenshot-png-bytes-for-binary-verify')
    const { capture } = await ingestMhtmlCapture({
      caseId,
      url: 'https://example.com/page',
      title: 'Page',
      timestamp: '2026-04-05T12:00:00.000Z',
      stream: Readable.from([
        Buffer.from('<html><body>Binary packaged</body></html>')
      ]) as unknown as ReadableStream<Uint8Array>,
      textContent: 'extracted text',
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
    captureId = capture.id

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

    // A second capture so the selection export below scopes a real subset.
    const { capture: unselected } = await ingestMhtmlCapture({
      caseId,
      url: 'https://example.com/unselected',
      title: 'Unselected',
      timestamp: '2026-04-05T12:02:00.000Z',
      stream: Readable.from([
        Buffer.from('<html><body>Not selected</body></html>')
      ]) as unknown as ReadableStream<Uint8Array>,
      textContent: 'extracted text',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0'
    })
    unselectedCaptureId = unselected.id

    const outputPath = join(tempDir, 'evidence.zip')
    const options: ExportOptions = {
      format: 'zip',
      include: { captures: true, screenshots: true, auditTrail: true, annotations: 'none' },
      investigatorName: 'Test User',
      outputPath
    }
    await generateReport(caseId, options, captureLifecycle)

    pkgDir = mkdtempSync(join(tmpdir(), 'bb-binpkg-'))
    unzipToDir(outputPath, pkgDir)

    // A selection-scoped package (#398): only the first capture is enclosed.
    const selectionPath = join(tempDir, 'selection-evidence.zip')
    await generateReport(
      caseId,
      { ...options, outputPath: selectionPath, captureIds: [captureId] },
      captureLifecycle
    )
    selPkgDir = mkdtempSync(join(tmpdir(), 'bb-binselpkg-'))
    unzipToDir(selectionPath, selPkgDir)
  })

  afterAll(() => {
    closeDatabase()
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
    if (pkgDir && existsSync(pkgDir)) rmSync(pkgDir, { recursive: true, force: true })
    if (selPkgDir && existsSync(selPkgDir)) rmSync(selPkgDir, { recursive: true, force: true })
  })

  it('--self-check exits 0 and prints canonical bytes identical to the in-app core', () => {
    const golden = canonicalStringify({
      type: 'capture',
      url: 'https://example.com/page?q=a&b=c',
      captureId: '0196f7a2-aaaa-bbbb-cccc-000000000001',
      caseId: '0196f7a2-aaaa-bbbb-cccc-000000000002',
      timestamp: '2026-06-01T12:00:00.000Z',
      contentHash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      sizeBytes: 123456,
      operatorId: 'op-1',
      operatorName: 'Casey Operator',
      toolVersion: '0.4.0',
      index: 3,
      prevHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      schemaVersion: 2
    })
    const proc = spawnSync(binaryPath, ['--self-check'], { encoding: 'utf-8' })
    expect(proc.status).toBe(0)
    expect(proc.stdout.trim()).toBe(golden)
  })

  it('exits 0 with a PASS report on a good package', () => {
    const proc = spawnSync(binaryPath, [pkgDir], { encoding: 'utf-8' })
    expect(proc.status, proc.stdout + proc.stderr).toBe(0)
    expect(proc.stdout).toContain('RESULT: PASS')
  })

  // #398 backward verification through the BUILT binary: the frozen pre-scope
  // package (no export-entry.json, legacy export entry in its chain) must keep
  // passing byte-for-byte unchanged.
  it('exits 0 with a PASS report on the frozen pre-scope fixture package', () => {
    const fixtureDir = resolve(
      __dirname,
      '..',
      'shared',
      'verify',
      'fixtures',
      'pre-scope-package'
    )
    const proc = spawnSync(binaryPath, [fixtureDir], { encoding: 'utf-8' })
    expect(proc.status, proc.stdout + proc.stderr).toBe(0)
    expect(proc.stdout).toContain('RESULT: PASS')
  })

  // #398 selection scope through the BUILT binary: the unselected capture is a
  // SKIP accounted for by the signed export entry, not a FAIL.
  it('exits 0 with a PASS report on a selection-scoped package', () => {
    const proc = spawnSync(binaryPath, [selPkgDir], { encoding: 'utf-8' })
    expect(proc.status, proc.stdout + proc.stderr).toBe(0)
    expect(proc.stdout).toContain('RESULT: PASS')
    expect(proc.stdout).toContain(`[SKIP] capture ${unselectedCaptureId}`)
    expect(proc.stdout).toContain('outside the signed export selection')
  })

  it('exits 1 with a FAIL report on a tampered package', () => {
    const tamperDir = mkdtempSync(join(tmpdir(), 'bb-bintamper-'))
    // Copy the good package then mutate one MHTML byte.
    for (const [name, bytes] of readStoredZipEntries(join(tempDir, 'evidence.zip'))) {
      const out = join(tamperDir, name)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, bytes)
    }
    const p = join(tamperDir, 'pages', `${captureId}.mhtml`)
    const bytes = readFileSync(p)
    bytes[0] = bytes[0] ^ 0xff
    writeFileSync(p, bytes)

    const proc = spawnSync(binaryPath, [tamperDir], { encoding: 'utf-8' })
    expect(proc.status).toBe(1)
    expect(proc.stdout).toContain('RESULT: FAIL')
    expect(proc.stdout).toContain('content hash does not match manifest')
    rmSync(tamperDir, { recursive: true, force: true })
  })
})
