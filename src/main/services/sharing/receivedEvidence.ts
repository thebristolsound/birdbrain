import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { ManifestEntry } from '@shared/schemas'
import type { CaseMember, SyncErrorKind } from '@shared/types'
import { withTransaction } from '@main/services/db/core'
import * as captureRepo from '@main/services/db/captureRepo'
import type { InsertCaptureParams } from '@main/services/db/captureRepo'
import {
  getExhibit,
  insertExhibit,
  listExhibits,
  type InsertExhibitParams
} from '@main/services/db/exhibitRepo'
import {
  insertDerivedFile,
  listDerivedFilesForExhibit,
  type InsertDerivedFileParams
} from '@main/services/db/derivedFileRepo'
import { deletedCaptureCase, recordChainDeletion } from '@main/services/db/workingRowRepo'
import {
  idsReachingMembers,
  readChainFileSnapshots,
  readManifestSnapshot
} from '@main/services/manifest'
import { readMhtmlTitle } from '@main/services/mhtmlDecoder'
import type { CaptureArtifactType, CaptureStore } from '@main/services/captureStore'
import type { CaptureLifecycle } from '@main/services/captureLifecycle'
import { safeCasePath } from '@main/services/sharing/blobAcceptance'
import { isExhibitId, storedEntries } from '@main/services/sharing/entryAcceptance'
import type { SyncError } from '@main/services/sharing/session'

// Received evidence (#1811): turns the Captures, Exhibits and Derived Files another member's
// stored chain anchors into this replica's rows, and applies that member's deletions. A row is
// written only once every file its entry anchors is on disk and hashes to what the entry states,
// so every received row's files verify against its author's chain. The rows of one session go
// into one transaction; an entry no session could ever write (an id or Exhibit Number held by
// another row, no number at all) is refused on its own before it opens, the way workingRows.ts
// refuses a row before the working-layer transaction.

export type ReceivedCaptures = Pick<CaptureLifecycle, 'processReceived' | 'removeReceived'>

export interface ApplyReceivedEvidenceParams {
  caseId: string
  storageRoot: string
  self: string
  roster: CaseMember[]
  store: CaptureStore
  receivedCaptures: ReceivedCaptures
}

export interface ReceivedEvidenceResult {
  capturesInserted: string[]
  exhibitsInserted: string[]
  derivedFilesInserted: number
  removed: string[]
  errors: SyncError[]
}

type CaptureEntry = Extract<ManifestEntry, { type: 'capture' }>
type ExhibitEntry = Extract<ManifestEntry, { type: 'exhibit' }>
type DerivationEntry = Extract<ManifestEntry, { type: 'derivation' }>

interface MemberChain {
  author: string
  memberCode: string | undefined
  entries: ManifestEntry[]
}

interface PlannedCapture {
  params: InsertCaptureParams & { id: string }
  textContent: string | undefined
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

// Entries from the chain's last `import` on: the earlier ones are a source Case's history, whose
// files the file step does not fetch (anchoredFiles).
function currentSegment(entries: ManifestEntry[]): ManifestEntry[] {
  const lastImport = entries.reduce((at, e) => (e.type === 'import' ? e.index : at), 0)
  return entries.filter((e) => e.index >= lastImport)
}

export async function applyReceivedEvidence(
  params: ApplyReceivedEvidenceParams
): Promise<ReceivedEvidenceResult> {
  const { caseId, storageRoot, self, roster, store, receivedCaptures } = params
  const result: ReceivedEvidenceResult = {
    capturesInserted: [],
    exhibitsInserted: [],
    derivedFilesInserted: 0,
    removed: [],
    errors: []
  }
  const refuse = (kind: SyncErrorKind, author: string, index: number, detail: string): void => {
    result.errors.push({ kind, detail, installationId: author, index })
  }
  const codes = new Map(roster.map((m) => [m.installationId, m.memberCode]))
  const chains: MemberChain[] = readChainFileSnapshots(join(storageRoot, caseId))
    .filter((chain) => chain.sourceCaseId === undefined && chain.installationId !== self)
    .map((chain) => ({
      author: chain.installationId,
      memberCode: codes.get(chain.installationId),
      entries: currentSegment(storedEntries(chain.jsonl))
    }))

  // Removals first, so a Capture deleted and re-planned in one pass cannot collide with itself.
  for (const { author, entries } of chains) {
    for (const entry of entries) {
      // removeReceived builds the paths it removes from the id. Every row this step writes has a
      // well-formed one, but an imported archive's rows keep the archive's ids.
      if (entry.type !== 'deletion' || !isExhibitId(entry.captureId)) continue
      const row = getExhibit(entry.captureId)
      if (row?.caseId !== caseId || row.authorInstallationId !== author) continue
      if (await receivedCaptures.removeReceived(entry.captureId)) {
        result.removed.push(entry.captureId)
      }
    }
  }

  // Deleted Captures this replica never held, or deleted before migration 41 (#1877): a
  // `deletion` whose Capture the same chain's current segment creates, read from every member
  // chain and from this installation's own, recorded so the rows other members keep on it are
  // accepted rather than held back as rows on a Capture that has not arrived. The removals
  // above recorded the ones they made; a Capture this replica holds is not recorded here.
  // A record is never dropped, whatever another chain claims. Entry acceptance has no rule
  // across chains, so this copy cannot tell an author's `capture` and `deletion` from a
  // member's copy of that author's id, nor a member's `capture` of a deleted id from the
  // author's own. Letting a claim undo a record would attach the rows other members keep on
  // the deleted Capture to the claimant's page. The cost of keeping it: a member's copied pair
  // keeps a live Capture off a copy that has not landed it yet.
  const ownChain = currentSegment(
    storedEntries(readManifestSnapshot(join(storageRoot, caseId)).jsonl)
  )
  withTransaction(() => {
    for (const { author, entries } of [{ author: self, entries: ownChain }, ...chains]) {
      const created = idsReachingMembers(entries)
      for (const entry of entries) {
        if (entry.type !== 'deletion') continue
        const id = entry.captureId
        if (!isExhibitId(id) || !created.has(id)) continue
        if (getExhibit(id) || captureRepo.getCapture(id)) continue
        recordChainDeletion(id, caseId, author === self ? null : author)
      }
    }
  })

  // Exhibit Numbers are per author: the unique index is (Case, author, number).
  const numberKey = (author: string, n: number): string => `${author}\u0000${n}`
  const numbers = new Map<string, string>()
  for (const exhibit of listExhibits(caseId)) {
    if (exhibit.authorInstallationId === null) continue
    numbers.set(numberKey(exhibit.authorInstallationId, exhibit.exhibitNumber), exhibit.id)
  }
  const claimed = new Set<string>()
  // 'own' is a row this author's entry already wrote; 'held' is any other row with the id;
  // 'deleted' names a Capture deleted from a Shared Case, whose id stays dead so the rows other
  // members keep on it can never attach to another page (#1877).
  const idState = (id: string, author: string): 'free' | 'own' | 'held' | 'deleted' => {
    if (claimed.has(id)) return 'held'
    const exhibit = getExhibit(id)
    if (exhibit) {
      return exhibit.caseId === caseId && exhibit.authorInstallationId === author ? 'own' : 'held'
    }
    if (captureRepo.getCapture(id)) return 'held'
    return deletedCaptureCase(id) === undefined ? 'free' : 'deleted'
  }
  // Why an entry's id or number cannot be written, or null; 'skip' when its row exists.
  const claimProblem = (id: string, author: string, n: number): string | 'skip' | null => {
    const state = idState(id, author)
    if (state === 'own') return 'skip'
    if (state === 'held') return `id ${id} is already held by another row`
    if (state === 'deleted') return `id ${id} names a deleted Capture`
    const holder = numbers.get(numberKey(author, n))
    if (holder !== undefined && holder !== id) {
      return `Exhibit Number ${n} is already held by ${holder}`
    }
    return null
  }
  const claim = (id: string, author: string, n: number): void => {
    claimed.add(id)
    numbers.set(numberKey(author, n), id)
  }

  // The bytes of each anchored file, or 'absent' while one has not arrived, or 'mismatch' after
  // reporting it. Absence is checked for every file before any is read.
  const readAnchored = async (
    files: Array<{ rel: string; abs: string; hash: string }>,
    author: string,
    index: number
  ): Promise<Buffer[] | 'absent' | 'mismatch'> => {
    if (files.some(({ abs }) => !existsSync(abs))) return 'absent'
    const bytes: Buffer[] = []
    for (const { rel, abs, hash } of files) {
      const read = await readFile(abs)
      const actual = sha256(read)
      if (actual !== hash) {
        refuse('hash-mismatch', author, index, `${rel}: expected ${hash}, found ${actual}`)
        return 'mismatch'
      }
      bytes.push(read)
    }
    return bytes
  }

  const plannedCaptures: PlannedCapture[] = []
  const plannedExhibits: InsertExhibitParams[] = []
  const plannedDerived: InsertDerivedFileParams[] = []

  async function planCapture(
    { author, memberCode }: MemberChain,
    entry: CaptureEntry,
    renumber: number | undefined
  ): Promise<PlannedCapture | null> {
    const { captureId: id, index } = entry
    const n = entry.exhibitNumber ?? renumber
    if (memberCode === undefined) {
      refuse('rejected-entry', author, index, `capture ${id}: author has no Member Code`)
      return null
    }
    if (n === undefined) {
      refuse('rejected-entry', author, index, `capture ${id}: no Exhibit Number`)
      return null
    }
    const problem = claimProblem(id, author, n)
    if (problem === 'skip') return null
    if (problem !== null) {
      refuse('rejected-entry', author, index, `capture ${id}: ${problem}`)
      return null
    }
    const artifact = (type: CaptureArtifactType, hash: string) => ({
      ...store.artifactPaths(caseId, id, type),
      hash
    })
    const mhtml = artifact('mhtml', entry.contentHash)
    const png = entry.screenshotHash ? artifact('png', entry.screenshotHash) : undefined
    const txt = entry.textHash ? artifact('txt', entry.textHash) : undefined
    const files = [mhtml, ...(png ? [png] : []), ...(txt ? [txt] : [])]
    const bytes = await readAnchored(files, author, index)
    if (!Array.isArray(bytes)) return null
    const [page] = bytes
    const title = readMhtmlTitle(page) ?? entry.url
    const textContent = txt ? bytes[bytes.length - 1].toString('utf-8') : undefined
    claim(id, author, n)
    return {
      textContent,
      params: {
        id,
        caseId,
        url: entry.url,
        title,
        hash: entry.contentHash,
        timestamp: entry.timestamp,
        headers: entry.headers ? JSON.stringify(entry.headers) : undefined,
        textContent,
        format: 'mhtml',
        mhtmlPath: mhtml.rel,
        screenshotPath: png?.rel,
        screenshotHash: entry.screenshotHash,
        textHash: entry.textHash,
        tlsCertChain: entry.tls ? JSON.stringify(entry.tls) : undefined,
        sizeBytes: entry.sizeBytes,
        manifestIndex: index,
        prevHash: entry.prevHash,
        entryHash: entry.entryHash,
        toolVersion: entry.toolVersion,
        userAgent: entry.userAgent,
        httpStatus: entry.httpStatus,
        operatorId: entry.operatorId,
        operatorName: entry.operatorName,
        method: entry.method,
        supersedesCaptureId: entry.supersedesCaptureId,
        duplicateOfCaptureId: entry.duplicateOfCaptureId,
        linkedFromCaptureId: entry.linkedFromCaptureId,
        linkedFromContentHash: entry.linkedFromContentHash,
        linkHref: entry.linkHref,
        consentSuppression: entry.consentSuppression,
        exhibitNumber: n,
        author: { installationId: author, memberCode },
        committedAt: entry.timestamp
      }
    }
  }

  async function planExhibit(
    { author, memberCode }: MemberChain,
    entry: ExhibitEntry
  ): Promise<InsertExhibitParams | null> {
    const { exhibitId: id, index, exhibitNumber: n } = entry
    if (memberCode === undefined) {
      refuse('rejected-entry', author, index, `exhibit ${id}: author has no Member Code`)
      return null
    }
    // The Shared Case walk reports an entry claiming a code other than its writer's as a
    // citation-collision (sharedCase.ts), so it gets no row here.
    if (entry.memberCode !== undefined && entry.memberCode !== memberCode) {
      const detail = `exhibit ${id}: claims Member Code ${entry.memberCode}, its author's is ${memberCode}`
      refuse('rejected-entry', author, index, detail)
      return null
    }
    const problem = claimProblem(id, author, n)
    if (problem === 'skip') return null
    if (problem !== null) {
      refuse('rejected-entry', author, index, `exhibit ${id}: ${problem}`)
      return null
    }
    const abs = safeCasePath(storageRoot, caseId, entry.path)
    if (abs === null) {
      refuse('rejected-entry', author, index, `${entry.path}: not a path inside this Case`)
      return null
    }
    const bytes = await readAnchored(
      [{ rel: entry.path, abs, hash: entry.contentHash }],
      author,
      index
    )
    if (!Array.isArray(bytes)) return null
    claim(id, author, n)
    return {
      id,
      caseId,
      kind: entry.kind,
      origin: entry.origin,
      name: entry.name,
      contentHash: entry.contentHash,
      path: entry.path,
      sizeBytes: entry.sizeBytes,
      committedAt: entry.timestamp,
      manifestSeq: index,
      exhibitNumber: n,
      author: { installationId: author, memberCode }
    }
  }

  async function planDerivation(
    { author }: MemberChain,
    entry: DerivationEntry,
    planned: Map<string, string>
  ): Promise<InsertDerivedFileParams | null> {
    const { parentExhibitId: parent, index } = entry
    const held = getExhibit(parent)
    const parentHash =
      planned.get(parent) ??
      (held?.caseId === caseId && held.authorInstallationId === author
        ? held.contentHash
        : undefined)
    if (parentHash !== entry.parentContentHash) return null
    const path = entry.outputPath.replace(/\\/g, '/')
    const recorded = (d: { derivation: string; contentHash: string }): boolean =>
      d.derivation === entry.derivation && d.contentHash === entry.outputHash
    if (listDerivedFilesForExhibit(parent).some(recorded)) return null
    if (plannedDerived.some((d) => d.exhibitId === parent && recorded(d))) return null
    const abs = safeCasePath(storageRoot, caseId, path)
    if (abs === null) {
      refuse('rejected-entry', author, index, `${entry.outputPath}: not a path inside this Case`)
      return null
    }
    const bytes = await readAnchored([{ rel: path, abs, hash: entry.outputHash }], author, index)
    if (!Array.isArray(bytes)) return null
    return {
      exhibitId: parent,
      derivation: entry.derivation,
      toolVersion: entry.derivationToolVersion,
      contentHash: entry.outputHash,
      path,
      createdAt: entry.timestamp,
      manifestSeq: index
    }
  }

  for (const chain of chains) {
    const { entries } = chain
    const deleted = new Set(entries.flatMap((e) => (e.type === 'deletion' ? [e.captureId] : [])))
    const renumbered = new Map<string, number>()
    for (const entry of entries) {
      if (entry.type !== 'renumber') continue
      for (const { exhibitId, exhibitNumber } of entry.assignments) {
        renumbered.set(exhibitId, exhibitNumber)
      }
    }
    // This author's Exhibits planned in this pass, by id with their Content Hash: parents a
    // derivation may name beside the ones already held.
    const parents = new Map<string, string>()
    for (const entry of entries) {
      if (entry.type === 'capture' && !deleted.has(entry.captureId)) {
        const planned = await planCapture(chain, entry, renumbered.get(entry.captureId))
        if (planned) {
          plannedCaptures.push(planned)
          parents.set(entry.captureId, entry.contentHash)
        }
      } else if (entry.type === 'exhibit' && !deleted.has(entry.exhibitId)) {
        const planned = await planExhibit(chain, entry)
        if (planned) {
          plannedExhibits.push(planned)
          parents.set(entry.exhibitId, entry.contentHash)
        }
      }
    }
    for (const entry of entries) {
      if (entry.type !== 'derivation' || deleted.has(entry.parentExhibitId)) continue
      const planned = await planDerivation(chain, entry, parents)
      if (planned) plannedDerived.push(planned)
    }
  }

  withTransaction(() => {
    for (const { params } of plannedCaptures) captureRepo.insertCapture(params)
    for (const exhibit of plannedExhibits) insertExhibit(exhibit)
    for (const derived of plannedDerived) insertDerivedFile(derived)
  })
  result.capturesInserted = plannedCaptures.map(({ params }) => params.id)
  result.exhibitsInserted = plannedExhibits.map(({ id }) => id)
  result.derivedFilesInserted = plannedDerived.length

  for (const { params, textContent } of plannedCaptures) {
    receivedCaptures.processReceived(params, textContent)
  }
  return result
}
