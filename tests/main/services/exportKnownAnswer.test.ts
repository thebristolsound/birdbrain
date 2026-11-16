import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join, sep } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { closeDatabase, getDb, initDatabase } from '@main/services/db/core'
import { createCase, updateCase } from '@main/services/db/caseRepo'
import { listCaptures } from '@main/services/db/captureRepo'
import { listExhibits } from '@main/services/db/exhibitRepo'
import { insertDerivedFile } from '@main/services/db/derivedFileRepo'
import { upsertCaseMember } from '@main/services/db/caseMemberRepo'
import { createNote } from '@main/services/db/noteRepo'
import { ensureCaseDir, getStorageRoot, initStorage } from '@main/services/storage'
import { defaultCaptureStore } from '@main/services/captureStore'
import { appendManifestEntry, initManifest, readEntries } from '@main/services/manifest'
import { createCaptureLifecycle, ingestMhtmlCapture } from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { commitStagedFiles, uploadToStaging } from '@main/services/staging'
import { exportCaseArchive, importCaseArchive } from '@main/services/caseArchive'
import { generateReport } from '@main/services/export'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import * as signingKey from '@main/services/signingKey'
import { readStoredZip } from '@main/services/zipRead'
import { MANIFEST_FILENAME } from '@shared/constants'
import { WORKING_COPY_MARKER_FILENAME } from '@shared/schemas'
import { canonicalStringify } from '@shared/verify'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import * as entrySignature from '@shared/verify/signature'
import type { Capture, Exhibit, ExportOptions } from '@shared/types'
import {
  PACKAGE_ROOT_FILES,
  memberChainPath
} from '../../../src/packages/evidence-package-layout/index'
import { seedEngineCapture } from '../../helpers/captureEngineCapture'
import { ENGINE_CAPTURE_ID } from '../../helpers/captureEnginePackage'
import { seedUnanchoredDerivedFile } from '../../helpers/mixedKindCase'
import { buildSyntheticToken } from '../../helpers/timestampFixtures'

// The known answers of `generateReport` (ADR-0004, ADR-0014): two fixed Cases, exported as
// eight packages and one standalone HTML report, with every byte of every output pinned in
// tests/fixtures/export-known-answer/answers.json. A change that alters any member of any
// package, the order of the members, or the Package Hash fails here and names the member.
// The standalone report is pinned once, with every option on. A standalone report with other
// options is not pinned; the packages pin their `report.html` member under each option set.
// The Case Archive and the single-Capture PDF are other exports, written by other code, and
// are not pinned here.
//
// Each answer is the SHA-256 and size of every zip member in zip order, the SHA-256 of the
// zip, the Package Hash the `export` Manifest Entry signs, and what Package Verification
// says of the unpacked zip: its outcome, and every check it ran with the status it ended in.
//
// One Case is written through the app's own writers and three shared test helpers. Seven
// answers export it, and an eighth exports the copy an archive import makes of it, whose rows
// the import renamed. The other is a Shared Case whose two chains this file writes by hand,
// and one answer exports that. What the helpers write is part of each answer that encloses
// or reports it: `seedEngineCapture` with the `ENGINE_FILES` and `ENGINE_CAPTURE_ID` of
// tests/helpers/captureEnginePackage.ts, `seedUnanchoredDerivedFile` and
// `buildSyntheticToken`. A change to one of them moves those answers.
//
// To change an answer on purpose, run the whole file with
//   BIRDBRAIN_UPDATE_EXPORT_KNOWN_ANSWER=1 pnpm test tests/main/services/exportKnownAnswer.test.ts
// and commit answers.json with the change that moved it. The update writes the answers that
// run produced and no other, so an answer whose test is gone leaves the file. The file's diff then lists the
// members that moved, which the pull request has to account for.
//
// The outputs are fixed by fixing every input the export reads from its machine:
//   - the signatures, through a stand-in signer (see `standInSignature`), because no private
//     key is ever committed (scripts/dev-seed/profile.mjs), and the two public keys, from
//     tests/fixtures/export-known-answer/;
//   - the installation id, written before the id service loads it;
//   - the clock, with a fake `Date` moved by hand between writes;
//   - every generated id, through the `uuid` and `crypto.randomUUID` mocks below;
//   - the tool version, which otherwise follows package.json and would move every answer at
//     each release;
//   - the time zone and the operator-local date text, which report.html prints with
//     `toLocaleString()` and the zip writes into its DOS timestamps.
//
// The answers are those of a platform whose paths use `/`. The Staging Pool commit signs each
// stored path as the platform spells it, so on Windows the same Case has other, equally valid
// bytes, and the suite reports itself skipped there.
//
// Not covered: burned annotations and thumbnails made at export or ingest, because sharp's
// encoded bytes differ between the system build some machines test with and the prebuilt
// one CI uses (docs/agents/testing.md, "sharp under Electron on Linux").

const ids = vi.hoisted(() => {
  let scope = 0
  let count = 0
  const hex = (value: number, width: number): string => value.toString(16).padStart(width, '0')
  return {
    // One scope per seeding step, so an id a step starts to generate does not
    // renumber the ids of the steps after it.
    scope: (next: number): void => {
      scope = next
      count = 0
    },
    next: (): string => `00000000-0000-4000-8000-${hex(scope, 4)}${hex(++count, 8)}`
  }
})

vi.mock('uuid', async (importOriginal) => ({
  ...(await importOriginal<typeof import('uuid')>()),
  v4: () => ids.next()
}))

vi.mock('crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('crypto')>()),
  randomUUID: () => ids.next()
}))

const TOOL_VERSION = '0.0.0-known-answer'

vi.mock('@main/services/toolVersion', () => ({ resolveToolVersion: () => TOOL_VERSION }))

vi.setConfig({ testTimeout: 60_000 })

const FIXTURES = join(process.cwd(), 'tests/fixtures/export-known-answer')
const ANSWERS_PATH = join(FIXTURES, 'answers.json')
const UPDATE = process.env.BIRDBRAIN_UPDATE_EXPORT_KNOWN_ANSWER === '1'

const LOCAL_ID = 'installation-known-answer-local'
const PEER_ID = 'installation-known-answer-peer'
const LOCAL_PUBLIC_KEY = readFileSync(join(FIXTURES, 'installation-public-key.pem'), 'utf-8')
const PEER_PUBLIC_KEY = readFileSync(join(FIXTURES, 'peer-public-key.pem'), 'utf-8')

const LOCAL = {
  operatorId: LOCAL_ID,
  operatorName: 'Known Answer Operator',
  toolVersion: TOOL_VERSION
}
const PEER = { operatorId: PEER_ID, operatorName: 'Robin Peer', toolVersion: TOOL_VERSION }

const ZIP_BYTES = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('known-answer attachment payload')
])
const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')
const PAGE_SCREENSHOT = Buffer.from('known-answer screenshot no entry anchors')

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')

// What stands in for an RSA signature here: a digest of the public key and the entry hash,
// which the stand-in verifier recomputes. It keeps what the export reads of a signature (an
// entry verifies under one key and no other) and makes the signed bytes repeat without a
// private key. The packages these tests pin therefore verify only under the stand-in; the
// export and package suites beside this one verify real signatures.
const standInSignature = (publicKeyPem: string, entryHash: string): string =>
  createHash('sha256').update(`${publicKeyPem}\n${entryHash}`).digest('base64')

/** What Package Verification says of an unpacked zip. */
interface VerificationAnswer {
  /**
   * `verified` only when the verifier ran its checks and none failed. A Working Copy is
   * `not-verifiable`. A package the verifier declines to judge is `unsupported`, never a pass.
   */
  outcome: 'verified' | 'failed' | 'not-verifiable' | 'unsupported'
  /** `<status> <name>` for every check, in the order the verifier ran them. */
  checks: string[]
}

/** One exported zip, as answers.json pins it. */
interface PackageAnswer {
  zipSha256: string
  packageHash: string
  verification: VerificationAnswer
  /** `<sha256> <bytes> <name>` for each member, in zip order. */
  members: string[]
}

interface FileAnswer {
  sha256: string
  bytes: number
}

type Answer = PackageAnswer | FileAnswer

const pinned: Record<string, Answer> = existsSync(ANSWERS_PATH)
  ? (JSON.parse(readFileSync(ANSWERS_PATH, 'utf-8')) as Record<string, Answer>)
  : {}
const produced: Record<string, Answer> = {}

/** Compares one output with its pinned answer, or records it when updating. */
function expectKnownAnswer(name: string, answer: Answer): void {
  produced[name] = answer
  if (UPDATE) return
  // An answer the file does not hold is a failure, never a pass.
  expect(pinned[name], `no pinned answer named "${name}" in ${ANSWERS_PATH}`).toBeDefined()
  expect(answer).toEqual(pinned[name])
}

const include = (over: Partial<ExportOptions['include']> = {}): ExportOptions['include'] => ({
  captures: true,
  screenshots: true,
  auditTrail: true,
  notes: true,
  annotations: 'none',
  ...over
})

describe.skipIf(sep !== '/')('export known answers', () => {
  let tempDir: string
  const zone = process.env.TZ
  const lifecycle = createCaptureLifecycle({
    selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
  })

  const at = (iso: string): void => {
    vi.setSystemTime(new Date(iso))
  }
  const caseDirOf = (caseId: string): string => join(getStorageRoot(), caseId)

  beforeAll(() => {
    process.env.TZ = 'UTC'
  })

  afterAll(() => {
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
    if (!UPDATE) return
    const sorted = Object.fromEntries(
      Object.keys(produced)
        .sort()
        .map((name) => [name, produced[name]])
    )
    writeFileSync(ANSWERS_PATH, JSON.stringify(sorted, null, 2) + '\n')
  })

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-02T09:00:00.000Z') })
    // report.html prints an operator-local time beside each UTC one. The stand-in keeps it
    // out of the machine's locale and of the ICU build the runtime carries.
    vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (this: Date) {
      return `local time of ${this.toISOString()}`
    })
    ids.scope(0)
    tempDir = mkdtempSync(join(tmpdir(), 'bb-export-known-answer-'))
    vi.spyOn(signingKey, 'getPublicKeyPem').mockReturnValue(LOCAL_PUBLIC_KEY)
    vi.spyOn(signingKey, 'signEntryHash').mockImplementation((entryHash) =>
      standInSignature(LOCAL_PUBLIC_KEY, entryHash)
    )
    const verifies = (entryHash: string, signature: string, publicKeyPem: string): boolean =>
      signature === standInSignature(publicKeyPem, entryHash)
    vi.spyOn(entrySignature, 'verifyEntrySignature').mockImplementation(verifies)
    writeFileSync(join(tempDir, 'installation-id'), LOCAL_ID)
    resetInstallationId()
    initInstallationId(tempDir)
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
    updateSettings({
      operatorName: LOCAL.operatorName,
      operatorRole: 'Analyst',
      operatorOrganization: 'Known Answer Unit'
    })
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    vi.restoreAllMocks()
    vi.useRealTimers()
    rmSync(tempDir, { recursive: true, force: true })
  })

  async function ingest(
    caseId: string,
    slug: string,
    timestamp: string,
    scope: number
  ): Promise<Capture> {
    ids.scope(scope)
    at(timestamp)
    const body = `<html><body>Known answer ${slug}</body></html>`
    const { capture } = await ingestMhtmlCapture(
      {
        caseId,
        url: `https://example.com/${slug}`,
        title: `Known answer ${slug}`,
        timestamp,
        stream: Readable.from([Buffer.from(body)]) as unknown as ReadableStream<Uint8Array>,
        textContent: `Known answer ${slug}`,
        headers: {},
        browserVersion: '',
        userAgent: '',
        httpStatus: 200,
        extensionVersion: '',
        ...LOCAL
      },
      async () => null
    )
    return capture
  }

  // A Derived File a `derivation` entry anchors: its bytes, its entry and its row.
  function anchorDerivedFile(params: {
    caseId: string
    parentExhibitId: string
    parentContentHash: string
    derivation: string
    outputPath: string
    timestamp: string
  }): void {
    const { caseId, parentExhibitId, parentContentHash, derivation, outputPath, timestamp } = params
    const bytes = Buffer.from(`known-answer ${derivation} of ${parentExhibitId}`)
    const abs = join(getStorageRoot(), ...outputPath.split('/'))
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, bytes)
    const { index } = appendManifestEntry(caseDirOf(caseId), {
      type: 'derivation',
      caseId,
      parentExhibitId,
      parentContentHash,
      derivation,
      derivationToolVersion: TOOL_VERSION,
      outputHash: sha256(bytes),
      outputPath,
      timestamp,
      ...LOCAL
    })
    insertDerivedFile({
      exhibitId: parentExhibitId,
      derivation,
      toolVersion: TOOL_VERSION,
      contentHash: sha256(bytes),
      path: outputPath,
      createdAt: timestamp,
      manifestSeq: index
    })
  }

  function stamp(caseId: string, contentHash: string, timestamp: string): void {
    appendManifestEntry(caseDirOf(caseId), {
      type: 'timestamp',
      caseId,
      captureContentHash: contentHash,
      timestamp,
      tsaToken: buildSyntheticToken({
        contentHash,
        genTime: new Date(timestamp),
        tsaDnsName: 'tsa.known-answer.example'
      }).toString('base64'),
      ...LOCAL
    })
  }

  interface LocalCase {
    caseId: string
    /** Stamped, with a thumbnail Derived File and a screenshot on disk no entry anchors. */
    page: Capture
    /** Unstamped, with nothing beside its page archive. */
    plain: Capture
    /** Its entry anchors a screenshot, a Transaction Record and a PDF. */
    engine: Capture
    /** Stamped. */
    attachment: Exhibit
    /** With an anchored text Derived File. */
    document: Exhibit
  }

  // The Case every answer but the Shared Case's is exported from. Each test
  // builds it again: an export appends to the chain, so two exports from one
  // Case would make the second answer depend on the first having run.
  async function seedLocalCase(): Promise<LocalCase> {
    ids.scope(1)
    const { id: caseId } = createCase({
      name: 'Known Answer Case',
      description: 'The inputs of the export known answers'
    })
    updateCase({ id: caseId, caseNumber: 'KA-2026-001' })
    ensureCaseDir(caseId)
    initManifest(caseDirOf(caseId))

    const page = await ingest(caseId, 'page', '2026-11-02T09:01:00.000Z', 2)
    defaultCaptureStore.writeScreenshot(caseId, page.id, PAGE_SCREENSHOT)
    const plain = await ingest(caseId, 'plain', '2026-11-02T09:02:00.000Z', 3)

    ids.scope(4)
    at('2026-11-02T09:03:00.000Z')
    const engine = await seedEngineCapture({
      caseDir: caseDirOf(caseId),
      caseId,
      captureId: ENGINE_CAPTURE_ID,
      store: defaultCaptureStore
    })

    ids.scope(5)
    at('2026-11-02T09:04:00.000Z')
    const uploads = join(tempDir, 'uploads')
    mkdirSync(uploads, { recursive: true })
    writeFileSync(join(uploads, 'bundle.zip'), ZIP_BYTES)
    writeFileSync(join(uploads, 'statement.pdf'), PDF_BYTES)
    const staged = await uploadToStaging(caseId, [
      join(uploads, 'bundle.zip'),
      join(uploads, 'statement.pdf')
    ])
    const { outcomes } = await commitStagedFiles(
      caseId,
      staged.map((row) => row.id)
    )
    expect(outcomes.map(({ status }) => status)).toEqual(['committed', 'committed'])
    const exhibits = listExhibits(caseId)
    const attachment = exhibits.find(({ kind }) => kind === 'attachment')!
    const document = exhibits.find(({ kind }) => kind === 'document')!

    ids.scope(6)
    at('2026-11-02T09:05:00.000Z')
    anchorDerivedFile({
      caseId,
      parentExhibitId: page.id,
      parentContentHash: page.hash,
      derivation: 'thumbnail',
      outputPath: `${caseId}/${page.id}_thumb.jpg`,
      timestamp: '2026-11-02T09:05:00.000Z'
    })
    anchorDerivedFile({
      caseId,
      parentExhibitId: document.id,
      parentContentHash: document.contentHash,
      derivation: 'text',
      outputPath: `${caseId}/documents/${document.id}_text.txt`,
      timestamp: '2026-11-02T09:05:30.000Z'
    })
    // Held back from every package, and counted in the Certification.
    seedUnanchoredDerivedFile(tempDir, caseId, engine.id)

    ids.scope(7)
    at('2026-11-02T09:06:00.000Z')
    stamp(caseId, page.hash, '2026-11-02T09:06:00.000Z')
    stamp(caseId, attachment.contentHash, '2026-11-02T09:06:30.000Z')

    ids.scope(8)
    at('2026-11-02T09:07:00.000Z')
    createNote({ caseId, captureId: page.id, title: 'On the page', body: 'Attached to the page.' })
    at('2026-11-02T09:08:00.000Z')
    createNote({ caseId, captureId: plain.id, title: 'On the plain capture', body: 'Left out.' })
    at('2026-11-02T09:09:00.000Z')
    createNote({ caseId, title: 'Attached to nothing', body: 'A Case note.' })

    return { caseId, page, plain, engine, attachment, document }
  }

  const TIME = '2026-11-03T10:00:00.000Z'

  // A signed chain built line by line, as appendManifestEntry builds one. A
  // Shared Case holds a chain only another installation writes, which no test
  // can produce through this installation's writers, so both of its chains
  // are written here as their two installations would have written them.
  class Chain {
    lines: string[] = []
    hashes: string[] = []
    constructor(private sign: (entryHash: string) => string) {}
    append(body: Record<string, unknown>): this {
      const full = { ...body, index: this.lines.length, prevHash: this.hashes.at(-1) ?? '' }
      const entryHash = sha256(canonicalStringify(full))
      this.lines.push(JSON.stringify({ ...full, entryHash, signature: this.sign(entryHash) }))
      this.hashes.push(entryHash)
      return this
    }
    get jsonl(): string {
      return this.lines.join('\n') + '\n'
    }
  }

  // A two-member Shared Case on its Owner's replica: this installation is the
  // Owner, and its chain excludes the one document the peer's chain holds.
  function seedSharedCase(): { caseId: string; peerDocument: string } {
    ids.scope(1)
    at(TIME)
    const { id: caseId } = createCase({ name: 'Known Answer Shared Case' })
    mkdirSync(caseDirOf(caseId), { recursive: true })

    const document = (
      chain: Chain,
      by: typeof LOCAL,
      author: { installationId: string; memberCode: string } | null
    ): string => {
      const exhibitId = `${by.operatorId}-document`
      const path = `${caseId}/documents/${exhibitId}.pdf`
      const bytes = Buffer.from(`%PDF statement ${exhibitId}`)
      const abs = join(getStorageRoot(), path)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, bytes)
      chain.append({
        type: 'exhibit',
        exhibitId,
        caseId,
        kind: 'document',
        origin: 'manual-upload',
        name: 'statement.pdf',
        exhibitNumber: 1,
        path,
        contentHash: sha256(bytes),
        sizeBytes: bytes.length,
        timestamp: TIME,
        ...by,
        schemaVersion: 3
      })
      getDb()
        .prepare(
          `INSERT INTO exhibits (
             id, case_id, kind, origin, exhibit_number, name, content_hash, path,
             size_bytes, committed_at, manifest_seq, member_code, author_installation_id
           ) VALUES (?, ?, 'document', 'manual-upload', 1, 'statement.pdf', ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          exhibitId,
          caseId,
          sha256(bytes),
          path,
          bytes.length,
          TIME,
          chain.lines.length - 1,
          author?.memberCode ?? null,
          author?.installationId ?? null
        )
      return exhibitId
    }
    const memberAdd = (
      installationId: string,
      pem: string,
      code: string,
      name: string,
      role: 'owner' | 'member'
    ): Record<string, unknown> => ({
      type: 'member-add',
      caseId,
      memberInstallationId: installationId,
      memberPublicKeyPem: pem,
      memberCode: code,
      memberOperatorName: name,
      nodeId: `node-${installationId}`,
      role,
      timestamp: TIME,
      ...LOCAL,
      schemaVersion: 4
    })

    const peer = new Chain((entryHash) => standInSignature(PEER_PUBLIC_KEY, entryHash))
    const peerDocument = document(peer, PEER, { installationId: PEER_ID, memberCode: 'RP' })
    const owner = new Chain(signingKey.signEntryHash)
    owner.append(memberAdd(LOCAL_ID, LOCAL_PUBLIC_KEY, 'KA', 'Known', 'owner'))
    owner.append(memberAdd(PEER_ID, PEER_PUBLIC_KEY, 'RP', 'Robin', 'member'))
    document(owner, LOCAL, null)
    owner.append({
      type: 'merge',
      caseId,
      heads: [
        {
          installationId: PEER_ID,
          index: peer.lines.length - 1,
          entryHash: peer.hashes.at(-1),
          entriesReceived: peer.lines.length
        }
      ],
      timestamp: TIME,
      ...LOCAL,
      schemaVersion: 4
    })
    owner.append({
      type: 'exclude',
      caseId,
      exhibitId: peerDocument,
      authorInstallationId: PEER_ID,
      reason: 'outside the warrant',
      timestamp: '2026-11-03T11:30:00.000Z',
      ...LOCAL,
      schemaVersion: 4
    })
    writeFileSync(join(caseDirOf(caseId), MANIFEST_FILENAME), owner.jsonl)
    writeFileSync(join(caseDirOf(caseId), memberChainPath(PEER_ID)), peer.jsonl)
    const member = { caseId, nodeId: 'node', revokedAtIndex: null }
    upsertCaseMember({
      ...member,
      installationId: LOCAL_ID,
      publicKeyPem: LOCAL_PUBLIC_KEY,
      memberCode: 'KA',
      operatorName: 'Known',
      role: 'owner',
      addedAtIndex: 0
    })
    upsertCaseMember({
      ...member,
      installationId: PEER_ID,
      publicKeyPem: PEER_PUBLIC_KEY,
      memberCode: 'RP',
      operatorName: 'Robin',
      role: 'member',
      addedAtIndex: 1
    })
    return { caseId, peerDocument }
  }

  interface Exported {
    answer: PackageAnswer
    zip: Map<string, Buffer>
    exportEntry: Record<string, unknown>
  }

  // Exports the Case as a zip at a fixed time and reads back what it wrote.
  async function exportZip(
    caseId: string,
    options: Omit<ExportOptions, 'format' | 'outputPath'>
  ): Promise<Exported> {
    ids.scope(0x7000)
    at('2026-11-04T15:00:00.000Z')
    const outputPath = join(tempDir, 'export.zip')
    await generateReport(caseId, { ...options, format: 'zip', outputPath }, lifecycle)
    const zipBytes = readFileSync(outputPath)
    const zip = readStoredZip(zipBytes)
    const exportEntry = readEntries(
      readFileSync(join(caseDirOf(caseId), MANIFEST_FILENAME), 'utf-8')
    ).at(-1)!
    expect(exportEntry.type).toBe('export')

    const dir = join(tempDir, 'unpacked')
    for (const [name, bytes] of zip) {
      mkdirSync(dirname(join(dir, name)), { recursive: true })
      writeFileSync(join(dir, name), bytes)
    }
    const verified = verifyEvidencePackage(dir)
    const answer: PackageAnswer = {
      zipSha256: sha256(zipBytes),
      packageHash: String(exportEntry.packageHash),
      verification: {
        // `pass` alone is not read: the verifier also answers false with no failed check
        // when it declines to judge a package, and that is its own outcome here.
        outcome: verified.notVerifiable
          ? 'not-verifiable'
          : verified.unsupported
            ? 'unsupported'
            : verified.pass && verified.checks.length > 0
              ? 'verified'
              : 'failed',
        checks: verified.checks.map(({ name, status }) => `${status} ${name}`)
      },
      members: [...zip].map(([name, bytes]) => `${sha256(bytes)} ${bytes.length} ${name}`)
    }
    return { answer, zip, exportEntry }
  }

  const names = (zip: Map<string, Buffer>, directory: string): string[] =>
    [...zip.keys()].filter((name) => name.startsWith(`${directory}/`))
  /** The fields of evidence.json the assertions below read. */
  interface EvidenceIndex {
    captures: Array<{ id: string }>
    exhibits: unknown[]
    sharedCase: { exclusions: Array<{ exhibitId: string; inExport: boolean }> }
  }
  const evidenceIndex = (zip: Map<string, Buffer>): EvidenceIndex =>
    JSON.parse(zip.get(PACKAGE_ROOT_FILES.evidenceIndex)!.toString('utf-8')) as EvidenceIndex

  it('pins an Evidence Package with screenshots', async () => {
    const { caseId } = await seedLocalCase()
    const { answer, zip } = await exportZip(caseId, {
      include: include(),
      exportClass: 'evidence',
      purposeOrAuthority: 'Known answer request 1'
    })

    // What the fixture is here to cover, so a writer that stops producing it
    // fails by name before the hashes do.
    expect(names(zip, 'screenshots')).toHaveLength(2)
    expect(names(zip, 'transaction-records')).toHaveLength(1)
    expect(names(zip, 'pdfs')).toHaveLength(1)
    expect(names(zip, 'timestamps')).toHaveLength(2)
    expect(zip.has(PACKAGE_ROOT_FILES.notes)).toBe(true)
    expect(answer.verification.outcome).toBe('verified')
    expectKnownAnswer('evidence-with-screenshots', answer)
  })

  it('pins an Evidence Package without screenshots', async () => {
    const { caseId } = await seedLocalCase()
    const { answer, zip } = await exportZip(caseId, {
      include: include({ screenshots: false }),
      exportClass: 'evidence'
    })

    // The one screenshot a signed entry anchors is enclosed whatever the option says.
    expect(names(zip, 'screenshots')).toHaveLength(1)
    expect(answer.verification.outcome).toBe('verified')
    expectKnownAnswer('evidence-without-screenshots', answer)
  })

  it('pins an Evidence Package with every include option off', async () => {
    const { caseId } = await seedLocalCase()
    const { answer, zip } = await exportZip(caseId, {
      include: include({ captures: false, screenshots: false, auditTrail: false, notes: false }),
      exportClass: 'evidence'
    })

    expect(zip.has(PACKAGE_ROOT_FILES.notes)).toBe(false)
    expect(answer.verification.outcome).toBe('verified')
    expectKnownAnswer('evidence-minimal', answer)
  })

  it('pins a selection export', async () => {
    const { caseId, page, engine, attachment } = await seedLocalCase()
    const { answer, zip, exportEntry } = await exportZip(caseId, {
      include: include(),
      exportClass: 'evidence',
      captureIds: [page.id, engine.id, attachment.id]
    })

    expect(exportEntry.scope).toBe('selection')
    expect(exportEntry.captureIds).toEqual([page.id, engine.id, attachment.id])
    expect(evidenceIndex(zip).exhibits).toHaveLength(3)
    expect(answer.verification.outcome).toBe('verified')
    expectKnownAnswer('evidence-selection', answer)
  })

  it('pins a Working Copy', async () => {
    const { caseId } = await seedLocalCase()
    const { answer, zip, exportEntry } = await exportZip(caseId, {
      include: include(),
      exportClass: 'working-copy'
    })

    expect(exportEntry.exportClass).toBe('working-copy')
    expect(zip.has(WORKING_COPY_MARKER_FILENAME)).toBe(true)
    expect(zip.has(PACKAGE_ROOT_FILES.manifest)).toBe(false)
    expect(answer.verification.outcome).toBe('not-verifiable')
    expectKnownAnswer('working-copy', answer)
  })

  it('pins a Working Copy with every include option off', async () => {
    const { caseId } = await seedLocalCase()
    const { answer, zip } = await exportZip(caseId, {
      include: include({ captures: false, screenshots: false, auditTrail: false, notes: false }),
      exportClass: 'working-copy'
    })

    // No page archive, no screenshot and no notes: what is left is the marker,
    // the other Exhibits and the Derived Files.
    expect(names(zip, 'pages').filter((name) => name.endsWith('.mhtml'))).toEqual([])
    expect(names(zip, 'screenshots')).toEqual([])
    expect(zip.has(PACKAGE_ROOT_FILES.notes)).toBe(false)
    expect(answer.verification.outcome).toBe('not-verifiable')
    expectKnownAnswer('working-copy-minimal', answer)
  })

  it('pins a standalone HTML report', async () => {
    const { caseId } = await seedLocalCase()
    ids.scope(0x7000)
    at('2026-11-04T15:00:00.000Z')
    const outputPath = join(tempDir, 'report.html')
    await generateReport(
      caseId,
      { format: 'html', include: include(), exportClass: 'evidence', outputPath },
      lifecycle
    )

    const bytes = readFileSync(outputPath)
    expectKnownAnswer('report-html', { sha256: sha256(bytes), bytes: bytes.length })
  })

  it('pins a Shared Case package with an exclude entry', async () => {
    const { caseId, peerDocument } = seedSharedCase()
    const { answer, zip } = await exportZip(caseId, {
      include: include({ notes: false }),
      exportClass: 'evidence'
    })

    expect(zip.has(memberChainPath(PEER_ID))).toBe(true)
    expect(
      evidenceIndex(zip).sharedCase.exclusions.map(({ exhibitId, inExport }) => [
        exhibitId,
        inExport
      ])
    ).toEqual([[peerDocument, true]])
    expect(answer.verification.outcome).toBe('verified')
    expectKnownAnswer('shared-case-exclude', answer)
  })

  it('pins a package whose rows an import renamed, read under their chain ids', async () => {
    const source = await seedLocalCase()
    ids.scope(0x6000)
    at('2026-11-03T12:00:00.000Z')
    const archive = join(tempDir, 'source.birdbrain')
    await exportCaseArchive(source.caseId, archive)
    // The source Case is still in the database, so the import renames every row.
    ids.scope(0x6001)
    at('2026-11-03T13:00:00.000Z')
    const { newCaseId } = await importCaseArchive(archive)
    const rowIds = listCaptures(newCaseId).map(({ id }) => id)
    expect(rowIds).not.toContain(source.page.id)

    const { answer, zip } = await exportZip(newCaseId, {
      include: include(),
      exportClass: 'evidence'
    })

    // The documents name each Capture by the id its inherited entry carries.
    const indexed = evidenceIndex(zip).captures.map(({ id }) => id)
    expect(indexed.sort()).toEqual([source.page.id, source.plain.id, source.engine.id].sort())
    expect(answer.verification.outcome).toBe('verified')
    expectKnownAnswer('renamed-rows', answer)
  })

  // Last on purpose: it reads what the tests above produced. A test that was removed or
  // skipped leaves its answer in the file with nothing checking it, and that fails here.
  it('pins no answer that no test in this file produced', () => {
    if (UPDATE) return
    expect(Object.keys(pinned).sort()).toEqual(Object.keys(produced).sort())
  })
})
