import {
  existsSync,
  closeSync,
  fstatSync,
  openSync,
  readdirSync,
  statSync,
  readFileSync,
  readSync,
  writeSync,
  fsyncSync,
  truncateSync
} from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { MANIFEST_FILENAME, MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import { ManifestEntrySchema } from '@shared/schemas'
import type { ManifestEntry } from '@shared/schemas'
import {
  canonicalStringify,
  SHARED_CASE_ENTRY_TYPES,
  verifyManifestChainText,
  verifySharedCaseReplica
} from '@shared/verify'
import type { PackagedArtifact } from '@shared/verify/packageHash'
import type {
  ChainVerifyResult,
  CaptureChainEntry,
  SharedCaseLineage,
  SharedCaseMemberChain,
  SharedCaseVerifyResult,
  UnsupportedEntry
} from '@shared/verify'
import { LINEAGE_DIRECTORY, parseChainPath } from '../../packages/evidence-package-layout/index'
import { getInstallationId } from '@main/services/installationId'
import { getPublicKeyPem, signEntryHash } from '@main/services/signingKey'
import type {
  TrustedTime,
  ArchiveVerificationResult,
  CaptureMethod,
  ConsentSuppression
} from '@shared/types'
import type { TlsCertChainResult } from '@main/services/tlsCertChain'

export type { TrustedTime }

export interface ManifestHead {
  prevHash: string
  nextIndex: number
}

// Ensures the manifest file exists for a given case directory.
export function initManifest(caseDir: string): void {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path)) {
    const fd = openSync(path, 'a')
    closeSync(fd)
  }
}

// How many bytes of manifest tail to pull per read. Entries run a few hundred
// bytes, so the first read finds the last line; the loop only widens for a
// pathologically long final line.
const TAIL_READ_BYTES = 64 * 1024

// Scans an accumulated manifest tail backwards for the last non-empty line.
// Returns undefined when more bytes could still change the answer — either
// every line seen so far was blank, or the candidate reaches offset 0 and may
// be the fragment of a longer line still sitting earlier in the file.
//
// Searching for 0x0A at the byte level is safe regardless of encoding: a
// newline byte never occurs inside a multi-byte UTF-8 sequence, so only whole
// lines are ever decoded.
function lastLineInTail(tail: Buffer, atFileStart: boolean): string | undefined {
  let end = tail.length
  while (end > 0) {
    const nl = tail.lastIndexOf(0x0a, end - 1)
    const start = nl + 1
    const line = tail.subarray(start, end).toString('utf-8')
    if (line.trim().length > 0) {
      return start === 0 && !atFileStart ? undefined : line
    }
    if (nl < 0) break
    end = nl
  }
  return undefined
}

// Reads the manifest's last non-empty line without loading the whole file.
// Null when the file holds no non-empty line.
function readLastManifestLine(path: string): string | null {
  const fd = openSync(path, 'r')
  try {
    let end = fstatSync(fd).size
    let tail = Buffer.alloc(0)
    while (end > 0) {
      const start = Math.max(0, end - TAIL_READ_BYTES)
      const chunk = Buffer.alloc(end - start)
      const bytesRead = readSync(fd, chunk, 0, chunk.length, start)
      tail = Buffer.concat([chunk.subarray(0, bytesRead), tail])
      end = start
      const line = lastLineInTail(tail, end === 0)
      if (line !== undefined) return line
    }
    return null
  } finally {
    closeSync(fd)
  }
}

// Reads the last line to determine prevHash + next index.
// Reads from the tail rather than the whole file: this runs on every append, so
// a whole-file read made each capture O(N) in manifest size — O(N^2) over the
// life of a case.
// Deliberately STRICT, unlike readEntries(): an unparseable or wrong-shaped
// tail line throws, so a corrupt manifest can never be read as empty and
// silently restart the chain, and appendManifestEntry can never extend the
// chain from garbage head metadata.
export function getManifestHead(caseDir: string): ManifestHead {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path) || statSync(path).size === 0) {
    return { prevHash: '', nextIndex: 0 }
  }
  const lastLine = readLastManifestLine(path)
  if (lastLine === null) return { prevHash: '', nextIndex: 0 }
  const parsed: unknown = JSON.parse(lastLine)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Invalid manifest tail entry')
  }
  const last = parsed as { index?: unknown; entryHash?: unknown }
  if (
    typeof last.index !== 'number' ||
    !Number.isSafeInteger(last.index) ||
    last.index < 0 ||
    typeof last.entryHash !== 'string' ||
    last.entryHash.length === 0
  ) {
    throw new Error('Invalid manifest tail entry')
  }
  return { prevHash: last.entryHash, nextIndex: last.index + 1 }
}

export interface ManifestHeadRef {
  index: number
  entryHash: string
}

export interface ManifestSnapshot {
  jsonl: Buffer
  entries: Record<string, unknown>[]
  head: ManifestHeadRef | null
}

// Lenient line parser for read-only consumers (the export snapshot,
// trusted-time resolution): unparseable and non-object lines (null, arrays,
// scalars) become {} — inert to every consumer — instead of throwing or
// leaking a value consumers would crash on (`entry.type` on null). The append
// path must NOT use this; getManifestHead is the strict dialect (see its
// comment).
export function readEntries(jsonl: string): Record<string, unknown>[] {
  return jsonl
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        const value: unknown = JSON.parse(line)
        return value !== null && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {}
      } catch {
        return {}
      }
    })
}

// Head reference (last entry's index + entryHash) over leniently-read entries.
// Null when the manifest is empty or its last line is unreadable — consumers
// render that as an explicit gap rather than omitting the reference.
export function head(entries: Record<string, unknown>[]): ManifestHeadRef | null {
  const last = entries.at(-1) as { index?: number; entryHash?: string } | undefined
  return typeof last?.index === 'number' && typeof last.entryHash === 'string'
    ? { index: last.index, entryHash: last.entryHash }
    : null
}

// One read of a case manifest, to be shared by every consumer of that read:
// raw bytes (for bundling), lenient entries, and the head reference. Callers
// that need more than one of these must take a single snapshot — reading twice
// would let the timestamp worker append between the reads, so the consumers
// could describe different manifest states.
export function readManifestSnapshot(caseDir: string): ManifestSnapshot {
  const path = join(caseDir, MANIFEST_FILENAME)
  const jsonl = existsSync(path) ? readFileSync(path) : Buffer.alloc(0)
  const entries = readEntries(jsonl.toString('utf-8'))
  return { jsonl, entries, head: head(entries) }
}

// Another member's chain, or a lineage chain, in a Case directory: byte-for-byte
// as received, which is how an export and an archive ship it.
export interface ChainFileSnapshot {
  // Relative to the Case directory, and the name it ships under.
  path: string
  installationId: string
  // Set for a lineage chain: the Case it belongs to.
  sourceCaseId?: string
  jsonl: Buffer
}

// Every other member chain beside the manifest and every lineage chain under
// the lineage directory, by the Package Layout's names. A Case nobody shared
// or forked has none.
export function readChainFileSnapshots(caseDir: string): ChainFileSnapshot[] {
  if (!existsSync(caseDir)) return []
  const read = (path: string): ChainFileSnapshot[] => {
    const chain = parseChainPath(path)
    return chain ? [{ path, ...chain, jsonl: readFileSync(join(caseDir, path)) }] : []
  }
  const members = readdirSync(caseDir).flatMap(read)
  const lineageDir = join(caseDir, LINEAGE_DIRECTORY)
  if (!existsSync(lineageDir) || !statSync(lineageDir).isDirectory()) return members
  const lineage = readdirSync(lineageDir).flatMap((sourceCaseId) =>
    statSync(join(lineageDir, sourceCaseId)).isDirectory()
      ? readdirSync(join(lineageDir, sourceCaseId)).flatMap((name) =>
          read([LINEAGE_DIRECTORY, sourceCaseId, name].join('/'))
        )
      : []
  )
  return [...members, ...lineage]
}

// The chain snapshots in the shape the Shared Case walk takes them.
export function sharedCaseChains(chains: ChainFileSnapshot[]): {
  others: SharedCaseMemberChain[]
  lineage: SharedCaseLineage[]
} {
  const others: SharedCaseMemberChain[] = []
  const lineage = new Map<string, SharedCaseMemberChain[]>()
  for (const { installationId, sourceCaseId, jsonl } of chains) {
    const chain = { installationId, jsonl: jsonl.toString('utf-8') }
    if (sourceCaseId === undefined) others.push(chain)
    else lineage.set(sourceCaseId, [...(lineage.get(sourceCaseId) ?? []), chain])
  }
  return {
    others,
    lineage: [...lineage].map(([sourceCaseId, members]) => ({ sourceCaseId, members }))
  }
}

// Whether a manifest and its chains are a Shared Case, or a fork of one: the
// same signals the package verifier walks on, so the app and the verifier
// agree about which Cases have a roster to state.
export function isSharedCase(
  entries: Record<string, unknown>[],
  chains: ChainFileSnapshot[]
): boolean {
  const sharedTypes: ReadonlySet<unknown> = SHARED_CASE_ENTRY_TYPES
  return (
    chains.length > 0 ||
    entries.some(
      (e) => sharedTypes.has(e.type) || (e.type === 'exhibit' && e.memberCode !== undefined)
    )
  )
}

export interface SharedCaseSnapshot {
  chains: ChainFileSnapshot[]
  // The Shared Case walk over the manifest and the chains, anchored at the
  // local key. Undefined for a Case that was never shared or forked.
  verification?: SharedCaseVerifyResult
}

// The Shared Case as one read of a Case directory: the chains beside a
// manifest snapshot the caller already took, and the walk over both. The
// caller takes the manifest snapshot first and this straight after, with
// nothing awaited between, so both describe one state of the directory.
export function readSharedCaseSnapshot(
  caseDir: string,
  manifest: ManifestSnapshot
): SharedCaseSnapshot {
  const chains = readChainFileSnapshots(caseDir)
  if (!isSharedCase(manifest.entries, chains)) return { chains }
  const verification = verifySharedCaseReplica({
    local: { jsonl: manifest.jsonl.toString('utf-8'), publicKeyPem: getPublicKeyPem() },
    ...sharedCaseChains(chains)
  })
  return { chains, verification }
}

// The chain that answers for one row: the verified entries of the chain its
// author signed, at their indices, and that chain's verdict. `imports` are
// always the local chain's: the custody records that resolve an imported
// entry's ids to the row's.
export interface AuthorChain {
  entries: Record<string, unknown>[]
  chain: ChainVerifyResult
  imports: ManifestImportEntry[]
}

// A Case directory's chains, read once for a verify pass. The Shared Case walk
// runs only when a row names another author, and then once.
export interface CaseChains {
  own: AuthorChain
  shared: () => SharedCaseSnapshot
}

const EMPTY_CHAIN: ChainVerifyResult = {
  valid: true,
  trustedTimes: new Map(),
  captureHashesByIndex: new Map(),
  captureEntriesByIndex: new Map()
}

export function readCaseChains(caseDir: string): CaseChains {
  const manifest = readManifestSnapshot(caseDir)
  const chain =
    manifest.jsonl.length === 0
      ? EMPTY_CHAIN
      : verifyManifestChainText(manifest.jsonl.toString('utf-8'), {
          publicKeyPem: getPublicKeyPem()
        })
  let shared: SharedCaseSnapshot | undefined
  return {
    own: { entries: manifest.entries, chain, imports: importEntriesOf(manifest) },
    shared: () => (shared ??= readSharedCaseSnapshot(caseDir, manifest))
  }
}

// Whether `author` holds `entry` of a chain: it wrote the entry, or it wrote a
// later `import` and so continued the chain that holds it. An archive import
// keeps the source's entries as they were signed, so an Exhibit from before
// an Owner's earlier import carries that source's operatorId.
function heldBy(entries: ManifestEntry[], entry: ManifestEntry, author: string): boolean {
  return (
    entry.operatorId === author ||
    entries.some((e) => e.type === 'import' && e.index > entry.index && e.operatorId === author)
  )
}

// The chain that answers for a row (#1511). A row with no author is this
// installation's and answers to the local chain. A row with one answers to the
// entry at its index, held by that author, for the same bytes, among the
// entries the Shared Case walk accepted: a current member's chain, a lineage
// member's, or the local chain's history, where a fork keeps the source
// Owner's entries. The author can be this installation: a fork stamps the
// forking member's source rows, whose entries are lineage. A row no accepted
// entry answers for gets a failed chain, never the local chain's verdict.
export function authorChainOf(
  chains: CaseChains,
  row: { authorInstallationId: string | null; manifestIndex: number | null; contentHash: string }
): AuthorChain {
  const { authorInstallationId: author, manifestIndex, contentHash } = row
  if (author === null) return chains.own
  const { imports } = chains.own
  const failed = (chain: ChainVerifyResult): AuthorChain => ({ entries: [], chain, imports })
  const { chains: files, verification } = chains.shared()
  if (!verification) {
    if (author === getInstallationId()) return chains.own
    return failed({
      ...EMPTY_CHAIN,
      valid: false,
      reason: `no chain of ${author} in this Case`
    })
  }
  const ownerKey = verification.members.find((m) => m.role === 'owner')?.installationId ?? 'owner'
  const resultFor = (key: string): ChainVerifyResult | undefined =>
    key === verification.localInstallationId
      ? chains.own.chain
      : (verification.memberChains.get(key) ?? (key === ownerKey ? verification.owner : undefined))
  const keys = [
    verification.localInstallationId ?? ownerKey,
    ...files
      .map((f) =>
        f.sourceCaseId === undefined ? f.installationId : `${f.sourceCaseId}/${f.installationId}`
      )
      .filter((key) => key === author || key.endsWith(`/${author}`))
  ]
  for (const key of keys) {
    const accepted = verification.entries.get(key)
    const entry = accepted?.find((e) => e.index === manifestIndex)
    const chain = resultFor(key)
    if (
      accepted &&
      chain &&
      entry &&
      (entry.type === 'exhibit' || entry.type === 'capture') &&
      heldBy(accepted, entry, author) &&
      entry.contentHash === contentHash
    ) {
      return { entries: accepted as unknown as Record<string, unknown>[], chain, imports }
    }
  }
  // Nothing answers: the author's own chain failing says why, when it did.
  const broken = keys
    .slice(1)
    .map(resultFor)
    .find((chain) => chain !== undefined && !chain.valid)
  if (broken) return failed(broken)
  if (!verification.owner.valid) return failed(verification.owner)
  return failed({
    ...EMPTY_CHAIN,
    valid: false,
    reason: `no verified chain of ${author} holds entry ${manifestIndex ?? '(none)'} for these bytes`
  })
}

// One signed capture entry, as recorded on the chain.
export type ManifestCaptureEntry = Extract<ManifestEntry, { type: 'capture' }>

// One signed genesis-of-custody entry, appended when a case arrives by archive
// import.
export type ManifestImportEntry = Extract<ManifestEntry, { type: 'import' }>

export interface CaptureEntryAtIndex {
  entry: ManifestCaptureEntry
  // Every `import` entry in the SAME verified read. An imported case keeps the
  // source installation's ids on the entries it brought with it, so a caller
  // binding one of those entries to a local row needs the custody records to
  // resolve them — and needs them authenticated by the same chain check, not by
  // a second unverified read.
  imports: ManifestImportEntry[]
}

// Reads the capture entry recorded at `index` together with the case's custody
// records, or undefined when the chain does not verify, the line at that
// position is missing, unparseable, not a capture entry, or carries a different
// index than the position it sits at.
//
// For callers that need a capture's ORIGINAL anchored facts (#827 duplication
// re-anchors url/timestamp/headers/tls into a fresh entry): the `captures` row
// mirrors those fields but is hand-editable through Settings → Database, and
// re-signing an edited mirror would launder it into the chain. The chain is
// verified over the SAME snapshot the entry is read from — one read, like
// deletionReconciliation — so a caller's earlier verification of a separate
// read cannot vouch for values a rewrite slipped in between the two reads.
export function readCaptureEntryAt(
  caseDir: string,
  index: number
): CaptureEntryAtIndex | undefined {
  const snapshot = readManifestSnapshot(caseDir)
  const raw = snapshot.entries[index]
  if (raw === undefined) return undefined
  const chain = verifyManifestChainText(snapshot.jsonl.toString('utf-8'), {
    publicKeyPem: getPublicKeyPem()
  })
  if (!chain.valid) return undefined
  const parsed = ManifestEntrySchema.safeParse(raw)
  if (!parsed.success || parsed.data.type !== 'capture' || parsed.data.index !== index) {
    return undefined
  }
  return { entry: parsed.data, imports: importEntriesOf(snapshot) }
}

// Every `import` entry in a manifest read. Only meaningful over a snapshot the
// caller has just verified: the custody records must come from the same chain
// check as the entry they resolve, not from a second unverified read.
export function importEntriesOf(snapshot: ManifestSnapshot): ManifestImportEntry[] {
  const imports: ManifestImportEntry[] = []
  for (const line of snapshot.entries) {
    if (line.type !== 'import') continue
    const parsedImport = ManifestEntrySchema.safeParse(line)
    if (parsedImport.success && parsedImport.data.type === 'import') imports.push(parsedImport.data)
  }
  return imports
}

// A file packaged into an export (evidence .zip or .birdbrain archive), as
// recorded in the package's artifact index.
// The artifact index type and THE packageHash recipe both live in
// @shared/verify/packageHash so the standalone verifier can recompute the hash
// to bind evidence.json's artifact list to the signed export entry (#836).
// Re-exported here so every existing producer keeps importing them from
// manifest.ts, which owns packaging.
export type { PackagedArtifact } from '@shared/verify/packageHash'
export { packageHash } from '@shared/verify/packageHash'

export interface ArtifactAccumulator {
  // Zip entries in add() order, ready for createStoredZip.
  entries: Array<{ name: string; data: Buffer | string }>
  // The artifact index packageHash() is computed over.
  artifacts: PackagedArtifact[]
  // Records a file into both lists and returns its sha256.
  add: (name: string, value: Buffer | string) => string
}

// The shared packaging accumulator: every file added through it lands in the
// zip AND in the artifact index, so the index cannot silently omit a packaged
// file. Index files themselves are pushed onto `entries` directly (never
// through add) — see packageHash() for why they stay out of the artifact list.
export function createArtifactAccumulator(): ArtifactAccumulator {
  const entries: Array<{ name: string; data: Buffer | string }> = []
  const artifacts: PackagedArtifact[] = []
  const add = (name: string, value: Buffer | string): string => {
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf-8')
    const digest = createHash('sha256').update(buf).digest('hex')
    entries.push({ name, data: buf })
    artifacts.push({ path: name, sha256: digest, sizeBytes: buf.length })
    return digest
  }
  return { entries, artifacts, add }
}

export type ManifestEntryInput =
  | {
      type: 'capture'
      captureId: string
      caseId: string
      url: string
      timestamp: string
      contentHash: string
      // Optional content-addressed integrity for the screenshot and extracted
      // text sidecars (#118). OMITTED (never '' / null) when absent so legacy and
      // no-screenshot entries' canonical bodies — and therefore their chain
      // hashes — are unchanged.
      screenshotHash?: string
      textHash?: string
      // Captured HTTP response headers (#119), normalized to lowercase keys with
      // multi-value joins. OMITTED (never {} / null) when absent so legacy and
      // headerless entries' canonical bodies — and chain hashes — are unchanged.
      headers?: Record<string, string>
      // Transaction provenance (R7, #797): the recorded HTTP status, and the
      // URL the stored bytes were served from when the acquiring path resolved
      // one that differs from the URL requested. OMITTED (never 0 / '' / null)
      // when unknown so every pre-R7 entry's canonical body — and chain hash —
      // is unchanged.
      httpStatus?: number
      finalUrl?: string
      // Corroboration-only TLS cert chain re-fetched after storage (#123). NOT
      // bound to the captured transaction. OMITTED when not re-fetched so legacy /
      // cert-less entries' canonical bodies — and chain hashes — are unchanged.
      tls?: TlsCertChainResult
      // Recapture provenance (#recapture); omitted from the manifest body when
      // absent to preserve legacy canonical bodies.
      method?: CaptureMethod
      supersedesCaptureId?: string
      // Duplication provenance (#827). `duplicateOfCaptureId` names the capture
      // whose stored bytes were copied and `duplicatedAt` when the copy was
      // made — the entry's own `timestamp` still describes when the page was
      // observed, which the copy did not do. OMITTED when absent so every
      // pre-existing entry's canonical body — and chain hash — is unchanged.
      duplicateOfCaptureId?: string
      duplicatedAt?: string
      // Consent-overlay suppression active in the rendering session. OMITTED
      // when absent so pre-existing entries' canonical bodies — and chain
      // hashes — are unchanged.
      consentSuppression?: ConsentSuppression
      sizeBytes: number
      operatorId: string
      operatorName: string
      toolVersion: string
    }
  | {
      type: 'deletion'
      captureId: string
      caseId: string
      timestamp: string
      contentHash: string
      operatorId: string
      operatorName: string
      toolVersion: string
      reason?: string
    }
  | {
      // Append-only trusted-time anchor (#120). References a capture entry's
      // contentHash and carries the RFC 3161 token (base64). The capture path
      // never blocks on the TSA — this entry is appended later, by the worker.
      type: 'timestamp'
      caseId: string
      captureContentHash: string
      timestamp: string
      tsaToken?: string
      operatorId: string
      operatorName: string
      toolVersion: string
    }
  | {
      // Signed audit record of an evidence-package export (#124). `packageHash`
      // is computed by packageHash() above over evidence.json's artifact list.
      // `appendManifestEntry` adds index/prevHash/entryHash/signature.
      type: 'export'
      caseId: string
      timestamp: string
      operatorId: string
      operatorName: string
      toolVersion: string
      packageHash: string
      verificationResult: ExportVerificationResult
      // Selection scope (#398, ADR-0009): a selection-scoped export records the
      // exported capture ids on its signed entry. OMITTED (never ''/[]/null) on
      // case-scoped exports so legacy and case-scoped entries' canonical bodies
      // — and chain hashes — are unchanged.
      scope?: 'selection'
      captureIds?: string[]
      // Export class (#399, ADR-0010): a Working Copy export is recorded on the
      // chain — the audit trail must not go silent for a non-evidentiary
      // extraction — but marked as one. OMITTED (never 'evidence'/null) on
      // evidence exports so their entries' canonical bodies are unchanged.
      exportClass?: 'working-copy'
    }
  | {
      // Signed audit record of a case-archive export (.birdbrain). `packageHash`
      // is computed by packageHash() above over package.json's artifact list.
      type: 'archive-export'
      caseId: string
      timestamp: string
      operatorId: string
      operatorName: string
      toolVersion: string
      packageHash: string
    }
  | {
      // Signed genesis-of-custody record appended when a case archive is
      // imported. Continues the source chain (prevHash = source head).
      // sourcePublicKeyPem is the key that signed every entry BEFORE this one
      // (back to the previous import boundary) — verify-core switches keys at
      // these entries.
      type: 'import'
      caseId: string
      sourceCaseId: string
      sourceInstallationId: string
      sourcePublicKeyPem: string
      packageHash: string
      idMapSha256: string
      verificationResult: ArchiveVerificationResult
      timestamp: string
      operatorId: string
      operatorName: string
      toolVersion: string
    }
  | {
      // One Exhibit that is not a Capture (ADR-0023, X24): one entry type with
      // `kind` and `origin` fields, never one type per kind, so the verifier
      // learns one shape. Written by the Staging Pool's commit (#1148); a
      // Capture keeps its `capture` entry.
      type: 'exhibit'
      exhibitId: string
      caseId: string
      kind: string
      origin: string
      name: string
      exhibitNumber: number
      // Storage-root-relative, the same form `derivation.outputPath` records
      // and the `exhibits` row stores, so the three name one file one way.
      path: string
      contentHash: string
      sizeBytes: number
      timestamp: string
      operatorId: string
      operatorName: string
      toolVersion: string
    }
  | {
      // One Derived File computed from an Exhibit (ADR-0023, X17). An entry
      // cannot be amended once written, so a derivation that runs after its
      // parent's ingest — the legacy thumbnail regeneration of X34, and every
      // later derivation — gets its own entry rather than riding in the
      // parent's. The parent is bound by BOTH its id and the Content Hash the
      // derivation ran over: the id alone would not say which bytes.
      type: 'derivation'
      caseId: string
      parentExhibitId: string
      parentContentHash: string
      derivation: string
      // The tool that produced the OUTPUT, which is not always the Birdbrain
      // build that wrote the entry (`toolVersion` below is always that).
      derivationToolVersion: string
      outputHash: string
      outputPath: string
      timestamp: string
      operatorId: string
      operatorName: string
      toolVersion: string
    }
  | {
      // The one-time assignment of Exhibit Numbers to Captures that predate
      // them (X18), written once per Case so the assignment is itself in the
      // chain and a citation cannot be re-derived differently later. An
      // assignment with no `manifestIndex` is a Capture with no Manifest Entry
      // at all (X41) — present-means-anchored keeps that case explicit.
      type: 'renumber'
      caseId: string
      assignments: Array<{ exhibitId: string; exhibitNumber: number; manifestIndex?: number }>
      timestamp: string
      operatorId: string
      operatorName: string
      toolVersion: string
    }

export interface ExportVerificationResult {
  overallValid: boolean
  captureCount: number
  verifiedCount: number
  tamperedCount: number
  missingCount: number
}

export interface AppendResult {
  index: number
  prevHash: string
  entryHash: string
  anchorBytes: number
  // The exact JSONL line appended (trailing newline included). The evidence
  // export packages its own export entry's line as export-entry.json (#398), so
  // the packaged copy is byte-identical to the live manifest's line rather than
  // a re-serialization that could drift.
  line: string
}

// The MINIMUM manifest schema version a reader needs for each entry type this
// build writes — not MANIFEST_SCHEMA_VERSION, which is the highest version this
// build can READ.
//
// Stamping the read ceiling on every entry would make every capture written
// after a version bump unreadable to verifiers already in recipients' hands,
// for entries whose shape those verifiers understand perfectly (X25: a stale
// verifier reporting a valid chain as broken is a false accusation, and nothing
// can recall a distributed copy). So each type declares the oldest verifier
// that can read it, and the v3 types (ADR-0023) are the only ones that will
// stamp 3 — once anything writes them (`803a` onwards).
//
// Typed as a total Record over the input union so adding an entry type without
// deciding its minimum reader version is a compile error, not a silent 2. That
// no value exceeds what this build can read is pinned by a test rather than a
// runtime guard — an unreachable throw here would be untestable code on the
// evidence path.
export const MIN_READER_SCHEMA_VERSION: Record<ManifestEntryInput['type'], number> = {
  capture: 2,
  deletion: 2,
  timestamp: 2,
  export: 2,
  'archive-export': 2,
  import: 2,
  // The v3 types (ADR-0023). No v1 or v2 form exists for either, so a reader
  // below 3 cannot make sense of one and stamping anything lower would invite
  // it to try.
  exhibit: 3,
  derivation: 3,
  renumber: 3
}

// Per-entry overrides for the two generalized types (#1180). A `timestamp` or
// `deletion` entry's shape has a schema-2 form, so the map above says 2 — and
// a schema-2 verifier would then parse an entry that binds an attachment as a
// Capture's and silently fail to apply it. The caller that knows the target is
// not a Capture says so here, and the writer stamps the higher of the two.
export interface AppendOptions {
  minReaderSchemaVersion?: number
}

// Write-ahead append: compute hash, append JSONL line, fsync.
// Caller must call rollbackManifestEntry(anchorBytes) if a later step fails.
export function appendManifestEntry(
  caseDir: string,
  entry: ManifestEntryInput,
  opts: AppendOptions = {}
): AppendResult {
  const path = join(caseDir, MANIFEST_FILENAME)
  const anchorBytes = existsSync(path) ? statSync(path).size : 0
  const { prevHash, nextIndex } = getManifestHead(caseDir)

  const body: Record<string, unknown> = {
    ...entry,
    index: nextIndex,
    prevHash,
    // Never below the type's own minimum, never above what this build can
    // read: an entry stamped past the ceiling would be reported "verifier too
    // old" by the verifier that wrote it.
    schemaVersion: Math.min(
      MANIFEST_SCHEMA_VERSION,
      Math.max(MIN_READER_SCHEMA_VERSION[entry.type], opts.minReaderSchemaVersion ?? 0)
    )
  }
  const canonical = canonicalStringify(body)
  const entryHash = createHash('sha256').update(canonical).digest('hex')
  // Sign the entryHash (G2). The signature is excluded from the canonical body
  // — it covers entryHash, it does not participate in it — so verification can
  // strip it back out and recompute the same hash.
  const signature = signEntryHash(entryHash)
  const fullEntry = { ...body, entryHash, signature }
  const line = JSON.stringify(fullEntry) + '\n'

  const fd = openSync(path, 'a')
  try {
    writeSync(fd, line)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }

  return { index: nextIndex, prevHash, entryHash, anchorBytes, line }
}

// Truncates the manifest file back to the byte offset captured before append.
// Used to roll back a write-ahead append when a downstream step fails.
export function rollbackManifestEntry(caseDir: string, anchorBytes: number): void {
  const path = join(caseDir, MANIFEST_FILENAME)
  truncateSync(path, anchorBytes)
}

// Thrown by the callback passed to `withDeletionEntry` to signal "the side
// effect didn't happen, please roll the manifest back". The wrapper catches
// it, rolls back, and rethrows it as a control-flow signal; the outer call
// site checks `err instanceof ManifestRollback` to translate that into
// a clean failure result instead of treating it as an unexpected error.
export class ManifestRollback extends Error {
  constructor(message = 'manifest rollback requested') {
    super(message)
    this.name = 'ManifestRollback'
  }
}

// Core write-ahead/rollback seam. Appends `entry`, runs `fn` with the resulting
// AppendResult, and either commits (fn succeeded) or rolls the manifest back to
// its prior anchor (fn threw or its returned Promise rejected). Ensures the
// manifest never records a side effect that didn't actually happen. Async
// because `fn` may return a Promise — sync callbacks still work.
export async function withManifestEntry<T>(
  caseDir: string,
  entry: ManifestEntryInput,
  fn: (result: AppendResult) => T | Promise<T>,
  opts: AppendOptions = {}
): Promise<T> {
  initManifest(caseDir)
  const result = appendManifestEntry(caseDir, entry, opts)
  try {
    return await fn(result)
  } catch (err) {
    rollbackManifestEntry(caseDir, result.anchorBytes)
    throw err
  }
}

export interface DeletionEntryContext {
  captureId: string
  caseId: string
  contentHash: string
  operatorId: string
  operatorName: string
  toolVersion: string
  reason?: string
}

// Wraps a deletion side-effect in the manifest's write-ahead/rollback invariant.
export async function withDeletionEntry<T>(
  caseDir: string,
  ctx: DeletionEntryContext,
  fn: () => T | Promise<T>
): Promise<T> {
  return withManifestEntry(
    caseDir,
    {
      type: 'deletion',
      captureId: ctx.captureId,
      caseId: ctx.caseId,
      timestamp: new Date().toISOString(),
      contentHash: ctx.contentHash,
      operatorId: ctx.operatorId,
      operatorName: ctx.operatorName,
      toolVersion: ctx.toolVersion,
      ...(ctx.reason !== undefined ? { reason: ctx.reason } : {})
    },
    fn
  )
}

export interface CaptureEntryContext {
  captureId: string
  caseId: string
  url: string
  timestamp: string
  contentHash: string
  // Optional sidecar integrity hashes (#118); omitted from the manifest body
  // when undefined to preserve legacy canonical bodies.
  screenshotHash?: string
  textHash?: string
  // Captured HTTP response headers (#119); omitted from the manifest body when
  // absent to preserve legacy canonical bodies.
  headers?: Record<string, string>
  // Transaction provenance (R7, #797); omitted from the manifest body when
  // absent to preserve pre-R7 canonical bodies. The caller decides what is
  // known: this seam writes exactly what it is given and nothing when given
  // undefined.
  httpStatus?: number
  finalUrl?: string
  // Corroboration-only TLS cert chain (#123); omitted from the manifest body
  // when absent to preserve legacy canonical bodies.
  tls?: TlsCertChainResult
  // Recapture provenance (#recapture); omitted from the manifest body when
  // absent to preserve legacy canonical bodies.
  method?: CaptureMethod
  supersedesCaptureId?: string
  // Duplication provenance (#827); omitted from the manifest body when absent
  // to preserve legacy canonical bodies.
  duplicateOfCaptureId?: string
  duplicatedAt?: string
  // Consent-overlay suppression provenance; omitted from the manifest body when
  // absent to preserve legacy canonical bodies.
  consentSuppression?: ConsentSuppression
  sizeBytes: number
  operatorId: string
  operatorName: string
  toolVersion: string
}

// Wraps an ingest side-effect (sidecar writes + DB insert) in the manifest's
// write-ahead/rollback invariant. `fn` receives the AppendResult so the caller
// can persist index/prevHash/entryHash on the DB row. Ensures the manifest never
// records a capture that didn't actually land.
export async function withCaptureEntry<T>(
  caseDir: string,
  ctx: CaptureEntryContext,
  fn: (result: AppendResult) => T | Promise<T>
): Promise<T> {
  return withManifestEntry(
    caseDir,
    {
      type: 'capture',
      captureId: ctx.captureId,
      caseId: ctx.caseId,
      url: ctx.url,
      timestamp: ctx.timestamp,
      contentHash: ctx.contentHash,
      ...(ctx.screenshotHash !== undefined ? { screenshotHash: ctx.screenshotHash } : {}),
      ...(ctx.textHash !== undefined ? { textHash: ctx.textHash } : {}),
      ...(ctx.headers !== undefined ? { headers: ctx.headers } : {}),
      ...(ctx.httpStatus !== undefined ? { httpStatus: ctx.httpStatus } : {}),
      ...(ctx.finalUrl !== undefined ? { finalUrl: ctx.finalUrl } : {}),
      ...(ctx.tls !== undefined ? { tls: ctx.tls } : {}),
      ...(ctx.method !== undefined ? { method: ctx.method } : {}),
      ...(ctx.supersedesCaptureId !== undefined
        ? { supersedesCaptureId: ctx.supersedesCaptureId }
        : {}),
      ...(ctx.duplicateOfCaptureId !== undefined
        ? { duplicateOfCaptureId: ctx.duplicateOfCaptureId }
        : {}),
      ...(ctx.duplicatedAt !== undefined ? { duplicatedAt: ctx.duplicatedAt } : {}),
      ...(ctx.consentSuppression !== undefined
        ? { consentSuppression: ctx.consentSuppression }
        : {}),
      sizeBytes: ctx.sizeBytes,
      operatorId: ctx.operatorId,
      operatorName: ctx.operatorName,
      toolVersion: ctx.toolVersion
    },
    fn
  )
}

export type { ChainVerifyResult, CaptureChainEntry, UnsupportedEntry }

// Main-process consumers verifying manifest text that is NOT this case dir's
// live file (e.g. archive inspect, against the archive's own bundled key) go
// through this re-export, so chain verification is always reached via the
// Manifest module. The algorithm itself lives in the shared verify-core.
export { verifyManifestChainText }

// Re-reads the manifest and verifies the hash chain — recomputed entryHashes,
// linkage, v2+ signatures — against this installation's public key. Thin fs
// wrapper; the chain algorithm lives in the shared verify-core (#122) so the
/**
 * Verifies the integrity and authenticity of the manifest hash chain.
 *
 * An empty or missing manifest is considered valid.
 *
 * @param caseDir - The case directory containing the manifest file
 * @returns A result indicating whether the manifest chain is valid and the verified trusted times
 */
export function verifyManifestChain(caseDir: string): ChainVerifyResult {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path) || statSync(path).size === 0) {
    return {
      valid: true,
      trustedTimes: new Map(),
      captureHashesByIndex: new Map(),
      captureEntriesByIndex: new Map()
    }
  }
  const raw = readFileSync(path, 'utf-8')
  return verifyManifestChainText(raw, { publicKeyPem: getPublicKeyPem() })
}
