import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { spawnSync } from 'child_process'
import { createHash, createSign, generateKeyPairSync } from 'crypto'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { appendManifestEntry, initManifest } from '@main/services/manifest'
import { signEntryHash } from '@main/services/signingKey'
import { ingestMhtmlCapture, createCaptureLifecycle } from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { generateReport } from '@main/services/export'
import { commitStagedFiles, uploadToStaging } from '@main/services/staging'
import * as numbering from '@main/services/exhibitNumbering'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { canonicalStringify } from '@shared/verify'
import { MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import { buildSyntheticToken } from '../helpers/timestampFixtures'
import { seedMixedKindCase, type MixedKindCase } from '../helpers/mixedKindCase'
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
  let wcPkgDir: string
  let captureId: string
  let unselectedCaptureId: string
  let mixedPkgDir: string
  let mixed: MixedKindCase

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
      include: {
        captures: true,
        screenshots: true,
        auditTrail: true,
        notes: false,
        annotations: 'none'
      },
      exportClass: 'evidence',
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

    // A Working Copy export (#399): the deliberately non-evidentiary class.
    const workingCopyPath = join(tempDir, 'working-copy.zip')
    await generateReport(
      caseId,
      {
        ...options,
        include: { ...options.include, auditTrail: false },
        exportClass: 'working-copy',
        outputPath: workingCopyPath
      },
      captureLifecycle
    )
    wcPkgDir = mkdtempSync(join(tmpdir(), 'bb-binwcpkg-'))
    unzipToDir(workingCopyPath, wcPkgDir)

    // The shared mixed-kind fixture Case (#1156, D14): a capture with its
    // thumbnail derived file, plus a committed attachment, image and document.
    mixed = await seedMixedKindCase({ tempDir, name: 'Binary Mixed Kind Case' })
    // A token over a committed Exhibit's Content Hash (X26), so the binary has
    // an exhibit timestamp to bind rather than only a capture's.
    const mixedCaseDir = join(tempDir, 'captures', mixed.caseId)
    const documentHash = createHash('sha256').update(mixed.document.bytes).digest('hex')
    appendManifestEntry(mixedCaseDir, {
      type: 'timestamp',
      caseId: mixed.caseId,
      captureContentHash: documentHash,
      timestamp: '2026-04-05T12:01:00.000Z',
      tsaToken: buildSyntheticToken({
        contentHash: documentHash,
        genTime: new Date('2026-04-05T12:01:00.000Z'),
        tsaDnsName: 'tsa.example.com'
      }).toString('base64'),
      operatorId: 'op',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })
    const mixedPath = join(tempDir, 'mixed-evidence.zip')
    await generateReport(mixed.caseId, { ...options, outputPath: mixedPath }, captureLifecycle)
    mixedPkgDir = mkdtempSync(join(tmpdir(), 'bb-binmixedpkg-'))
    unzipToDir(mixedPath, mixedPkgDir)
  })

  afterAll(() => {
    closeDatabase()
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
    if (pkgDir && existsSync(pkgDir)) rmSync(pkgDir, { recursive: true, force: true })
    if (selPkgDir && existsSync(selPkgDir)) rmSync(selPkgDir, { recursive: true, force: true })
    if (wcPkgDir && existsSync(wcPkgDir)) rmSync(wcPkgDir, { recursive: true, force: true })
    if (mixedPkgDir && existsSync(mixedPkgDir)) {
      rmSync(mixedPkgDir, { recursive: true, force: true })
    }
  })

  // #1156 through the BUILT binary: the bundled verify-core binds Exhibits of
  // every kind and the Derived Files computed from them, and names a failure by
  // the Exhibit Number the chain records.
  it('exits 0 with a PASS report on a mixed-kind package, naming every exhibit', () => {
    const proc = spawnSync(binaryPath, [mixedPkgDir], { encoding: 'utf-8' })
    expect(proc.status, proc.stdout + proc.stderr).toBe(0)
    expect(proc.stdout).toContain('RESULT: PASS')
    for (const exhibit of mixed.committed) {
      expect(proc.stdout).toContain(`[PASS] exhibit ${exhibit.id}`)
      expect(proc.stdout).toContain(`Exhibit ${exhibit.exhibitNumber} (${exhibit.kind})`)
    }
    expect(proc.stdout).toContain(`[PASS] derivation thumbnail of ${mixed.captureId}`)
    // X26 through the binary: a committed Exhibit's token is bound, not passed
    // over in silence while verify.sh requires it and the certification
    // asserts a trusted time off it.
    expect(proc.stdout).toContain(`[PASS] exhibit ${mixed.document.id} timestamp`)
    expect(proc.stdout).toContain('structural (imprint + bytes)')
    // The answer this replaced: one SKIP per exhibit entry deferring the work.
    expect(proc.stdout).not.toContain('803e')
  })

  // X48 through the BUILT binary: a number issued twice is stated as an
  // Integrity Exception, and the package still PASSes with exit 0.
  it('exits 0 stating an Integrity Exception for a number issued twice', async () => {
    const { id: caseId } = createCase({ name: 'Binary Repeated Number' })
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'captures', caseId))
    const lifecycle = createCaptureLifecycle({
      selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
    })
    const ingestPage = async (n: number): Promise<string> =>
      (
        await ingestMhtmlCapture({
          caseId,
          url: `https://example.com/repeated-${n}`,
          title: `Page ${n}`,
          timestamp: '2026-04-05T12:00:00.000Z',
          stream: Readable.from([
            Buffer.from(`<html><body>repeated ${n}</body></html>`)
          ]) as unknown as ReadableStream<Uint8Array>,
          textContent: 'text',
          headers: {},
          browserVersion: '',
          userAgent: '',
          httpStatus: 200,
          extensionVersion: '',
          operatorId: 'op',
          operatorName: 'Test Operator',
          toolVersion: '0.1.0'
        })
      ).capture.id
    await ingestPage(1)
    expect(await lifecycle.delete(await ingestPage(2))).toBe(true)
    // What the MAX + 1 read over live rows did before #1270: 2 again.
    const upload = join(tempDir, 'reissued.pdf')
    writeFileSync(upload, '%PDF-1.7 reissued')
    const [staged] = await uploadToStaging(caseId, [upload])
    const spy = vi.spyOn(numbering, 'nextExhibitNumber').mockReturnValueOnce(2)
    await commitStagedFiles(caseId, [staged.id])
    spy.mockRestore()

    const zipPath = join(tempDir, 'repeated-evidence.zip')
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
        outputPath: zipPath
      },
      lifecycle
    )
    const dir = mkdtempSync(join(tmpdir(), 'bb-binrepeated-'))
    try {
      unzipToDir(zipPath, dir)
      const proc = spawnSync(binaryPath, [dir], { encoding: 'utf-8' })
      expect(proc.status, proc.stdout + proc.stderr).toBe(0)
      expect(proc.stdout).toContain(
        '[EXCEPTION] exhibit number 2 — Integrity Exception: Exhibit Number 2 is assigned to 2 ' +
          'exhibits'
      )
      expect(proc.stdout).toContain(
        'RESULT: PASS — integrity + internal consistency verified, with 1 Integrity ' +
          'Exception(s) (see above).'
      )
      expect(proc.stdout).not.toContain('[FAIL]')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 1 naming the exhibit number when a committed exhibit is altered', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bb-binmixedtamper-'))
    try {
      cpSync(mixedPkgDir, dir, { recursive: true })
      writeFileSync(join(dir, mixed.document.packagePath), Buffer.from('%PDF-1.7 substituted'))

      const proc = spawnSync(binaryPath, [dir], { encoding: 'utf-8' })
      expect(proc.status, proc.stdout + proc.stderr).toBe(1)
      expect(proc.stdout).toContain('RESULT: FAIL')
      expect(proc.stdout).toContain(`Exhibit ${mixed.document.exhibitNumber}`)
      expect(proc.stdout).toContain('does not match the contentHash in its signed entry')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 1 naming the parent and derivation when a derived file is altered', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bb-binderivedtamper-'))
    try {
      cpSync(mixedPkgDir, dir, { recursive: true })
      writeFileSync(join(dir, mixed.thumbnailPackagePath), Buffer.from('not the thumbnail'))

      const proc = spawnSync(binaryPath, [dir], { encoding: 'utf-8' })
      expect(proc.status, proc.stdout + proc.stderr).toBe(1)
      expect(proc.stdout).toContain('RESULT: FAIL')
      expect(proc.stdout).toContain('derivation `thumbnail`')
      expect(proc.stdout).toContain('does not match the outputHash in its signed entry')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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

  // #399 AC 2 through the BUILT binary: a Working Copy is reported as not a
  // verifiable object — its own wording and its own exit code, never FAIL/1.
  it('exits 2 with a not-a-verifiable-object report on a Working Copy', () => {
    const proc = spawnSync(binaryPath, [wcPkgDir], { encoding: 'utf-8' })
    expect(proc.status, proc.stdout + proc.stderr).toBe(2)
    expect(proc.stdout).toContain('RESULT: NOT A VERIFIABLE OBJECT')
    expect(proc.stdout).not.toContain('RESULT: FAIL')
  })

  // #398 backward verification through the BUILT binary: the frozen pre-scope
  // package (no export-entry.json, legacy export entry in its chain) must keep
  // passing byte-for-byte unchanged.
  it('exits 0 with a PASS report on the frozen pre-scope fixture package', () => {
    const fixtureDir = resolve(__dirname, '..', 'shared', 'verify', 'fixtures', 'pre-scope-package')
    const proc = spawnSync(binaryPath, [fixtureDir], { encoding: 'utf-8' })
    expect(proc.status, proc.stdout + proc.stderr).toBe(0)
    expect(proc.stdout).toContain('RESULT: PASS')
    // #853: the leniency that PASS rests on is printed, not assumed.
    expect(proc.stdout).toContain('cannot tell which')
  })

  // #853 through the BUILT binary: the CLI and the in-app core are one
  // implementation (cli.ts calls verifyEvidencePackage), and this is the end of
  // that claim — a case-scoped package with its export entry deleted is a FAIL
  // here exactly as it is in tests/shared/verify/evidencePackage.test.ts.
  it('exits 1 when a case-scoped package has had its export entry stripped', () => {
    const strippedDir = mkdtempSync(join(tmpdir(), 'bb-binstrip-'))
    for (const [name, bytes] of readStoredZipEntries(join(tempDir, 'evidence.zip'))) {
      const out = join(strippedDir, name)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, bytes)
    }
    rmSync(join(strippedDir, 'export-entry.json'))

    const proc = spawnSync(binaryPath, [strippedDir], { encoding: 'utf-8' })
    expect(proc.status, proc.stdout + proc.stderr).toBe(1)
    expect(proc.stdout).toContain('RESULT: FAIL')
    expect(proc.stdout).toContain('export-entry.json missing from package')
    rmSync(strippedDir, { recursive: true, force: true })
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

  // X25 through the BUILT binary: an entry from a newer schema is a fourth
  // outcome with its own exit code, never the tamper verdict on the line below.
  // The future entry is appended to the fixture's chain the way a newer
  // Birdbrain would have written it — continuing the index, linking to the head,
  // hashed over its own body and signed by the case's key. Anything less is a
  // tamper verdict, which the case after this one pins.
  it('exits 3 with a verifier-too-old report on a package holding a newer entry type', () => {
    const futureDir = mkdtempSync(join(tmpdir(), 'bb-binfuture-'))
    for (const [name, bytes] of readStoredZipEntries(join(tempDir, 'evidence.zip'))) {
      const out = join(futureDir, name)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, bytes)
    }
    const manifestPath = join(futureDir, 'manifest.jsonl')
    const existing = readFileSync(manifestPath, 'utf-8')
    const lines = existing.trim().split('\n')
    const head = JSON.parse(lines[lines.length - 1]) as { index: number; entryHash: string }
    const body = {
      type: 'exhibit',
      caseId: 'from-a-later-build',
      schemaVersion: MANIFEST_SCHEMA_VERSION + 1,
      index: head.index + 1,
      prevHash: head.entryHash
    }
    const entryHash = createHash('sha256').update(canonicalStringify(body)).digest('hex')
    const future = JSON.stringify({ ...body, entryHash, signature: signEntryHash(entryHash) })
    writeFileSync(manifestPath, existing + future + '\n')

    const proc = spawnSync(binaryPath, [futureDir], { encoding: 'utf-8' })
    expect(proc.status, proc.stdout + proc.stderr).toBe(3)
    expect(proc.stdout).toContain('RESULT: VERIFIER TOO OLD')
    expect(proc.stdout).toContain('supports up to schema version')
    expect(proc.stdout).not.toContain('RESULT: FAIL')
    rmSync(futureDir, { recursive: true, force: true })
  })

  // Schema 4 through the BUILT binary (#1509): a package enclosing a Shared
  // Case is walked and every non-pass outcome is named in the report, so a
  // script reading the output can tell each from a broken chain.
  it('exits 1 naming each shared-case outcome', () => {
    const existing = readFileSync(join(pkgDir, 'manifest.jsonl'), 'utf-8')
    const lines = existing.trim().split('\n')
    const last = JSON.parse(lines[lines.length - 1]) as {
      index: number
      entryHash: string
      caseId: string
    }
    const { caseId } = last
    const ownerPem = readFileSync(join(pkgDir, 'signing-public-key.pem'), 'utf-8')
    const memberKey = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    const signAsMember = (entryHash: string): string =>
      createSign('sha256').update(entryHash).sign(memberKey.privateKey, 'base64')

    // Appends signed entries after `from`, the way appendManifestEntry links them.
    const chainOf = (
      bodies: Record<string, unknown>[],
      sign: (entryHash: string) => string,
      from?: { index: number; entryHash: string }
    ): string[] => {
      let head = from ?? { index: -1, entryHash: '' }
      return bodies.map((body) => {
        const full = { ...body, index: head.index + 1, prevHash: head.entryHash }
        const entryHash = createHash('sha256').update(canonicalStringify(full)).digest('hex')
        head = { index: full.index, entryHash }
        return JSON.stringify({ ...full, entryHash, signature: sign(entryHash) })
      })
    }
    const owner = { operatorId: 'inst-owner', operatorName: 'Test Operator', toolVersion: '0.1.0' }
    const member = { operatorId: 'inst-b', operatorName: 'Test Member', toolVersion: '0.1.0' }
    const add = (
      id: string,
      code: string,
      pem: string,
      role: 'owner' | 'member'
    ): Record<string, unknown> => ({
      type: 'member-add',
      caseId,
      memberInstallationId: id,
      memberPublicKeyPem: pem,
      memberCode: code,
      memberOperatorName: 'Test Operator',
      nodeId: `node-${id}`,
      role,
      timestamp: '2026-09-19T12:00:00.000Z',
      ...owner,
      schemaVersion: 4
    })
    const ownerAdd = add('inst-owner', 'CO', ownerPem, 'owner')
    const memberAdd = add('inst-b', 'B', memberKey.publicKey, 'member')
    const exhibit = (exhibitId: string): Record<string, unknown> => ({
      type: 'exhibit',
      exhibitId,
      caseId,
      kind: 'document',
      origin: 'manual-upload',
      name: 'statement.pdf',
      exhibitNumber: 900,
      path: `${caseId}/documents/${exhibitId}.pdf`,
      contentHash: 'a'.repeat(64),
      sizeBytes: 1,
      timestamp: '2026-09-19T12:02:00.000Z',
      ...member,
      schemaVersion: 3
    })
    const memberChain = (bodies: Record<string, unknown>[], sign = signAsMember): string =>
      chainOf(bodies, sign).join('\n') + '\n'

    const cases: Array<{
      outcome: string
      ownerEntries: Record<string, unknown>[]
      memberFile?: { id: string; jsonl: string }
    }> = [
      {
        outcome: 'merge-head-mismatch',
        ownerEntries: [
          ownerAdd,
          {
            type: 'merge',
            caseId,
            heads: [
              { installationId: 'inst-x', index: 0, entryHash: 'a'.repeat(64), entriesReceived: 1 }
            ],
            timestamp: '2026-09-19T12:01:00.000Z',
            ...owner,
            schemaVersion: 4
          }
        ]
      },
      {
        outcome: 'entry-after-revocation',
        ownerEntries: [
          ownerAdd,
          memberAdd,
          {
            type: 'member-revoke',
            caseId,
            memberInstallationId: 'inst-b',
            timestamp: '2026-09-19T12:03:00.000Z',
            ...owner,
            schemaVersion: 4
          }
        ],
        memberFile: { id: 'inst-b', jsonl: memberChain([exhibit('b-1')]) }
      },
      {
        outcome: 'unknown-member',
        ownerEntries: [ownerAdd],
        memberFile: { id: 'inst-b', jsonl: memberChain([exhibit('b-1')]) }
      },
      {
        outcome: 'chain-broken',
        ownerEntries: [ownerAdd, memberAdd],
        memberFile: { id: 'inst-b', jsonl: memberChain([exhibit('b-1')], signEntryHash) }
      },
      { outcome: 'member-chain-missing', ownerEntries: [ownerAdd, memberAdd] },
      {
        outcome: 'roster-invalid',
        ownerEntries: [ownerAdd, add('inst-c', 'C', memberKey.publicKey, 'owner')]
      },
      {
        // One Exhibit under one citation twice. Two Exhibits under one number
        // in one chain is X48's Integrity Exception and fails nothing.
        outcome: 'citation-collision',
        ownerEntries: [ownerAdd, memberAdd],
        memberFile: {
          id: 'inst-b',
          jsonl: memberChain([exhibit('b-1'), { ...exhibit('b-1'), contentHash: 'b'.repeat(64) }])
        }
      }
    ]

    for (const { outcome, ownerEntries, memberFile } of cases) {
      const sharedDir = mkdtempSync(join(tmpdir(), 'bb-binshared-'))
      try {
        cpSync(pkgDir, sharedDir, { recursive: true })
        writeFileSync(
          join(sharedDir, 'manifest.jsonl'),
          existing + chainOf(ownerEntries, signEntryHash, last).join('\n') + '\n'
        )
        if (memberFile) {
          writeFileSync(join(sharedDir, `manifest.${memberFile.id}.jsonl`), memberFile.jsonl)
        }
        const proc = spawnSync(binaryPath, [sharedDir], { encoding: 'utf-8' })
        expect(proc.status, outcome + proc.stdout + proc.stderr).toBe(1)
        expect(proc.stdout, outcome).toContain('RESULT: FAIL')
        expect(proc.stdout, outcome).toContain(`[FAIL] shared case — ${outcome}: `)
        expect(proc.stdout, outcome).not.toContain('VERIFIER TOO OLD')
      } finally {
        rmSync(sharedDir, { recursive: true, force: true })
      }
    }
  })

  // The laundering case, end to end: a tampered entry that also claims a newer
  // schema is a tamper verdict, not the exculpation exit 3 carries.
  it('exits 1 on a tampered manifest entry that also claims a newer schema', () => {
    const launderDir = mkdtempSync(join(tmpdir(), 'bb-binlaunder-'))
    for (const [name, bytes] of readStoredZipEntries(join(tempDir, 'evidence.zip'))) {
      const out = join(launderDir, name)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, bytes)
    }
    const manifestPath = join(launderDir, 'manifest.jsonl')
    const lines = readFileSync(manifestPath, 'utf-8').trim().split('\n')
    const entry = JSON.parse(lines[0]) as Record<string, unknown>
    entry.url = 'https://evil.example/page'
    entry.schemaVersion = 99
    lines[0] = JSON.stringify(entry)
    writeFileSync(manifestPath, lines.join('\n') + '\n')

    const proc = spawnSync(binaryPath, [launderDir], { encoding: 'utf-8' })
    expect(proc.status, proc.stdout + proc.stderr).toBe(1)
    expect(proc.stdout).toContain('RESULT: FAIL')
    expect(proc.stdout).toContain('Entry hash mismatch')
    expect(proc.stdout).not.toContain('VERIFIER TOO OLD')
    rmSync(launderDir, { recursive: true, force: true })
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
