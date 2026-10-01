import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
import { createHash, createSign, generateKeyPairSync } from 'crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { dirname, join, resolve } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { listCaptures } from '@main/services/db/captureRepo'
import { listExhibits } from '@main/services/db/exhibitRepo'
import { createNote } from '@main/services/db/noteRepo'
import { commitStagedFiles, uploadToStaging } from '@main/services/staging'
import { initStorage, ensureCaseDir, getStorageRoot } from '@main/services/storage'
import { appendManifestEntry, initManifest } from '@main/services/manifest'
import {
  createCaptureLifecycle,
  ingestMhtmlCapture,
  type CaptureLifecycle
} from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { generateReport } from '@main/services/export'
import { exportCaseArchive, importCaseArchive } from '@main/services/caseArchive'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import {
  getPublicKeyPem,
  initSigningKey,
  resetSigningKey,
  signEntryHash
} from '@main/services/signingKey'
import { readStoredZip } from '@main/services/zipRead'
import { canonicalStringify } from '@shared/verify'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import { DEMO_CASE_ARCHIVE_FILENAME, DEMO_CASE_OPERATOR_NAME } from '@shared/constants'
import { WORKING_COPY_MARKER_FILENAME } from '@shared/schemas'
import {
  PACKAGE_ROOT_FILES,
  capturePagePath,
  exhibitPackagePath,
  timestampTokenPath
} from '../../../src/packages/evidence-package-layout/index'
import { HAS_OPENSSL } from '../../helpers/openssl'
import { HAS_JQ } from '../../helpers/jq'
import { createLocalTsa, type LocalTsa } from '../../helpers/localTsa'
import { extractRunbookBlocks, runRunbookBlocks } from '../../helpers/runbookBlocks'
import { runVerifyScript } from '../../helpers/verifyScript'

// #1657: a Case that arrived through an import carries entries another
// installation signed, before its `import` entry. Its Evidence Package must
// pass the verify.sh it ships with and the package verifier, and its
// certification must say which key signed which entries. Both verifiers run
// for real here, on packages the real export path built from a real import.

const localRoot = vi.hoisted(() => ({ pem: '' }))

vi.mock('@main/services/tsaTrust', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tsaTrust')>()
  return {
    ...actual,
    getTsaTrustBundle: (tsaUrl: string) =>
      localRoot.pem === ''
        ? actual.getTsaTrustBundle(tsaUrl)
        : { pem: localRoot.pem, bundled: true }
  }
})

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

const RUNS = HAS_OPENSSL && HAS_JQ

const FIXTURE = resolve(__dirname, '../../../resources', DEMO_CASE_ARCHIVE_FILENAME)

/**
 * SHA-256 of the demo fixture's signing key, the key its three capture entries
 * were signed with. Frozen with the fixture: a regenerated fixture signed with
 * another key fails this test until the constant is updated with it.
 */
const DEMO_SIGNER_FINGERPRINT = '090c874007fcd7be652b70cec13d6fb3435f06c1f254829b7bd4b652fb220846'

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')

interface ChainLine {
  index: number
  type: string
  entryHash: string
  signature?: string
  sourcePublicKeyPem?: string
  [key: string]: unknown
}

const manifestPath = (dir: string): string => join(dir, PACKAGE_ROOT_FILES.manifest)

const chainLines = (dir: string): ChainLine[] =>
  readFileSync(manifestPath(dir), 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChainLine)

const writeChain = (dir: string, lines: ChainLine[]): void => {
  writeFileSync(manifestPath(dir), lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
}

const entriesLabel = (from: number, to: number, prefix = ''): string =>
  from === to ? `entry ${prefix}${from}` : `entries ${prefix}${from} to ${prefix}${to}`

/** report.html's signature step, with its line breaks folded to spaces. */
function signatureStep(dir: string): string {
  const report = readFileSync(join(dir, PACKAGE_ROOT_FILES.report), 'utf-8').replace(/\s+/g, ' ')
  const step = /<strong>Check the entry signatures\.<\/strong> (.*?)<\/li>/.exec(report)
  expect(step).not.toBeNull()
  return step![1]
}

// The step a chain with no `import` before its entries prints, as it did before #1657.
const NATIVE_SIGNATURE_STEP =
  'Verify each signed manifest entry against <code>signing-public-key.pem</code>. This binds ' +
  'the entries to the installation identified on the cover — not to any named person.'

// The step a chain that continues an import prints: the rule verify.sh step 2 applies.
const IMPORTED_SIGNATURE_STEP =
  'Verify each signed manifest entry against the key that signed it. This chain holds an ' +
  '<code>import</code> entry, so the key depends on where an entry sits: an entry verifies ' +
  'under the key in the <code>sourcePublicKeyPem</code> field of the first <code>import</code> ' +
  'entry after it, or under <code>signing-public-key.pem</code> when no <code>import</code> ' +
  'entry follows it. <code>VERIFY.md</code> step 2 gives the commands for one entry and ' +
  '<code>verify.sh</code> step 2 runs the same check over every signed entry. A key an ' +
  "<code>import</code> entry carries is only as trustworthy as that entry's signature, which " +
  'is checked under the next key along. This binds the entries from the last ' +
  '<code>import</code> entry on to the installation identified on the cover, and each earlier ' +
  'entry only to the key an <code>import</code> entry carries for it, never to any named person.'

describe('an Evidence Package exported from an imported Case (#1657)', () => {
  let tsa: LocalTsa | null = null
  let tempDir = ''
  let lifecycle: CaptureLifecycle

  beforeAll(() => {
    if (!RUNS) return
    tsa = createLocalTsa()
    localRoot.pem = tsa.rootPem
  })

  afterAll(() => {
    tsa?.dispose()
    localRoot.pem = ''
  })

  // One installation: its own key, id, database and Case store, the way two
  // machines hold them.
  async function useInstallation(name: string): Promise<void> {
    const dir = join(tempDir, name)
    mkdirSync(dir, { recursive: true })
    closeDatabase()
    await initDatabase(':memory:')
    initStorage(join(dir, 'captures'))
    resetSigningKey()
    initSigningKey(dir, { confirmUnprotectedKey: () => true })
    resetInstallationId()
    initInstallationId(dir)
    initSettings(dir)
    updateSettings({ operatorName: `Operator ${name}` })
  }

  beforeEach(async () => {
    if (!RUNS) return
    tempDir = mkdtempSync(join(tmpdir(), 'bb-imported-package-'))
    lifecycle = createCaptureLifecycle({
      selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
    })
    await useInstallation('local')
  })

  afterEach(() => {
    closeDatabase()
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  })

  async function exportPackage(
    caseId: string,
    name: string,
    {
      captureIds,
      notes = false,
      exportClass = 'evidence'
    }: { captureIds?: string[]; notes?: boolean; exportClass?: 'evidence' | 'working-copy' } = {}
  ): Promise<string> {
    const outputPath = join(tempDir, `${name}.zip`)
    await generateReport(
      caseId,
      {
        format: 'zip',
        include: {
          captures: true,
          screenshots: true,
          auditTrail: true,
          notes,
          annotations: 'none'
        },
        exportClass,
        outputPath,
        ...(captureIds ? { captureIds } : {})
      },
      lifecycle
    )
    const dir = join(tempDir, name)
    for (const [entry, bytes] of readStoredZip(readFileSync(outputPath))) {
      mkdirSync(dirname(join(dir, entry)), { recursive: true })
      writeFileSync(join(dir, entry), bytes)
    }
    return dir
  }

  // A Case on a SOURCE installation: one capture and a timestamp over it, both
  // signed by the source key, exported as a Case Archive and imported on the
  // local installation. The source Case is on the other machine, so nothing
  // collides and no id is remapped.
  async function importFromAnotherInstallation(): Promise<{
    caseId: string
    sourcePem: string
  }> {
    await useInstallation('source')
    const sourcePem = getPublicKeyPem()
    const source = createCase({ name: 'Imported', description: 'from another installation' })
    ensureCaseDir(source.id)
    const caseDir = join(getStorageRoot(), source.id)
    initManifest(caseDir)
    const payload = '<html><body>captured on the source installation</body></html>'
    const { capture } = await ingestMhtmlCapture({
      caseId: source.id,
      url: 'https://example.com/source',
      title: 'Source Page',
      timestamp: '2026-09-01T10:00:00.000Z',
      stream: Readable.from([Buffer.from(payload)]) as unknown as ReadableStream<Uint8Array>,
      textContent: payload,
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: 'Operator source',
      toolVersion: '0.1.0'
    })
    appendManifestEntry(caseDir, {
      type: 'timestamp',
      caseId: source.id,
      captureContentHash: capture.hash,
      timestamp: '2026-09-01T10:01:00.000Z',
      tsaToken: tsa!.issueToken(capture.hash).toString('base64'),
      operatorId: 'op',
      operatorName: 'Operator source',
      toolVersion: '0.1.0'
    })
    const archive = join(tempDir, 'source.birdbrain')
    await exportCaseArchive(source.id, archive)

    await useInstallation('local')
    expect(getPublicKeyPem()).not.toBe(sourcePem)
    const { newCaseId } = await importCaseArchive(archive)
    return { caseId: newCaseId, sourcePem }
  }

  // The same Case carried on to a third installation: exported again as a Case
  // Archive from where it was imported, and imported on `name`.
  async function importAgain(caseId: string, name: string): Promise<string> {
    const archive = join(tempDir, `${name}.birdbrain`)
    await exportCaseArchive(caseId, archive)
    await useInstallation(name)
    const { newCaseId } = await importCaseArchive(archive)
    return newCaseId
  }

  // A Case begun on the current installation: a capture with a screenshot and a
  // timestamp, a committed PDF, a note attached to the capture and one anchored
  // to it.
  async function nativeCase(name: string): Promise<{
    caseId: string
    captureId: string
    exhibitId: string
  }> {
    const created = createCase({ name, description: 'begun on this installation' })
    ensureCaseDir(created.id)
    const caseDir = join(getStorageRoot(), created.id)
    initManifest(caseDir)
    const payload = `<html><body>${name}</body></html>`
    const { capture } = await ingestMhtmlCapture({
      caseId: created.id,
      url: 'https://example.com/native',
      title: 'Native Page',
      timestamp: '2026-09-02T10:00:00.000Z',
      stream: Readable.from([Buffer.from(payload)]) as unknown as ReadableStream<Uint8Array>,
      textContent: payload,
      screenshot: Buffer.from(`screenshot of ${name}`),
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: 'Operator local',
      toolVersion: '0.1.0'
    })
    appendManifestEntry(caseDir, {
      type: 'timestamp',
      caseId: created.id,
      captureContentHash: capture.hash,
      timestamp: '2026-09-02T10:01:00.000Z',
      tsaToken: tsa!.issueToken(capture.hash).toString('base64'),
      operatorId: 'op',
      operatorName: 'Operator local',
      toolVersion: '0.1.0'
    })
    const pdf = join(tempDir, `${name}.pdf`)
    writeFileSync(pdf, `%PDF-1.7\n% ${name}\n%%EOF\n`)
    const [staged] = await uploadToStaging(created.id, [pdf])
    const {
      outcomes: [outcome]
    } = await commitStagedFiles(created.id, [staged.id])
    if (outcome.status !== 'committed') throw new Error(`commit ${outcome.status}`)
    createNote({ caseId: created.id, captureId: capture.id, title: 'Seen', body: 'On the page.' })
    createNote({
      caseId: created.id,
      title: 'Pinned',
      body: 'Anchored, not attached.',
      anchor: JSON.stringify({ kind: 'capture', captureId: capture.id })
    })
    return { caseId: created.id, captureId: capture.id, exhibitId: outcome.exhibitId }
  }

  // A native Case exported as a Case Archive and imported back onto the same
  // installation while the original is still there, so every id collides and
  // the import gives each row a new one. The inherited entries keep the ids
  // they were signed under: the `chain` ids below.
  async function remappedCase(): Promise<{
    caseId: string
    chainCaptureId: string
    rowCaptureId: string
    chainExhibitId: string
    rowExhibitId: string
  }> {
    const original = await nativeCase('Remapped')
    const archive = join(tempDir, 'remapped.birdbrain')
    await exportCaseArchive(original.caseId, archive)
    const { newCaseId } = await importCaseArchive(archive)
    const [capture] = listCaptures(newCaseId)
    const exhibit = listExhibits(newCaseId).find((row) => row.kind !== 'capture')!
    expect(capture.id).not.toBe(original.captureId)
    expect(exhibit.id).not.toBe(original.exhibitId)
    return {
      caseId: newCaseId,
      chainCaptureId: original.captureId,
      rowCaptureId: capture.id,
      chainExhibitId: original.exhibitId,
      rowExhibitId: exhibit.id
    }
  }

  // Every file of an unpacked package, by package path.
  function packageFiles(dir: string, prefix = ''): Map<string, Buffer> {
    const files = new Map<string, Buffer>()
    for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        for (const [nested, bytes] of packageFiles(dir, path)) files.set(nested, bytes)
      } else {
        files.set(path, readFileSync(join(dir, path)))
      }
    }
    return files
  }

  const exhibitEntryPath = (dir: string, exhibitId: string): string =>
    exhibitPackagePath(
      chainLines(dir).find((line) => line.type === 'exhibit' && line.exhibitId === exhibitId)!
        .path as string
    )

  function expectInAppPass(dir: string): void {
    const result = verifyEvidencePackage(dir)
    expect(
      result.checks.filter((c) => c.status === 'fail'),
      JSON.stringify(result.checks, null, 2)
    ).toEqual([])
    expect(result.pass).toBe(true)
  }

  /** The two runs of a once-imported chain, as verify.sh and the certification state them. */
  function expectKeyRuns(
    dir: string,
    output: string,
    { sourceFingerprint, localFingerprint }: { sourceFingerprint: string; localFingerprint: string }
  ): void {
    const lines = chainLines(dir)
    const at = lines.findIndex((line) => line.type === 'import')
    const last = lines.length - 1
    expect(at).toBeGreaterThan(0)
    expect(lines.filter((line) => line.type === 'import')).toHaveLength(1)

    expect(output).toContain(
      `${entriesLabel(0, at - 1)}: ${at} signed entr(ies) verified under the key import ` +
        `entry ${at} carries (SHA-256 ${sourceFingerprint})`
    )
    expect(output).toContain(
      `${entriesLabel(at, last)}: ${last - at + 1} signed entr(ies) verified under ` +
        `signing-public-key.pem (SHA-256 ${localFingerprint})`
    )

    const certification = readFileSync(join(dir, PACKAGE_ROOT_FILES.certification), 'utf-8')
    const field = (label: string, fingerprint: string): string =>
      `<div class="field-label">${label}</div>\n      <div class="field-value">` +
      `<span class="mono break">${fingerprint}</span>`
    expect(certification).toContain(
      field(
        `Signing key for ${entriesLabel(0, at - 1, '#')} (SHA-256 of the key import entry ` +
          `#${at} carries)`,
        sourceFingerprint
      )
    )
    expect(certification).toContain(
      field(
        `Signing key for ${entriesLabel(at, last, '#')} (SHA-256 of signing-public-key.pem)`,
        localFingerprint
      )
    )
    expect(certification).not.toContain('Signing key (SHA-256 of signing-public-key.pem)')
  }

  it.skipIf(!RUNS)('passes both shipped verifiers on a plain imported Case', async () => {
    const { caseId, sourcePem } = await importFromAnotherInstallation()
    const dir = await exportPackage(caseId, 'plain-import')

    expectInAppPass(dir)
    const run = runVerifyScript(dir)
    expect(run.status, run.output).toBe(0)
    expect(run.output).toContain('verify.sh: PASS')
    // The timestamp entry is one the source installation signed.
    expect(run.output).toContain('TSA signature verifies to tsa-root.pem')
    expectKeyRuns(dir, run.output, {
      sourceFingerprint: sha256(sourcePem),
      localFingerprint: sha256(getPublicKeyPem())
    })
  })

  it.skipIf(!RUNS)('names a key per installation on a Case imported twice', async () => {
    const { caseId, sourcePem } = await importFromAnotherInstallation()
    const middlePem = getPublicKeyPem()
    const dir = await exportPackage(await importAgain(caseId, 'final'), 'twice-imported')

    const lines = chainLines(dir)
    expect(lines.map((line) => line.type)).toEqual(['capture', 'timestamp', 'import', 'import'])
    expectInAppPass(dir)
    const run = runVerifyScript(dir)
    expect(run.status, run.output).toBe(0)

    // Each import's own entry is signed by the installation that imported,
    // so it sits in the run of the next key along, not its own.
    const certification = readFileSync(join(dir, PACKAGE_ROOT_FILES.certification), 'utf-8')
    const runs = [
      { from: 0, to: 1, carriedBy: 2, pem: sourcePem },
      { from: 2, to: 2, carriedBy: 3, pem: middlePem },
      { from: 3, to: 3, carriedBy: null, pem: getPublicKeyPem() }
    ]
    for (const { from, to, carriedBy, pem } of runs) {
      const key = (prefix: string): string =>
        carriedBy === null
          ? 'signing-public-key.pem'
          : `the key import entry ${prefix}${carriedBy} carries`
      expect(run.output).toContain(
        `${entriesLabel(from, to)}: ${to - from + 1} signed entr(ies) verified under ${key('')} ` +
          `(SHA-256 ${sha256(pem)})`
      )
      expect(certification).toContain(
        `Signing key for ${entriesLabel(from, to, '#')} (SHA-256 of ${key('#')})</div>\n` +
          `      <div class="field-value"><span class="mono break">${sha256(pem)}</span>`
      )
    }
  })

  it.skipIf(!RUNS)('passes both shipped verifiers on the demo Case', async () => {
    const header = JSON.parse(readStoredZip(readFileSync(FIXTURE)).get('package.json')!.toString())
    expect(sha256(header.signingPublicKeyPem)).toBe(DEMO_SIGNER_FINGERPRINT)

    const { newCaseId } = await importCaseArchive(FIXTURE, {
      operatorName: DEMO_CASE_OPERATOR_NAME
    })
    const dir = await exportPackage(newCaseId, 'demo')

    // Known answer: the fixture's three captures, then the import naming its key.
    const lines = chainLines(dir)
    expect(lines.map((line) => line.type)).toEqual(['capture', 'capture', 'capture', 'import'])
    expect(sha256(lines[3].sourcePublicKeyPem!)).toBe(DEMO_SIGNER_FINGERPRINT)

    expectInAppPass(dir)
    const run = runVerifyScript(dir)
    expect(run.status, run.output).toBe(0)
    expect(run.output).toContain('verify.sh: PASS')
    expect(run.output).toContain(
      `entries 0 to 2: 3 signed entr(ies) verified under the key import entry 3 carries ` +
        `(SHA-256 ${DEMO_SIGNER_FINGERPRINT})`
    )
    expectKeyRuns(dir, run.output, {
      sourceFingerprint: DEMO_SIGNER_FINGERPRINT,
      localFingerprint: sha256(getPublicKeyPem())
    })
    // The report's signature step states the rule step 2 just applied.
    expect(signatureStep(dir)).toBe(IMPORTED_SIGNATURE_STEP)
  })

  it.skipIf(!RUNS)("verifies an imported entry with VERIFY.md's step 2 recipe", async () => {
    const { newCaseId } = await importCaseArchive(FIXTURE, {
      operatorName: DEMO_CASE_OPERATOR_NAME
    })
    const dir = await exportPackage(newCaseId, 'demo-by-hand')

    // Step 2 as the package's own VERIFY.md writes it, on its first line: an
    // entry the fixture's key signed. Step 3 runs after it on the same line.
    const runbook = readFileSync(join(dir, PACKAGE_ROOT_FILES.verifyRunbook), 'utf-8')
    const blocks = extractRunbookBlocks(runbook).filter((b) => /^Step [23] /.test(b.section))
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    const run = runRunbookBlocks(blocks, { cwd: dir })
    expect(run.ok, `${run.failedBlock}\n${run.stdout}\n${run.stderr}`).toBe(true)
    expect(run.stdout).toContain(`${DEMO_SIGNER_FINGERPRINT}  entry-key.pem`)
    expect(run.stdout).toContain('Verified OK')
  })

  it.skipIf(!RUNS)('fails an entry before the import signed by the enclosed key', async () => {
    const { caseId } = await importFromAnotherInstallation()
    const dir = await exportPackage(caseId, 'resigned-by-importer')
    const damaged = join(tempDir, 'resigned-copy')
    cpSync(dir, damaged, { recursive: true })

    // The importing installation's own signature over a source entry: valid
    // under signing-public-key.pem, and still not the key that entry is under.
    const lines = chainLines(damaged)
    const at = lines.findIndex((line) => line.type === 'import')
    lines[0] = { ...lines[0], signature: signEntryHash(lines[0].entryHash) }
    writeChain(damaged, lines)

    const run = runVerifyScript(damaged)
    expect(run.status, run.output).toBe(1)
    expect(run.output).toContain(
      `FAIL [step 2] entry 0: signature does not verify under the key import entry ${at} carries`
    )
    expect(verifyEvidencePackage(damaged).pass).toBe(false)
  })

  it.skipIf(!RUNS)('fails the import entry when the key it carries is swapped', async () => {
    const { caseId } = await importFromAnotherInstallation()
    const dir = await exportPackage(caseId, 'swapped-key')
    const damaged = join(tempDir, 'swapped-copy')
    cpSync(dir, damaged, { recursive: true })

    // Everything before the import re-signed with a key of the attacker's own,
    // and the import rewritten to carry it, its hash recomputed so step 3 is
    // satisfied. Only the importing installation can re-sign that entry.
    const attacker = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    const lines = chainLines(damaged)
    const at = lines.findIndex((line) => line.type === 'import')
    for (let i = 0; i < at; i++) {
      lines[i] = {
        ...lines[i],
        signature: createSign('sha256')
          .update(lines[i].entryHash)
          .sign(attacker.privateKey, 'base64')
      }
    }
    const { signature } = lines[at]
    const body: Record<string, unknown> = { ...lines[at], sourcePublicKeyPem: attacker.publicKey }
    delete body.entryHash
    delete body.signature
    lines[at] = { ...body, entryHash: sha256(canonicalStringify(body)), signature } as ChainLine
    writeChain(damaged, lines)

    const run = runVerifyScript(damaged)
    expect(run.status, run.output).toBe(1)
    expect(run.output).not.toContain('FAIL [step 2] entry 0:')
    expect(run.output).not.toContain('FAIL [step 3]')
    expect(run.output).toContain(
      `FAIL [step 2] entry ${at}: signature does not verify under signing-public-key.pem`
    )
    expect(verifyEvidencePackage(damaged).pass).toBe(false)
  })

  it.skipIf(!RUNS)('names the files of a native Case by its own ids', async () => {
    const native = await nativeCase('Native')
    const dir = await exportPackage(native.caseId, 'native', { notes: true })

    expectInAppPass(dir)
    const run = runVerifyScript(dir)
    expect(run.status, run.output).toBe(0)
    expect(run.output).toContain('verify.sh: PASS')

    // Known answer: the chain's ids are the rows' ids, and every name follows them.
    const files = packageFiles(dir)
    expect(files.has(capturePagePath(native.captureId))).toBe(true)
    expect(files.has(timestampTokenPath(native.captureId))).toBe(true)
    expect(files.has(exhibitEntryPath(dir, native.exhibitId))).toBe(true)
    const evidence = JSON.parse(files.get(PACKAGE_ROOT_FILES.evidenceIndex)!.toString())
    expect(evidence.captures.map((row: { id: string }) => row.id)).toEqual([native.captureId])
    expect(evidence.exhibits.map((row: { id: string }) => row.id).sort()).toEqual(
      [native.captureId, native.exhibitId].sort()
    )
    const notesMd = files.get(PACKAGE_ROOT_FILES.notes)!.toString()
    expect(notesMd).toContain(`- Attached to capture: ${native.captureId}`)
    expect(notesMd).toContain(`- Anchored to capture: ${native.captureId}`)
    // No `import` entry, so the signature step reads as it always has.
    expect(signatureStep(dir)).toBe(NATIVE_SIGNATURE_STEP)
  })

  it.skipIf(!RUNS)('passes both shipped verifiers on a Case an import renamed', async () => {
    const remapped = await remappedCase()
    const dir = await exportPackage(remapped.caseId, 'remapped', { notes: true })

    expectInAppPass(dir)
    const run = runVerifyScript(dir)
    expect(run.status, run.output).toBe(0)
    expect(run.output).toContain('verify.sh: PASS')

    // Known answer: every file and index row is named by the id the chain signed.
    const files = packageFiles(dir)
    expect(files.has(capturePagePath(remapped.chainCaptureId))).toBe(true)
    expect(files.has(timestampTokenPath(remapped.chainCaptureId))).toBe(true)
    expect(exhibitEntryPath(dir, remapped.chainExhibitId)).toContain(remapped.chainExhibitId)
    expect(files.has(exhibitEntryPath(dir, remapped.chainExhibitId))).toBe(true)
    const evidence = JSON.parse(files.get(PACKAGE_ROOT_FILES.evidenceIndex)!.toString())
    expect(evidence.captures.map((row: { id: string }) => row.id)).toEqual([
      remapped.chainCaptureId
    ])
    expect(evidence.exhibits.map((row: { id: string }) => row.id).sort()).toEqual(
      [remapped.chainCaptureId, remapped.chainExhibitId].sort()
    )
    expect(evidence.warnings.unreconciledChainCaptureIds).toEqual([])
    const notesMd = files.get(PACKAGE_ROOT_FILES.notes)!.toString()
    expect(notesMd).toContain(`- Attached to capture: ${remapped.chainCaptureId}`)
    expect(notesMd).toContain(`- Anchored to capture: ${remapped.chainCaptureId}`)
    expect(files.get(PACKAGE_ROOT_FILES.report)!.toString()).toContain(remapped.chainCaptureId)
    expect(signatureStep(dir)).toBe(IMPORTED_SIGNATURE_STEP)

    // The ids the import gave the rows are named by no file in the package.
    for (const [path, bytes] of files) {
      const text = bytes.toString('latin1')
      expect(text.includes(remapped.rowCaptureId), path).toBe(false)
      expect(text.includes(remapped.rowExhibitId), path).toBe(false)
    }
  })

  it.skipIf(!RUNS)('passes both shipped verifiers on a selection from a renamed Case', async () => {
    const remapped = await remappedCase()
    const dir = await exportPackage(remapped.caseId, 'remapped-selection', {
      captureIds: [remapped.rowCaptureId]
    })

    expectInAppPass(dir)
    const run = runVerifyScript(dir)
    expect(run.status, run.output).toBe(0)
    expect(run.output).toContain('verify.sh: PASS')

    // The signed selection names the capture as the chain does, and the PDF
    // it leaves out is expected absent under the chain's id too.
    const entry = JSON.parse(readFileSync(join(dir, PACKAGE_ROOT_FILES.exportEntry), 'utf-8'))
    expect(entry.scope).toBe('selection')
    expect(entry.captureIds).toEqual([remapped.chainCaptureId])
    expect(existsSync(join(dir, exhibitEntryPath(dir, remapped.chainExhibitId)))).toBe(false)
  })

  it.skipIf(!RUNS)(
    'names the Exhibits of a renamed Case in a Working Copy as its package does',
    async () => {
      const remapped = await remappedCase()
      const dir = await exportPackage(remapped.caseId, 'remapped-working-copy', {
        notes: true,
        exportClass: 'working-copy'
      })

      const files = packageFiles(dir)
      const marker = JSON.parse(files.get(WORKING_COPY_MARKER_FILENAME)!.toString())
      expect(marker.captures.map((row: { id: string }) => row.id)).toEqual([
        remapped.chainCaptureId
      ])
      expect(marker.captures[0].pagePath).toBe(capturePagePath(remapped.chainCaptureId))
      expect(files.has(capturePagePath(remapped.chainCaptureId))).toBe(true)
      expect(marker.exhibits.map((row: { id: string }) => row.id)).toEqual([
        remapped.chainExhibitId
      ])
      expect(files.has(marker.exhibits[0].path)).toBe(true)
      for (const [path, bytes] of files) {
        const text = bytes.toString('latin1')
        expect(text.includes(remapped.rowCaptureId), path).toBe(false)
        expect(text.includes(remapped.rowExhibitId), path).toBe(false)
      }
    }
  )
})
