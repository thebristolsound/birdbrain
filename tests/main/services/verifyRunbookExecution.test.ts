import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import sharp from 'sharp'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { appendManifestEntry, initManifest } from '@main/services/manifest'
import {
  createCaptureLifecycle,
  ingestMhtmlCapture,
  type CaptureLifecycle
} from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { generateReport } from '@main/services/export'
import { commitStagedFiles, uploadToStaging } from '@main/services/staging'
import { backfillCase } from '@main/services/exhibitBackfill'
import { listExhibits } from '@main/services/db/exhibitRepo'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { VERIFY_RUNBOOK } from '@main/services/verifyRunbook'
import { VERIFY_SCRIPT_FILENAME } from '@main/services/verifyScript'
import { HAS_OPENSSL } from '../../helpers/openssl'
import { HAS_JQ, jqIsRequired } from '../../helpers/jq'
import { createLocalTsa, type LocalTsa } from '../../helpers/localTsa'
import { extractRunbookBlocks, runRunbookBlocks } from '../../helpers/runbookBlocks'

// #584: the shipped VERIFY.md is executed against a real evidence package, and
// the verify.sh that ships beside it is run on that package and on deliberately
// corrupted copies of it.
//
// Runbook text nobody executes drifts from the packages it describes. #578 (a
// step-6 openssl invocation that could not work as written) and #579 (a CA chain
// file that broke the documented verify) were both found by a human reading the
// document against a package by hand, which is not a repeatable process. This
// file makes that drift a build failure: the blocks come from the GENERATOR, so
// editing runbook prose cannot cause a false pass, and step 6's placeholders are
// bound from the package rather than from today's command text.
//
// The trust anchor is the one substitution. getTsaTrustBundle is mocked to
// bundle the throwaway root from helpers/localTsa, so the package encloses the
// root its own tokens actually chain to — the shape a non-DigiCert deployment
// already produces. Everything else (the chain, signatures, hashes, the artifact
// index, packageHash, the certificates lifted out of the token) is the real
// export path's output.

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

const RUNS = HAS_OPENSSL && HAS_JQ

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

/** Stored (uncompressed) ZIP local-file entries — the reader the export tests use. */
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

function unpack(entries: Map<string, Buffer>, dir: string): void {
  for (const [name, data] of entries) {
    const target = join(dir, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, data)
  }
}

interface ManifestLine {
  type: string
  captureContentHash?: string
  tsaToken?: string
}

const manifestLines = (dir: string): ManifestLine[] =>
  readFileSync(join(dir, 'manifest.jsonl'), 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ManifestLine)

/**
 * Binds the runbook's angle-bracket placeholders from the package itself: one
 * binding per enclosed token, pairing the digest its SIGNED entry attests with
 * the `timestamps/<token>.tst` file carrying those exact bytes. Nothing here
 * reads a command out of the runbook, so a rewritten step 6 binds the same way
 * today's does.
 */
function bindingsFor(dir: string, entries: Map<string, Buffer>): Array<Record<string, string>> {
  const tokenPaths = [...entries.keys()].filter((name) => name.startsWith('timestamps/'))
  const bindings: Array<Record<string, string>> = []
  for (const entry of manifestLines(dir)) {
    if (entry.type !== 'timestamp' || typeof entry.tsaToken !== 'string') continue
    const signedBytes = Buffer.from(entry.tsaToken, 'base64')
    const path = tokenPaths.find((p) => entries.get(p)!.equals(signedBytes))
    if (path === undefined || entry.captureContentHash === undefined) continue
    const token = path.replace(/^timestamps\//, '').replace(/\.tst$/, '')
    if (bindings.some((b) => b['<token>'] === token)) continue
    bindings.push({ '<contentHash>': entry.captureContentHash, '<token>': token })
  }
  return bindings
}

interface VerifyRun {
  status: number
  output: string
}

function runVerifyScript(dir: string, env?: NodeJS.ProcessEnv): VerifyRun {
  try {
    const stdout = execFileSync('/bin/sh', [VERIFY_SCRIPT_FILENAME], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env ?? process.env
    })
    return { status: 0, output: stdout }
  } catch (error) {
    const spawned = error as { status?: number; stdout?: string; stderr?: string }
    return { status: spawned.status ?? 1, output: `${spawned.stdout ?? ''}${spawned.stderr ?? ''}` }
  }
}

describe('the shipped runbook and verify.sh, executed against a real evidence package', () => {
  let tsa: LocalTsa | null = null
  let tempDir = ''
  let packageDir = ''
  let entries = new Map<string, Buffer>()
  let captureId = ''
  let contentHash = ''
  let captureLifecycle: CaptureLifecycle
  let caseId = ''
  let exhibitId = ''
  let exhibitNumber = 0

  beforeAll(() => {
    if (!RUNS) return
    tsa = createLocalTsa()
    localRoot.pem = tsa.rootPem
  })

  afterAll(() => {
    tsa?.dispose()
    localRoot.pem = ''
  })

  beforeEach(async () => {
    if (!RUNS) return
    tempDir = mkdtempSync(join(tmpdir(), 'bb-runbook-exec-'))
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

    const testCase = createCase({ name: 'Runbook Execution', description: 'VERIFY.md under test' })
    ensureCaseDir(testCase.id)
    const caseDir = join(tempDir, 'captures', testCase.id)
    initManifest(caseDir)
    captureLifecycle = createCaptureLifecycle({
      selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
    })

    const payload = '<html><body>Runbook execution evidence</body></html>'
    const { capture } = await ingestMhtmlCapture({
      caseId: testCase.id,
      url: 'https://example.com/evidence',
      title: 'Evidence Page',
      timestamp: '2026-04-05T12:00:00.000Z',
      stream: Readable.from([Buffer.from(payload)]) as unknown as ReadableStream<Uint8Array>,
      textContent: payload,
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0',
      // A real PNG, because the thumbnail backfill below renders one from it:
      // the derived file it anchors is what makes step 5's derived-file block
      // and verify.sh's derived-file loop run over something rather than over
      // an empty set.
      screenshot: await sharp({
        create: { width: 24, height: 24, channels: 4, background: { r: 3, g: 3, b: 3, alpha: 1 } }
      })
        .png()
        .toBuffer()
    })
    captureId = capture.id
    contentHash = capture.hash
    caseId = testCase.id

    // A committed attachment, so the package this runbook is executed against
    // holds an exhibit of another kind and its own `exhibit` entry (#1156).
    const uploads = join(tempDir, 'uploads')
    mkdirSync(uploads)
    const attachment = join(uploads, 'bundle.zip')
    writeFileSync(attachment, Buffer.from('PK\u0003\u0004 runbook attachment payload'))
    const [staged] = await uploadToStaging(testCase.id, [attachment])
    await commitStagedFiles(testCase.id, [staged.id])
    const committed = listExhibits(testCase.id).find((e) => e.kind !== 'capture')!
    exhibitId = committed.id
    exhibitNumber = committed.exhibitNumber

    // Anchors the capture's thumbnail as a Derived File (X34) and writes the
    // Case's `renumber` entry, which is where a Capture's Exhibit Number lives
    // in the chain.
    await backfillCase(testCase.id, { toolVersion: '0.1.0' })

    // A token genuinely issued over THIS capture's content hash, so step 6's
    // `-digest <contentHash>` is fed the digest the signed entry binds. The
    // committed DigiCert fixture stamps a hash no capture can reproduce, which
    // is why it cannot stand in here (see helpers/localTsa.ts).
    appendManifestEntry(caseDir, {
      type: 'timestamp',
      caseId: testCase.id,
      captureContentHash: capture.hash,
      timestamp: '2026-04-05T12:01:00.000Z',
      tsaToken: tsa!.issueToken(capture.hash).toString('base64'),
      operatorId: 'op',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })

    const outputPath = join(tempDir, 'evidence.zip')
    await generateReport(
      testCase.id,
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

    entries = readStoredZipEntries(outputPath)
    packageDir = join(tempDir, 'unpacked')
    mkdirSync(packageDir)
    unpack(entries, packageDir)
  })

  afterEach(() => {
    closeDatabase()
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  })

  /** A copy of the good package, for a test that needs to damage one. */
  const corruptedCopy = (name: string): string => {
    const dir = join(tempDir, name)
    cpSync(packageDir, dir, { recursive: true })
    return dir
  }

  /**
   * Re-exports the case through the real export path with the given options
   * and unpacks the result under `name`, for a test that needs a package
   * shaped differently from the one `beforeEach` already built (a deletion
   * or a selection scope applied after the timestamp entry above).
   */
  const exportPackage = async (
    name: string,
    options: { captureIds?: string[] } = {}
  ): Promise<string> => {
    const outputPath = join(tempDir, `${name}.zip`)
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
        outputPath,
        ...options
      },
      captureLifecycle
    )
    const dir = join(tempDir, name)
    unpack(readStoredZipEntries(outputPath), dir)
    return dir
  }

  /**
   * Removes rows from the unsigned index, the way anyone deleting a file from a
   * package would: leave them and step 1 reports the missing file, which is the
   * easy case. What step 6 has to catch is the tidy version of the same edit.
   */
  const dropArtifacts = (dir: string, match: (path: string) => boolean): void => {
    const path = join(dir, 'evidence.json')
    const evidence = JSON.parse(readFileSync(path, 'utf-8')) as {
      artifacts: Array<{ path: string }>
    }
    evidence.artifacts = evidence.artifacts.filter((a) => !match(a.path))
    writeFileSync(path, JSON.stringify(evidence, null, 2))
  }

  it.skipIf(!RUNS)('executes every shell block of the generated runbook', () => {
    const blocks = extractRunbookBlocks(VERIFY_RUNBOOK)
    // A runbook that stopped carrying executable steps would otherwise pass by
    // having nothing to run, which is the failure this file exists to close.
    expect(blocks.length).toBeGreaterThanOrEqual(8)

    const result = runRunbookBlocks(blocks, {
      cwd: packageDir,
      bindings: bindingsFor(packageDir, entries)
    })

    expect(
      result.ok,
      `${result.failedBlock ?? 'a block'} failed:\n${result.stdout}\n${result.stderr}`
    ).toBe(true)
    expect(result.executed.length).toBeGreaterThanOrEqual(blocks.length)
    // The canonical TSA proof is the one step a binary PASS never covers, so
    // assert it ran rather than trusting the aggregate exit code.
    expect(result.stdout).toContain('Verification: OK')
  })

  it.skipIf(!RUNS)('ships verify.sh and passes it on a good package', () => {
    expect(entries.has(VERIFY_SCRIPT_FILENAME)).toBe(true)

    const run = runVerifyScript(packageDir)
    expect(run.status, run.output).toBe(0)
    expect(run.output).toContain('verify.sh: PASS')
    for (const step of [1, 2, 3, 4, 5, 6]) {
      expect(run.output).toContain(`== Step ${step} -`)
    }
    expect(run.output).toContain('TSA signature verifies to tsa-root.pem')
  })

  it.skipIf(!RUNS)('records verify.sh in the package index, and re-hashes it', () => {
    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      artifacts: Array<{ path: string; sha256: string; sizeBytes: number }>
    }
    const artifact = evidence.artifacts.find((a) => a.path === VERIFY_SCRIPT_FILENAME)
    expect(artifact).toBeDefined()
    expect(artifact!.sha256).toBe(sha256(entries.get(VERIFY_SCRIPT_FILENAME)!))

    // Self-describing means self-checking: step 1 re-hashes the script along
    // with everything else, so an edited verify.sh fails the package it claims
    // to verify instead of quietly reporting on its own terms.
    const dir = corruptedCopy('edited-script')
    const script = readFileSync(join(dir, VERIFY_SCRIPT_FILENAME), 'utf-8')
    writeFileSync(join(dir, VERIFY_SCRIPT_FILENAME), `${script}\n# edited after packaging\n`)
    const run = runVerifyScript(dir)
    expect(run.status).toBe(1)
    expect(run.output).toContain('FAIL [step 1]')
  })

  it.skipIf(!RUNS)('fails on a substituted page, naming the content-bind step', () => {
    const dir = corruptedCopy('corrupt-page')
    writeFileSync(join(dir, 'pages', `${captureId}.mhtml`), '<html>substituted</html>')

    const run = runVerifyScript(dir)
    expect(run.status).toBe(1)
    expect(run.output).toContain('FAIL [step 5]')
    expect(run.output).toContain('does not match the contentHash in its signed entry')
    expect(run.output).toContain('verify.sh: FAIL')
  })

  it.skipIf(!RUNS)('binds the committed exhibit and the capture thumbnail', () => {
    // #1156: verify.sh walks the same set the binary does — every kind of
    // exhibit, plus the derived files computed from them — so a PASS covers
    // what the package holds rather than its captures alone.
    const run = runVerifyScript(packageDir)
    expect(run.status, run.output).toBe(0)
    expect(run.output).toContain('1 exhibit(s) of other kinds bound to the signed chain')
    expect(run.output).toContain('1 derived file(s) bound to the signed chain')
  })

  it.skipIf(!RUNS)('fails on a substituted exhibit, naming it by its exhibit number', () => {
    const dir = corruptedCopy('corrupt-exhibit')
    writeFileSync(join(dir, 'attachments', `${exhibitId}.zip`), 'substituted attachment')

    const run = runVerifyScript(dir)
    expect(run.status).toBe(1)
    expect(run.output).toContain('FAIL [step 5]')
    expect(run.output).toContain(`Exhibit ${exhibitNumber}:`)
    expect(run.output).toContain('does not match the contentHash in its signed entry')
  })

  it.skipIf(!RUNS)('fails on a substituted derived file, naming its parent and derivation', () => {
    const dir = corruptedCopy('corrupt-derived')
    writeFileSync(join(dir, 'pages', `${captureId}_thumb.jpg`), 'substituted thumbnail')

    const run = runVerifyScript(dir)
    expect(run.status).toBe(1)
    expect(run.output).toContain('FAIL [step 5]')
    // AC 2's wording, the same in both shipped verifiers: a Derived File has no
    // number of its own (X31), so it is cited by its parent's and its
    // derivation. The parent Capture's number comes off the `renumber` entry.
    expect(run.output).toContain('Exhibit 1, derivation thumbnail')
    expect(run.output).toContain('does not match the outputHash in its signed entry')
  })

  it.skipIf(!RUNS)('fails on an edited entry body, naming the recompute step', () => {
    const dir = corruptedCopy('corrupt-body')
    const lines = readFileSync(join(dir, 'manifest.jsonl'), 'utf-8').split('\n')
    const edited = JSON.parse(lines[0]) as Record<string, unknown>
    edited.url = 'https://substituted.example/page'
    lines[0] = JSON.stringify(edited)
    writeFileSync(join(dir, 'manifest.jsonl'), lines.join('\n'))

    const run = runVerifyScript(dir)
    expect(run.status).toBe(1)
    expect(run.output).toContain('FAIL [step 3]')
    expect(run.output).toContain('does not hash to its own entryHash')
  })

  it.skipIf(!RUNS)('fails when the enclosed anchor is swapped, naming the TSA step', () => {
    // The attack step 6a warns about: anyone who can rewrite the package can
    // swap the convenience root. The token is untouched and still byte-bound to
    // its signed entry, so only `openssl ts -verify` catches this.
    const dir = corruptedCopy('swapped-anchor')
    const other = createLocalTsa()
    try {
      writeFileSync(join(dir, 'tsa-root.pem'), other.rootPem)
    } finally {
      other.dispose()
    }

    const run = runVerifyScript(dir)
    expect(run.status).toBe(1)
    expect(run.output).toContain('FAIL [step 6]')
    expect(run.output).toContain('does not verify to tsa-root.pem over the signed imprint')
  })

  it.skipIf(!RUNS)('fails on a token no signed entry accounts for', () => {
    const dir = corruptedCopy('unbound-token')
    const tokenPath = [...entries.keys()].find((name) => name.startsWith('timestamps/'))!
    const other = createLocalTsa()
    try {
      // Genuinely issued over the right imprint, by an authority the chain never
      // named. A digest match is not provenance.
      writeFileSync(join(dir, tokenPath), other.issueToken(contentHash))
    } finally {
      other.dispose()
    }

    const run = runVerifyScript(dir)
    expect(run.status).toBe(1)
    expect(run.output).toContain('FAIL [step 6]')
    expect(run.output).toContain('not the token of any signed timestamp entry')
  })

  it.skipIf(!RUNS)('fails when a token the signed manifest carries is not enclosed', () => {
    // The strip attack: delete the tokens AND their rows from the unsigned
    // index, so step 1 is silent. Nothing on disk then says a trusted time was
    // ever claimed — only the signed manifest does, which is why step 6 has to
    // take its work set from there rather than from `timestamps/`.
    const dir = corruptedCopy('stripped-tokens')
    rmSync(join(dir, 'timestamps'), { recursive: true, force: true })
    dropArtifacts(dir, (path) => path.startsWith('timestamps/'))

    const run = runVerifyScript(dir)
    expect(run.status, run.output).toBe(1)
    expect(run.output).toContain('FAIL [step 6]')
    expect(run.output).toContain('no enclosed file holds those bytes')
    expect(run.output).not.toContain('PASS')
  })

  it.skipIf(!RUNS)(
    'passes on a legitimate package exported after the timestamped capture was deleted',
    async () => {
      // Deletion never removes the capture's earlier manifest entries, so the
      // signed chain still carries a `timestamp` entry for this content hash —
      // but the deletion means no page, screenshot or token for it is ever
      // packaged again. Step 6's required work set has to know that, the same
      // way step 5 already does for the page and screenshot.
      await captureLifecycle.delete(captureId)
      const dir = await exportPackage('post-deletion')

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(0)
      expect(run.output).toContain('verify.sh: PASS')
      expect(run.output).toContain('expected absent')
      expect(run.output).not.toContain('FAIL')
      // The chain does carry a token, so the verdict must not claim it carries none.
      expect(run.output).toContain('only for captures this package does not enclose')
      expect(run.output).not.toContain('The signed chain carries no')
    }
  )

  it.skipIf(!RUNS)(
    'still requires a live capture token when a deleted capture shares its content hash',
    async () => {
      // Timestamp entries are keyed by content hash alone, so an exemption keyed
      // on the deleted duplicate's hash would also exempt the live capture.
      const payload = '<html><body>Runbook execution evidence</body></html>'
      const { capture: duplicate } = await ingestMhtmlCapture({
        caseId,
        url: 'https://example.com/evidence-again',
        title: 'Evidence Page Again',
        timestamp: '2026-04-05T12:03:00.000Z',
        stream: Readable.from([Buffer.from(payload)]) as unknown as ReadableStream<Uint8Array>,
        textContent: payload,
        headers: {},
        browserVersion: '',
        userAgent: '',
        httpStatus: 200,
        extensionVersion: '',
        operatorId: 'op',
        operatorName: 'Test Operator',
        toolVersion: '0.1.0'
      })
      expect(duplicate.hash).toBe(contentHash)
      await captureLifecycle.delete(duplicate.id)

      const dir = await exportPackage('shared-hash-stripped')
      rmSync(join(dir, 'timestamps'), { recursive: true, force: true })
      dropArtifacts(dir, (path) => path.startsWith('timestamps/'))

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      expect(run.output).toContain(`FAIL [step 6] capture ${captureId}`)
      expect(run.output).toContain('no enclosed file holds those bytes')
      expect(run.output).not.toContain('PASS')
    }
  )

  it.skipIf(!RUNS)(
    'passes on a selection-scoped export that excludes the timestamped capture',
    async () => {
      const payload = '<html><body>second, unselected capture</body></html>'
      const { capture: other } = await ingestMhtmlCapture({
        caseId,
        url: 'https://example.com/other',
        title: 'Other Page',
        timestamp: '2026-04-05T12:02:00.000Z',
        stream: Readable.from([Buffer.from(payload)]) as unknown as ReadableStream<Uint8Array>,
        textContent: payload,
        headers: {},
        browserVersion: '',
        userAgent: '',
        httpStatus: 200,
        extensionVersion: '',
        operatorId: 'op',
        operatorName: 'Test Operator',
        toolVersion: '0.1.0'
      })

      // Selects only the untimestamped capture, so the timestamped one's page,
      // screenshot AND signed token are all legitimately unenclosed.
      const dir = await exportPackage('selection-scoped', { captureIds: [other.id] })

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(0)
      expect(run.output).toContain('verify.sh: PASS')
      expect(run.output).toContain('outside the signed export selection')
      expect(run.output).not.toContain('FAIL')
    }
  )

  it.skipIf(!RUNS)('reports INCOMPLETE, not PASS, when no anchor is enclosed', () => {
    // What an operator on a non-default timestamp authority actually gets:
    // getTsaTrustBundle bundles no root, the tokens still ship, and no
    // verification against any anchor is possible. That is neither a pass nor a
    // failure of this package, and exit 0 would report it as the former.
    const dir = corruptedCopy('no-anchor')
    rmSync(join(dir, 'tsa-root.pem'), { force: true })
    dropArtifacts(dir, (path) => path === 'tsa-root.pem')

    const run = runVerifyScript(dir)
    expect(run.status, run.output).toBe(3)
    expect(run.output).toContain('INCOMPLETE [step 6]')
    expect(run.output).toContain('verify.sh: INCOMPLETE')
    expect(run.output).not.toContain('PASS')
    // The token is still bound to its signed entry; only the anchor is gone.
    expect(run.output).not.toContain('FAIL')
  })

  it.skipIf(!RUNS)('exits 2 rather than passing when a required tool is missing', () => {
    const empty = mkdtempSync(join(tmpdir(), 'bb-no-tools-'))
    try {
      const run = runVerifyScript(packageDir, { PATH: empty })
      expect(run.status).toBe(2)
      expect(run.output).toContain('was not found on PATH')
      expect(run.output).not.toContain('PASS')
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it.skipIf(!RUNS)('exits 2 when what surrounds it is not an evidence package', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bb-not-a-package-'))
    try {
      writeFileSync(
        join(dir, VERIFY_SCRIPT_FILENAME),
        readFileSync(join(packageDir, VERIFY_SCRIPT_FILENAME))
      )
      const run = runVerifyScript(dir)
      expect(run.status).toBe(2)
      expect(run.output).toContain('not an evidence package')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('runbook block extraction', () => {
  it('tags each block with the step it sits under and reports its placeholders', () => {
    const blocks = extractRunbookBlocks(VERIFY_RUNBOOK)
    expect(blocks.length).toBeGreaterThanOrEqual(8)
    expect(blocks.every((b) => b.section.length > 0)).toBe(true)
    expect(blocks.some((b) => b.placeholders.includes('<contentHash>'))).toBe(true)
    // The published-fingerprint block is fenced without a language: it is a
    // value to compare against, not a command, and must not be executed.
    expect(blocks.some((b) => b.code.includes('SHA-256 55:2F'))).toBe(false)
  })

  it('labels a block with its runbook heading, not with a shell comment inside it', () => {
    const blocks = extractRunbookBlocks(VERIFY_RUNBOOK)
    // Step 6's block carries `# subject and issuer must be identical ...`, which
    // a heading scan that ignores fence state reads as an H1 and hands to every
    // block after it — so a failure would be reported under the wrong step.
    expect(blocks.find((b) => b.code.includes('sha256sum -c -'))?.section).toMatch(/^Step 1/)
    expect(blocks.find((b) => b.code.includes('openssl ts -verify'))?.section).toMatch(/^Step 6/)
  })

  it('refuses a placeholder it cannot bind rather than skipping the block', () => {
    const runbook = ['## Step 9 — invented', '', '```sh', 'echo <somethingNew>', '```', ''].join(
      '\n'
    )
    const blocks = extractRunbookBlocks(runbook)
    expect(() =>
      runRunbookBlocks(blocks, { cwd: process.cwd(), bindings: [{ '<other>': 'x' }] })
    ).toThrow(/somethingNew/)
  })

  it('requires jq wherever CI is set, so the runbook can never be skipped there', () => {
    // The requirement lives here rather than in ci.yml because an agent branch
    // cannot land a workflow edit: the machine account's token has no `workflow`
    // scope. A guard in a file agents cannot touch would not be there when the
    // runner image stops shipping jq, which is the case it exists for.
    expect(jqIsRequired({ CI: 'true' })).toBe(true)
    expect(jqIsRequired({ BIRDBRAIN_REQUIRE_JQ: '1' })).toBe(true)
    expect(jqIsRequired({})).toBe(false)
    expect(jqIsRequired({ CI: 'true', BIRDBRAIN_REQUIRE_JQ: '0' })).toBe(false)
  })

  it('names the block that failed', () => {
    const runbook = ['## Step 1 — fine', '', '```sh', 'true', '```', ''].join('\n')
    const blocks = extractRunbookBlocks(runbook)
    blocks.push({ section: 'Step 2 — broken', ordinal: 2, code: 'false\n', placeholders: [] })
    const result = runRunbookBlocks(blocks, { cwd: process.cwd() })
    expect(result.ok).toBe(false)
    expect(result.failedBlock).toContain('Step 2 — broken')
  })
})
