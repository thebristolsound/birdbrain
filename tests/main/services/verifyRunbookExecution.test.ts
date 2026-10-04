import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
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
import { listDerivedFilesForCase } from '@main/services/db/derivedFileRepo'
import { seedUnanchoredDerivedFile } from '../../helpers/mixedKindCase'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { VERIFY_RUNBOOK } from '@main/services/verifyRunbook'
import { PACKAGE_ROOT_FILES } from '../../../src/packages/evidence-package-layout/index'
import { HAS_OPENSSL } from '../../helpers/openssl'
import { HAS_JQ, jqIsRequired } from '../../helpers/jq'
import { createLocalTsa, type LocalTsa } from '../../helpers/localTsa'
import { extractRunbookBlocks, runRunbookBlocks } from '../../helpers/runbookBlocks'
import { runVerifyScript } from '../../helpers/verifyScript'
import {
  checkConformance,
  verdictsAgree,
  type BinaryVerdict,
  type ScriptVerdict
} from '../../helpers/verifyConformance'

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

    // Anchors the capture's thumbnail as a Derived File (X34). No `renumber`
    // entry: the capture's Exhibit Number is on its own capture entry (X46).
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
    expect(entries.has(PACKAGE_ROOT_FILES.verifyScript)).toBe(true)

    const run = runVerifyScript(packageDir)
    expect(run.status, run.output).toBe(0)
    expect(run.output).toContain('verify.sh: PASS')
    for (const step of [1, 2, 3, 4, 5, 6]) {
      expect(run.output).toContain(`== Step ${step} -`)
    }
    expect(run.output).toContain('TSA signature verifies to tsa-root.pem')
    // A Case this installation signed throughout is one run under the enclosed
    // key (#1657), and its certification keeps the single key field.
    const last = manifestLines(packageDir).length - 1
    expect(run.output).toContain(
      `entries 0 to ${last}: ${last + 1} signed entr(ies) verified under signing-public-key.pem ` +
        `(SHA-256 ${sha256(entries.get(PACKAGE_ROOT_FILES.signingPublicKey)!)})`
    )
    expect(run.output).not.toContain('import entry')
    expect(entries.get(PACKAGE_ROOT_FILES.certification)!.toString('utf-8')).toContain(
      'Signing key (SHA-256 of signing-public-key.pem)'
    )
  })

  it.skipIf(!RUNS)('records verify.sh in the package index', () => {
    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      artifacts: Array<{ path: string; sha256: string; sizeBytes: number }>
    }
    const artifact = evidence.artifacts.find((a) => a.path === PACKAGE_ROOT_FILES.verifyScript)
    expect(artifact).toBeDefined()
    expect(artifact!.sha256).toBe(sha256(entries.get(PACKAGE_ROOT_FILES.verifyScript)!))
  })

  it.skipIf(!RUNS)('binds the committed exhibit and the capture thumbnail', () => {
    // #1156: verify.sh walks the same set the binary does — every kind of
    // exhibit, plus the derived files computed from them — so a PASS covers
    // what the package holds rather than its captures alone.
    const run = runVerifyScript(packageDir)
    expect(run.status, run.output).toBe(0)
    expect(run.output).toContain('1 exhibit(s) of other kinds bound to the signed chain')
    expect(run.output).toContain('1 derived file(s) bound to the signed chain')
    // The thumbnail's entry records what determined its bytes (#1319), so the
    // PASS above recomputed that entry's hash over the nested parameter map.
    const derivation = manifestLines(packageDir).find((line) => line.type === 'derivation')
    expect(derivation).toHaveProperty('derivationParameters.paddedRows')
  })

  // Both shipped verifiers on every package below, good and damaged. Each row
  // states what Package Verification (the binary's core) and verify.sh must
  // say, so a rule changed in one and not the other fails here. Where the two
  // differ by design, `divergence` says why, and the row fails if they stop
  // differing as well as if they start.
  interface ConformanceRow {
    name: string
    /** The package under test: a damaged copy of the good one, or a fresh export. */
    build: () => string | Promise<string>
    binary: BinaryVerdict
    script: ScriptVerdict
    /** Steps verify.sh names in its FAIL and INCOMPLETE lines. */
    steps: number[]
    /** Substrings verify.sh's output must contain, and must not. */
    says?: string[] | (() => string[])
    saysNot?: string[]
    /** A Package Verification check, by name prefix, that must fail with this reason. */
    binaryFails?: { name: string; reason: string }
    divergence?: string
  }

  const setEra = (dir: string, version: number): void => {
    const path = join(dir, 'evidence.json')
    const evidence = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    evidence.schemaVersion = version
    writeFileSync(path, JSON.stringify(evidence, null, 2))
  }

  /** A copy of the good package with its export entry removed. */
  const strippedEntryCopy = (name: string): string => {
    const dir = corruptedCopy(name)
    rmSync(join(dir, 'export-entry.json'))
    return dir
  }

  /** Writes `schemaVersion` as raw JSON text, for values JSON.stringify cannot produce. */
  const writeEraLiteral = (dir: string, literal: string): void => {
    const path = join(dir, 'evidence.json')
    const text = readFileSync(path, 'utf-8')
    writeFileSync(path, text.replace(/"schemaVersion": \d+/, `"schemaVersion": ${literal}`))
  }

  const ingestDuplicate = async (url: string, payload: string, timestamp: string) =>
    (
      await ingestMhtmlCapture({
        caseId,
        url,
        title: 'Another Page',
        timestamp,
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
    ).capture

  const CONFORMANCE: ConformanceRow[] = [
    {
      name: 'the good package',
      build: () => packageDir,
      binary: 'pass',
      script: 'pass',
      steps: [],
      says: ['verify.sh: PASS']
    },
    {
      // Self-describing means self-checking: step 1 re-hashes the script along
      // with everything else, so an edited verify.sh fails the package it claims
      // to verify instead of quietly reporting on its own terms.
      name: 'an edited verify.sh',
      build: () => {
        const dir = corruptedCopy('edited-script')
        const path = join(dir, PACKAGE_ROOT_FILES.verifyScript)
        writeFileSync(path, `${readFileSync(path, 'utf-8')}\n# edited after packaging\n`)
        return dir
      },
      binary: 'fail',
      script: 'fail',
      steps: [1]
    },
    {
      name: 'a substituted page',
      build: () => {
        const dir = corruptedCopy('corrupt-page')
        writeFileSync(join(dir, 'pages', `${captureId}.mhtml`), '<html>substituted</html>')
        return dir
      },
      binary: 'fail',
      script: 'fail',
      steps: [1, 5],
      says: ['does not match the contentHash in its signed entry', 'verify.sh: FAIL']
    },
    {
      name: 'a substituted exhibit',
      build: () => {
        const dir = corruptedCopy('corrupt-exhibit')
        writeFileSync(join(dir, 'attachments', `${exhibitId}.zip`), 'substituted attachment')
        return dir
      },
      binary: 'fail',
      script: 'fail',
      steps: [1, 5],
      says: () => [
        `Exhibit ${exhibitNumber}:`,
        'does not match the contentHash in its signed entry'
      ]
    },
    {
      // AC 2's wording, the same in both shipped verifiers: a Derived File has no
      // number of its own (X31), so it is cited by its parent's and its
      // derivation. The parent Capture's number comes off its capture entry.
      name: 'a substituted derived file',
      build: () => {
        const dir = corruptedCopy('corrupt-derived')
        writeFileSync(join(dir, 'pages', `${captureId}_thumb.jpg`), 'substituted thumbnail')
        return dir
      },
      binary: 'fail',
      script: 'fail',
      steps: [1, 5],
      says: ['Exhibit 1, derivation thumbnail', 'does not match the outputHash in its signed entry']
    },
    {
      // #1156 round 4: the states that reach a Derived File are anchored and
      // enclosed (the good package), anchored with its bytes gone, named by no
      // entry, and named over a chain that does not verify.
      name: 'a derived file whose bytes are gone',
      build: async () => {
        const thumbnail = listDerivedFilesForCase(caseId).find((f) => f.exhibitId === captureId)!
        rmSync(join(tempDir, 'captures', thumbnail.path))
        const dir = await exportPackage('lost-derived')
        // Not enclosed and not indexed, so the only finding is the chain-side one.
        const evidence = JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf-8')) as {
          exhibits: Array<{ id: string; derivedFiles: unknown[] }>
        }
        expect(evidence.exhibits.find((e) => e.id === captureId)!.derivedFiles).toEqual([])
        return dir
      },
      binary: 'fail',
      script: 'fail',
      steps: [5],
      says: [
        'Exhibit 1, derivation thumbnail',
        'is missing and nothing signed accounts for its absence'
      ],
      binaryFails: { name: 'derivation thumbnail', reason: 'is missing from the package' }
    },
    {
      // Held back, so neither verifier has anything to say about it. Before the
      // fix the binary FAILed this package and verify.sh PASSed it.
      name: 'a derived file no entry names',
      build: async () => {
        const attachment = listExhibits(caseId).find((e) => e.kind !== 'capture')!
        const unanchored = seedUnanchoredDerivedFile(tempDir, caseId, attachment.id)
        rmSync(join(tempDir, 'captures', unanchored.storedPath))
        return exportPackage('no-entry-derived')
      },
      binary: 'pass',
      script: 'pass',
      steps: []
    },
    {
      name: 'an edited entry body',
      build: () => {
        const dir = corruptedCopy('corrupt-body')
        const lines = readFileSync(join(dir, 'manifest.jsonl'), 'utf-8').split('\n')
        const edited = JSON.parse(lines[0]) as Record<string, unknown>
        edited.url = 'https://substituted.example/page'
        lines[0] = JSON.stringify(edited)
        writeFileSync(join(dir, 'manifest.jsonl'), lines.join('\n'))
        return dir
      },
      binary: 'fail',
      script: 'fail',
      steps: [1, 3],
      says: ['does not hash to its own entryHash']
    },
    {
      // The attack step 6a warns about: anyone who can rewrite the package can
      // swap the convenience root. The token is untouched and still byte-bound to
      // its signed entry, so only `openssl ts -verify` catches this.
      name: 'a swapped TSA anchor',
      build: () => {
        const dir = corruptedCopy('swapped-anchor')
        const other = createLocalTsa()
        try {
          writeFileSync(join(dir, 'tsa-root.pem'), other.rootPem)
        } finally {
          other.dispose()
        }
        return dir
      },
      binary: 'fail',
      script: 'fail',
      steps: [1, 6],
      says: ['does not verify to tsa-root.pem over the signed imprint']
    },
    {
      // Genuinely issued over the right imprint, by an authority the chain never
      // named. A digest match is not provenance.
      name: 'a token no signed entry accounts for',
      build: () => {
        const dir = corruptedCopy('unbound-token')
        const tokenPath = [...entries.keys()].find((name) => name.startsWith('timestamps/'))!
        const other = createLocalTsa()
        try {
          writeFileSync(join(dir, tokenPath), other.issueToken(contentHash))
        } finally {
          other.dispose()
        }
        return dir
      },
      binary: 'fail',
      script: 'fail',
      steps: [1, 6],
      says: ['not the token of any signed timestamp entry']
    },
    {
      // The strip attack: delete the tokens AND their rows from the unsigned
      // index, so step 1 is silent. Nothing on disk then says a trusted time was
      // ever claimed — only the signed manifest does, which is why step 6 has to
      // take its work set from there rather than from `timestamps/`.
      name: 'tokens the signed manifest carries, stripped',
      build: () => {
        const dir = corruptedCopy('stripped-tokens')
        rmSync(join(dir, 'timestamps'), { recursive: true, force: true })
        dropArtifacts(dir, (path) => path.startsWith('timestamps/'))
        return dir
      },
      binary: 'fail',
      script: 'fail',
      steps: [6],
      says: ['no enclosed file holds those bytes'],
      saysNot: ['PASS']
    },
    {
      // Deletion never removes the capture's earlier manifest entries, so the
      // signed chain still carries a `timestamp` entry for this content hash —
      // but the deletion means no page, screenshot or token for it is ever
      // packaged again. Step 6's required work set has to know that, the same
      // way step 5 already does for the page and screenshot.
      name: 'an export after the timestamped capture was deleted',
      build: async () => {
        await captureLifecycle.delete(captureId)
        return exportPackage('post-deletion')
      },
      binary: 'pass',
      script: 'pass',
      steps: [],
      says: ['expected absent', 'only for captures this package does not enclose'],
      saysNot: ['FAIL', 'The signed chain carries no']
    },
    {
      // Timestamp entries are keyed by content hash alone, so an exemption keyed
      // on the deleted duplicate's hash would also exempt the live capture.
      name: 'a stripped live token whose content hash a deleted capture shares',
      build: async () => {
        const payload = '<html><body>Runbook execution evidence</body></html>'
        const duplicate = await ingestDuplicate(
          'https://example.com/evidence-again',
          payload,
          '2026-04-05T12:03:00.000Z'
        )
        expect(duplicate.hash).toBe(contentHash)
        await captureLifecycle.delete(duplicate.id)
        const dir = await exportPackage('shared-hash-stripped')
        rmSync(join(dir, 'timestamps'), { recursive: true, force: true })
        dropArtifacts(dir, (path) => path.startsWith('timestamps/'))
        return dir
      },
      binary: 'fail',
      script: 'fail',
      steps: [6],
      says: () => [`FAIL [step 6] capture ${captureId}`, 'no enclosed file holds those bytes'],
      saysNot: ['PASS']
    },
    {
      // Selects only the untimestamped capture, so the timestamped one's page,
      // screenshot AND signed token are all legitimately unenclosed.
      name: 'a selection that excludes the timestamped capture',
      build: async () => {
        const other = await ingestDuplicate(
          'https://example.com/other',
          '<html><body>second, unselected capture</body></html>',
          '2026-04-05T12:02:00.000Z'
        )
        return exportPackage('selection-scoped', { captureIds: [other.id] })
      },
      binary: 'pass',
      script: 'pass',
      steps: [],
      says: ['outside the signed export selection'],
      saysNot: ['FAIL']
    },
    {
      // What an operator on a non-default timestamp authority actually gets:
      // getTsaTrustBundle bundles no root, the tokens still ship, and no
      // verification against any anchor is possible. That is neither a pass nor a
      // failure of this package, and exit 0 would report it as the former.
      name: 'no enclosed TSA anchor',
      build: () => {
        const dir = corruptedCopy('no-anchor')
        rmSync(join(dir, 'tsa-root.pem'), { force: true })
        dropArtifacts(dir, (path) => path === 'tsa-root.pem')
        return dir
      },
      binary: 'fail',
      script: 'incomplete',
      steps: [6],
      says: ['verify.sh: INCOMPLETE'],
      saysNot: ['PASS', 'FAIL'],
      binaryFails: {
        name: 'package hash',
        reason: 'does not match the packageHash in the signed export entry'
      },
      divergence:
        'removing the anchor from a sealed package also edits the index the signed export ' +
        'entry hashes; Package Verification recomputes that packageHash and verify.sh does not'
    },
    // #853 on the shell surface. The binary FAILs a v2 package whose export entry
    // was deleted; verify.sh ships inside the same zip, so a silent `[ -f ]`
    // would have the two enclosed verifiers disagree about the same file.
    // evidence.json lists neither itself nor export-entry.json under `artifacts`,
    // so none of these edits disturbs step 1.
    {
      name: 'no export entry in a package that states the post-scope era',
      build: () => strippedEntryCopy('stripped-export-entry'),
      binary: 'fail',
      script: 'fail',
      steps: [5],
      says: ['FAIL [step 5] export-entry.json is missing', 'was sealed with a signed export entry']
    },
    {
      // JSON.stringify cannot write 2.0, so the float goes in as text. The
      // binary parses it to 2 and FAILs; the script must not read "2.0" as
      // unreadable and PASS the same zip.
      name: 'no export entry and the era written as 2.0',
      build: () => {
        const dir = strippedEntryCopy('float-era')
        writeEraLiteral(dir, '2.0')
        return dir
      },
      binary: 'fail',
      script: 'fail',
      steps: [5],
      says: ['FAIL [step 5] export-entry.json is missing', 'states schema version 2,']
    },
    {
      // A v1 index with no entry still verifies (#398), and says it cannot tell
      // an old package from a stripped one instead of saying nothing.
      name: 'no export entry in a package that states the pre-scope era',
      build: () => {
        const dir = strippedEntryCopy('pre-scope-era')
        setEra(dir, 1)
        return dir
      },
      binary: 'pass',
      script: 'pass',
      steps: [],
      says: ['cannot tell which'],
      saysNot: ['FAIL']
    },
    {
      name: 'no export entry and an index that is not JSON',
      build: () => {
        const dir = strippedEntryCopy('unreadable-era')
        writeFileSync(join(dir, 'evidence.json'), '{ not json')
        return dir
      },
      binary: 'fail',
      script: 'fail',
      steps: [1, 5],
      says: ['no readable schema version']
    },
    // Codex review of #1495. These three are well-formed JSON whose `artifacts`
    // all match, so step 1 passes and only `schemaVersion` is unusable. The
    // binary rejects each through EvidencePackageSchema, so a note here would
    // have the script print PASS over a package the verifier beside it FAILs.
    ...(
      [
        ['null', 'null'],
        ['a string', '"2"'],
        ['fractional', '1.5']
      ] as const
    ).map(([label, literal]): ConformanceRow => ({
      name: `no export entry and an era that is ${label}`,
      build: () => {
        const dir = strippedEntryCopy(`unusable-era-${label.replace(/\W/g, '-')}`)
        writeEraLiteral(dir, literal)
        return dir
      },
      binary: 'fail',
      script: 'fail',
      steps: [5],
      says: ['no readable schema version']
    }))
  ]

  describe('both shipped verifiers', () => {
    for (const row of CONFORMANCE) {
      it.skipIf(!RUNS)(`agree on ${row.name}`, async () => {
        const result = checkConformance(await row.build())
        const output = result.scriptOutput
        expect(
          { binary: result.binary, script: result.script, steps: result.scriptSteps },
          `${output}\nPackage Verification failed: ${result.binaryFailures.map((f) => f.name).join(', ')}`
        ).toEqual({ binary: row.binary, script: row.script, steps: row.steps })
        expect(verdictsAgree(result), row.divergence ?? 'the verifiers disagree').toBe(
          row.divergence === undefined
        )
        const says = typeof row.says === 'function' ? row.says() : (row.says ?? [])
        for (const text of says) expect(output).toContain(text)
        for (const text of row.saysNot ?? []) expect(output).not.toContain(text)
        if (row.binaryFails) {
          const { name, reason } = row.binaryFails
          const failure = result.binaryFailures.find((f) => f.name.startsWith(name))
          expect(failure?.reason).toContain(reason)
        }
      })
    }
  })

  it.skipIf(!RUNS)('prints an INCOMPLETE verdict above the checks, as it does a PASS', () => {
    // The buffered detail must not swallow a non-zero verdict, and the header
    // above it must name the same outcome as the block below it.
    const dir = corruptedCopy('no-anchor-order')
    rmSync(join(dir, 'tsa-root.pem'), { force: true })
    dropArtifacts(dir, (path) => path === 'tsa-root.pem')
    const lines = runVerifyScript(dir).output.split('\n')
    const verdict = lines.findIndex((line) => line.startsWith('verify.sh: INCOMPLETE'))
    const firstStep = lines.findIndex((line) => line.startsWith('== Step'))
    expect(verdict).toBeGreaterThanOrEqual(0)
    expect(firstStep).toBeGreaterThan(verdict)
  })

  // The recipient of a selection is the reason this script exists: they are
  // outside the investigation and reading to decide whether to trust it. A
  // verdict under several hundred "expected absent" lines is accurate and
  // unreadable, which is the same as unverified for them.
  describe('verdict placement and selection reporting', () => {
    const selectionPackage = async (name: string): Promise<string> => {
      const payload = '<html><body>capture left out of the selection</body></html>'
      const { capture: other } = await ingestMhtmlCapture({
        caseId,
        url: 'https://example.com/unselected',
        title: 'Unselected Page',
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
      return exportPackage(name, { captureIds: [other.id] })
    }

    it.skipIf(!RUNS)('prints the verdict above the checks, not below them', async () => {
      const dir = await selectionPackage('verdict-first')
      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(0)

      const lines = run.output.split('\n')
      const verdict = lines.findIndex((line) => line.startsWith('verify.sh: PASS'))
      const firstStep = lines.findIndex((line) => line.startsWith('== Step'))
      expect(verdict).toBeGreaterThanOrEqual(0)
      expect(firstStep).toBeGreaterThan(verdict)

      // The trailing block is unchanged, so the verdict still appears twice.
      expect(lines.filter((line) => line.startsWith('verify.sh: PASS'))).toHaveLength(2)
      expect(run.output).toContain('Scope: a signed selection.')
    })

    it.skipIf(!RUNS)('counts the unselected exhibits instead of listing them', async () => {
      const dir = await selectionPackage('counted')
      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(0)
      expect(run.output).toMatch(/\d+ of \d+ capture\(s\) are outside the signed export selection/)
      expect(run.output).toContain('re-run with -v to list them')
      expect(run.output).not.toMatch(/capture \S+: outside the signed export selection/)
    })

    it.skipIf(!RUNS)('-v restores the per-item lines the count covers', async () => {
      const dir = await selectionPackage('verbose')
      const run = runVerifyScript(dir, { args: ['-v'] })
      expect(run.status, run.output).toBe(0)
      expect(run.output).toMatch(/capture \S+: outside the signed export selection/)
      // The count is still stated; -v adds detail rather than replacing it.
      expect(run.output).toMatch(/\d+ of \d+ capture\(s\) are outside the signed export selection/)
    })

    it.skipIf(!RUNS)('rejects an unknown option rather than verifying as if it were absent', () => {
      const run = runVerifyScript(packageDir, { args: ['--not-an-option'] })
      expect(run.status).toBe(2)
      expect(run.output).toContain('unknown option')
      expect(run.output).not.toContain('PASS')
    })

    it.skipIf(!RUNS)('states whole-case scope when the signed entry declares it', () => {
      const run = runVerifyScript(packageDir)
      expect(run.status, run.output).toBe(0)
      expect(run.output).toContain('Scope: the whole case,')
      expect(run.output).not.toContain('outside the signed export selection')
    })
  })

  it.skipIf(!RUNS)('exits 2 rather than passing when a required tool is missing', () => {
    const empty = mkdtempSync(join(tmpdir(), 'bb-no-tools-'))
    try {
      const run = runVerifyScript(packageDir, { env: { PATH: empty } })
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
        join(dir, PACKAGE_ROOT_FILES.verifyScript),
        readFileSync(join(packageDir, PACKAGE_ROOT_FILES.verifyScript))
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
