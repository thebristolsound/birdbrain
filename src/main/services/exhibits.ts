import { createHash, createPublicKey } from 'crypto'
import { createReadStream } from 'fs'
import { ManifestEntrySchema } from '@shared/schemas'
import type { ManifestEntry } from '@shared/schemas'
import { getExhibit, listExhibits } from '@main/services/db/exhibitRepo'
import {
  listDerivedFilesForCase,
  listDerivedFilesForExhibit
} from '@main/services/db/derivedFileRepo'
import { listStagingFiles } from '@main/services/db/stagingRepo'
import {
  importEntriesOf,
  readManifestSnapshot,
  verifyManifestChainText,
  type ChainVerifyResult
} from '@main/services/manifest'
import { getPublicKeyPem } from '@main/services/signingKey'
import { defaultCaptureStore, type CaptureStore } from '@main/services/captureStore'
import { entryDescribesRow, verifyCapture } from '@main/services/captureLifecycle'
import { bindDerivedFile, type DerivationEntryFacts } from '@shared/verify'
import type {
  CaseInventory,
  DerivedFileVerification,
  Exhibit,
  ExhibitVerification,
  InventoryDerivedFileRow,
  InventoryExhibitRow,
  InventoryRow,
  InventoryStagedRow
} from '@shared/types'
import type {
  CaseManifestSnapshot,
  ManifestChainVerdict,
  ManifestSignerSegment,
  ManifestSnapshotEntry
} from '@shared/manifestSnapshot'

// The Exhibit model's main-process read paths (X36, X37). Everything the Data
// screen will render about what a Case holds and whether the chain covers it is
// computed here: the renderer never computes chain state.

// Every Exhibit, Derived File and pooled file a Case holds, as ONE list with a
// discriminator (X16, ADR-0024). Two lists would let a consumer render the
// anchored half and silently omit the pool, which is the exact confusion the
// "not anchored" label exists to prevent.
export function getCaseInventory(
  caseId: string,
  store: CaptureStore = defaultCaptureStore
): CaseInventory {
  const rows: InventoryRow[] = []

  for (const exhibit of listExhibits(caseId)) {
    const row: InventoryExhibitRow = {
      rowType: 'anchored',
      entity: 'exhibit',
      id: exhibit.id,
      caseId: exhibit.caseId,
      kind: exhibit.kind,
      origin: exhibit.origin,
      exhibitNumber: exhibit.exhibitNumber,
      name: exhibit.name,
      contentHash: exhibit.contentHash,
      path: exhibit.path,
      sizeBytes: exhibit.sizeBytes,
      committedAt: exhibit.committedAt,
      manifestSeq: exhibit.manifestSeq,
      anchored: exhibit.manifestSeq !== null,
      exists: store.existsRelative(exhibit.path)
    }
    rows.push(row)
  }

  for (const derived of listDerivedFilesForCase(caseId)) {
    const row: InventoryDerivedFileRow = {
      rowType: 'anchored',
      entity: 'derived-file',
      id: derived.id,
      caseId,
      parentExhibitId: derived.exhibitId,
      derivation: derived.derivation,
      toolVersion: derived.toolVersion,
      // A Derived File has no recorded display name of its own: it is cited by
      // its parent and its derivation (X31), so that pair IS the name.
      name: derived.derivation,
      contentHash: derived.contentHash,
      path: derived.path,
      sizeBytes: null,
      createdAt: derived.createdAt,
      manifestSeq: derived.manifestSeq,
      anchored: derived.manifestSeq !== null,
      exists: store.existsRelative(derived.path)
    }
    rows.push(row)
  }

  for (const staged of listStagingFiles(caseId)) {
    const row: InventoryStagedRow = {
      rowType: 'staged',
      entity: 'staged-file',
      id: staged.id,
      caseId: staged.caseId,
      kind: staged.kind,
      origin: staged.origin,
      name: staged.name,
      contentHash: staged.contentHash,
      path: staged.path,
      sizeBytes: staged.sizeBytes,
      arrivedAt: staged.arrivedAt,
      sourceUrl: staged.sourceUrl,
      exists: store.existsRelative(staged.path)
    }
    rows.push(row)
  }

  return { caseId, rows }
}

// SHA-256 of a PEM public key's DER SubjectPublicKeyInfo. Fingerprinting the
// key material rather than the PEM text means the same key reported through two
// encodings fingerprints the same. Null on an unparseable key: a segment with
// no readable signer is stated as such, never attributed to the local key by
// default.
function fingerprintPem(pem: string): string | null {
  try {
    const der = createPublicKey(pem).export({ type: 'spki', format: 'der' })
    return createHash('sha256').update(der).digest('hex')
  } catch {
    return null
  }
}

// One signer segment per stretch of chain verified under one key (X36).
//
// The segmentation mirrors verify-core's key rule exactly: an `import` entry's
// embedded key covers everything strictly BEFORE it, and the entries after the
// last boundary verify under the local key. A Case that arrived by archive
// import therefore yields two segments, and a multi-hop A -> B -> C import
// yields three. Reporting one unspecified signer for such a chain would
// describe it wrongly, which is why this is never a single field.
//
// Call this ONLY on a chain that verified. The boundaries come out of `import`
// entries' `sourcePublicKeyPem`, and on a chain that did not verify those lines
// are unverified input — verify-core's own invariant is that nothing an
// unverified line says may influence a verdict, and custody attribution is what
// a reader takes off this. `getManifestSnapshot` holds that gate.
export function signerSegments(
  entries: ManifestSnapshotEntry[],
  localPem: string
): ManifestSignerSegment[] {
  const total = entries.length
  if (total === 0) return []

  const boundaries: Array<{ index: number; pem: string }> = []
  for (const entry of entries) {
    if (entry.parsed && entry.entry.type === 'import') {
      boundaries.push({ index: entry.index, pem: entry.entry.sourcePublicKeyPem })
    }
  }

  const segments: ManifestSignerSegment[] = []
  let from = 0
  for (const boundary of boundaries) {
    // The boundary entry itself is signed by the IMPORTING installation, so it
    // belongs to the segment AFTER it, not to the one its key closes.
    if (boundary.index > from) {
      segments.push({
        fromIndex: from,
        toIndex: boundary.index - 1,
        fingerprint: fingerprintPem(boundary.pem),
        source: 'embedded'
      })
    }
    from = boundary.index
  }
  if (from <= total - 1) {
    segments.push({
      fromIndex: from,
      toIndex: total - 1,
      fingerprint: fingerprintPem(localPem),
      source: 'local'
    })
  }
  return segments
}

function parseEntries(raw: Record<string, unknown>[]): ManifestSnapshotEntry[] {
  return raw.map((line, index) => {
    const result = ManifestEntrySchema.safeParse(line)
    if (result.success) {
      const entry: ManifestEntry = result.data
      return { index, parsed: true, entry }
    }
    // Named, not dropped. A line this build cannot type is often a line from a
    // newer schema, which the chain verdict below reports as "verifier too
    // old" — the reader needs the position to line the two up.
    return { index, parsed: false, reason: 'Entry does not match the manifest schema' }
  })
}

function toVerdict(chain: ChainVerifyResult): ManifestChainVerdict {
  return {
    valid: chain.valid,
    ...(chain.brokenAt !== undefined ? { brokenAt: chain.brokenAt } : {}),
    ...(chain.reason !== undefined ? { reason: chain.reason } : {}),
    ...(chain.unsupported !== undefined ? { unsupported: chain.unsupported } : {})
  }
}

// The Case's manifest as the Data screen reads it (X36): typed entries, the
// chain verdict, and one signer fingerprint per signing
// segment. The verdict is passed through whole — including `unsupported`, which
// a caller MUST render as its own outcome and never as tampering (X25).
export function getManifestSnapshot(
  caseId: string,
  store: CaptureStore = defaultCaptureStore
): CaseManifestSnapshot {
  const caseDir = store.caseDir(caseId)
  // ONE read, shared by the typed entries, the verdict and the head reference.
  // `readManifestSnapshot`'s contract says a caller needing more than one of
  // these takes a single snapshot: a second read could see an append the first
  // did not, and the three halves of this payload would then describe
  // different manifest states.
  const snapshot = readManifestSnapshot(caseDir)
  const entries = parseEntries(snapshot.entries)
  const chain = verifyManifestChainText(snapshot.jsonl.toString('utf-8'), {
    publicKeyPem: getPublicKeyPem()
  })
  return {
    caseId,
    entries,
    chain: toVerdict(chain),
    // No segments off a chain that did not verify: the keys they would be built
    // from are unverified lines, and a reader attributing custody to them would
    // be taking a forger's word for who signed what. The verdict says why.
    signers: chain.valid ? signerSegments(entries, getPublicKeyPem()) : [],
    head: snapshot.head
  }
}

async function hashFile(path: string): Promise<string> {
  const hasher = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const rs = createReadStream(path)
    rs.on('data', (chunk) => hasher.update(chunk))
    rs.on('end', () => resolve())
    rs.on('error', reject)
  })
  return hasher.digest('hex')
}

// The verified line at `index`, or undefined when the chain did not verify or
// the line is not one this build can type. Reading the raw snapshot is safe
// only AFTER the chain verified: every line up to the head is then covered by
// the signatures, and an unparsed line is one from a newer schema.
function verifiedEntryAt(
  snapshot: ReturnType<typeof readManifestSnapshot>,
  chain: ChainVerifyResult,
  index: number | null
): ManifestEntry | undefined {
  if (!chain.valid || index === null) return undefined
  const line = snapshot.entries[index]
  if (!line) return undefined
  const parsed = ManifestEntrySchema.safeParse(line)
  return parsed.success ? parsed.data : undefined
}

// The `derivation` entries a verified chain carries, reduced to the three
// fields a binding may read. Empty when the chain did not verify: every line is
// then unverified input, and binding a Derived File to one would take a
// forger's word for what the bytes should be.
function verifiedDerivations(
  snapshot: ReturnType<typeof readManifestSnapshot>,
  chain: ChainVerifyResult
): DerivationEntryFacts[] {
  if (!chain.valid) return []
  const facts: DerivationEntryFacts[] = []
  for (const line of snapshot.entries) {
    const parsed = ManifestEntrySchema.safeParse(line)
    if (!parsed.success || parsed.data.type !== 'derivation') continue
    const { parentExhibitId, outputPath, outputHash } = parsed.data
    facts.push({ parentExhibitId, outputPath, outputHash })
  }
  return facts
}

// One outcome per Derived File (X37). The recorded hash is compared against
// the `derivation` entry the chain vouches for, never against the row alone:
// the row is a mirror written in the same seam, and a mirror is what #234
// showed cannot vouch for bytes. An unanchored file (X34) is reported as such.
//
// Which entry vouches is decided by `bindDerivedFile` (#1156, D7) — the same
// predicate the standalone package verifier uses, so the app and the verifier
// cannot disagree about the same bytes. It replaces a lookup by the row's
// manifest index alone, which was the advisory left open on PR #1469: an index
// says where an entry sits, never that the entry is about this file.
async function verifyDerivedFiles(
  exhibit: Exhibit,
  store: CaptureStore,
  snapshot: ReturnType<typeof readManifestSnapshot>,
  chain: ChainVerifyResult
): Promise<DerivedFileVerification[]> {
  const entries = verifiedDerivations(snapshot, chain)
  const imports = importEntriesOf(snapshot)
  const caseDir = store.caseDir(exhibit.caseId)
  // The entry names the parent through the Case's custody records rather than
  // by bare id equality, the same resolution `verifyExhibit` gives an Exhibit:
  // an archive import keeps the source's id on the entry and only the anchored
  // id map may reconcile the two.
  const parentMatches = (entryParentExhibitId: string): boolean =>
    entryDescribesRow(
      { caseId: exhibit.caseId, rowId: entryParentExhibitId },
      exhibit,
      imports,
      caseDir
    )

  const results: DerivedFileVerification[] = []
  for (const file of listDerivedFilesForExhibit(exhibit.id)) {
    const base = { derivedFileId: file.id, derivation: file.derivation }
    let computed: string
    try {
      computed = await hashFile(store.resolveAbsolute(file.path))
    } catch {
      results.push({ ...base, status: 'missing', reason: 'Derived file unreadable' })
      continue
    }
    const bound = bindDerivedFile(
      { parentExhibitId: exhibit.id, storedPath: file.path, computedHash: computed },
      entries,
      { parentMatches }
    )
    if (bound.status === 'unanchored') {
      results.push({
        ...base,
        status: 'unverified',
        reason:
          file.manifestSeq === null
            ? 'No manifest entry anchors this derived file'
            : 'Derived file is not anchored in the verified chain'
      })
      continue
    }
    results.push({ ...base, status: bound.status })
  }
  return results
}

/**
 * Every Derived File a Case holds, verified in ONE pass (X37): one manifest
 * read and one chain verification for the whole Case, keyed by parent Exhibit.
 * The export path needs an outcome per Derived File across every kind, and
 * calling `verifyExhibit` per Exhibit to get it would re-read and re-verify the
 * chain once per Exhibit — and could resolve two Exhibits against two different
 * reads of a manifest the timestamp worker appends to.
 */
export async function verifyCaseDerivedFiles(
  caseId: string,
  store: CaptureStore = defaultCaptureStore
): Promise<Map<string, DerivedFileVerification[]>> {
  const byExhibitId = new Map<string, DerivedFileVerification[]>()
  const exhibits = listExhibits(caseId)
  if (exhibits.length === 0) return byExhibitId
  const snapshot = readManifestSnapshot(store.caseDir(caseId))
  const chain = verifyManifestChainText(snapshot.jsonl.toString('utf-8'), {
    publicKeyPem: getPublicKeyPem()
  })
  for (const exhibit of exhibits) {
    const results = await verifyDerivedFiles(exhibit, store, snapshot, chain)
    if (results.length > 0) byExhibitId.set(exhibit.id, results)
  }
  return byExhibitId
}

// Verify one Exhibit (X37). `capture` delegates to the Capture path and returns
// its result untouched, so `exhibits:verify` and `captures:verify` cannot drift
// apart. Every other kind (#1148) hashes the stored bytes and binds them to the
// `exhibit` entry at the row's manifest index on a verified chain — the same
// statuses a Capture gets, plus `unsupported` for a chain this build cannot
// read (X25), which is never reported as tampering. A verify-all is the caller
// running this per Exhibit in sequence — there is deliberately no batch
// channel.
export async function verifyExhibit(
  caseId: string,
  exhibitId: string,
  store: CaptureStore = defaultCaptureStore
): Promise<ExhibitVerification> {
  const exhibit = getExhibit(exhibitId)
  if (!exhibit || exhibit.caseId !== caseId) {
    return {
      exhibitId,
      caseId,
      kind: 'unknown',
      status: 'missing',
      reason: 'Exhibit not found in this case'
    }
  }
  const snapshot = readManifestSnapshot(store.caseDir(caseId))
  const chain = verifyManifestChainText(snapshot.jsonl.toString('utf-8'), {
    publicKeyPem: getPublicKeyPem()
  })
  const derived = await verifyDerivedFiles(exhibit, store, snapshot, chain)
  const base = { exhibitId, caseId, kind: exhibit.kind, derived }

  if (exhibit.kind === 'capture') {
    const capture = await verifyCapture(exhibitId, store)
    return {
      ...base,
      status: capture.status,
      ...(capture.reason !== undefined ? { reason: capture.reason } : {}),
      capture
    }
  }

  if (!exhibit.path) {
    return { ...base, status: 'missing', reason: 'No stored file recorded for this exhibit' }
  }
  let computed: string
  try {
    computed = await hashFile(store.resolveAbsolute(exhibit.path))
  } catch (err) {
    return { ...base, status: 'missing', reason: 'Exhibit file unreadable: ' + String(err) }
  }
  if (chain.unsupported) {
    return {
      ...base,
      status: 'unsupported',
      reason: 'Manifest holds an entry from a newer schema; this verifier is too old to read it'
    }
  }
  if (!chain.valid) {
    return { ...base, status: 'chain-broken', reason: chain.reason }
  }
  const entry = verifiedEntryAt(snapshot, chain, exhibit.manifestSeq)
  // The entry names the row through the case's custody records, not by bare id
  // equality: an archive import keeps the source's `exhibitId` on the entry and
  // remaps a colliding row id, and only the id map the `import` entry anchors
  // may reconcile the two (the same binding a Capture gets).
  if (
    !entry ||
    entry.type !== 'exhibit' ||
    entry.contentHash !== exhibit.contentHash ||
    !entryDescribesRow(
      { caseId: entry.caseId, rowId: entry.exhibitId },
      exhibit,
      importEntriesOf(snapshot),
      store.caseDir(caseId)
    )
  ) {
    return { ...base, status: 'chain-broken', reason: 'Exhibit not anchored in manifest chain' }
  }
  return { ...base, status: computed === entry.contentHash ? 'verified' : 'tampered' }
}
