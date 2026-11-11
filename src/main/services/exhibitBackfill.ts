import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { readFile, writeFile, rm } from 'fs/promises'
import { listAllCaseIds } from '@main/services/db/caseRepo'
import {
  backfillExhibitsForCaptures,
  getExhibit,
  listExhibits
} from '@main/services/db/exhibitRepo'
import {
  awaitingRenumber,
  hasRenumberEntry,
  nextExhibitNumber
} from '@main/services/exhibitNumbering'
import { hasDerivation, insertDerivedFile } from '@main/services/db/derivedFileRepo'
import {
  appendManifestEntry,
  initManifest,
  readCaseChains,
  readManifestSnapshot,
  withManifestEntry,
  type AuthorChain,
  type CaptureChainEntry
} from '@main/services/manifest'
import { rowDescriber } from '@main/services/captureLifecycle'
import { defaultCaptureStore, type CaptureStore } from '@main/services/captureStore'
import { trimmedOperatorName } from '@main/services/operatorName'
import { getInstallationId } from '@main/services/installationId'
import { renderThumbnail } from '@main/services/thumbnails'
import { logger } from '@main/services/logger'
import { ident } from '@main/services/logSafe'
import { ManifestEntrySchema } from '@shared/schemas'
import type { Exhibit } from '@shared/types'
import { inCasePath } from '../../packages/evidence-package-layout/index'

// The one-time data half of the Exhibit-model migration (#1147, X18/X34/X41).
//
// It is NOT in `migrations.ts`, and that is a sequencing fact rather than a
// preference: `runMigrations` is handed a database connection and nothing else,
// and it runs inside `initDatabase`, which `src/main/index.ts` awaits BEFORE
// the settings store, the signing key and the storage root exist. Appending to
// the chain needs all three, and regenerating a thumbnail needs sharp and the
// filesystem. So the v34 block writes the `exhibits` rows in SQL — it can,
// because the ordering it needs is already on the `captures` row — and this
// runs afterwards to put the assignment into the chain and to anchor the
// thumbnails.
//
// Every step is idempotent, keyed on what the database already holds: an
// existing `exhibits` row, an existing `renumber` entry for the Case, an
// existing `derived_files` row for the derivation. A reopen therefore appends
// nothing, which is what keeps a Case's chain from growing one entry per
// launch. Where a step writes both a signed entry and a row, the chain is
// consulted as well as the database, so a run interrupted between the two
// cannot be answered by signing the entry a second time.

// The derivation name for a Capture's list thumbnail. Matches the file suffix
// the Capture Store has always used (`_thumb.jpg`).
export const THUMBNAIL_DERIVATION = 'thumbnail'

export interface ExhibitBackfillDeps {
  store?: CaptureStore
  toolVersion: string
}

export interface ExhibitBackfillCaseResult {
  caseId: string
  // Exhibit rows this run created (0 on a database the v34 migration handled).
  exhibitsCreated: number
  // Whether a `renumber` entry was appended for this Case on this run.
  renumbered: boolean
  // Derived-file rows created, split by whether the chain covers them.
  thumbnailsAnchored: number
  thumbnailsUnanchored: number
  // Set when the Case needed a signed entry and none could be signed (X47): its chain is left
  // as it was, and it is backfilled again once a name is saved. The thumbnail counts are 0
  // unless a screenshot began to verify after rows that sign nothing were recorded.
  skipped?: 'operator_name_required'
}

interface Operator {
  operatorId: string
  operatorName: string
  toolVersion: string
}

function operator(operatorName: string, toolVersion: string): Operator {
  return { operatorId: getInstallationId(), operatorName, toolVersion }
}

// Appends the Case's single `renumber` entry (X18), listing the Exhibits
// `awaitingRenumber` returns in number order. `manifestIndex` is OMITTED for a
// Capture with no Manifest Entry, which is how the chain records that its
// number is a citation aid and not an anchoring claim (X41).
function appendRenumberEntry(
  caseId: string,
  caseDir: string,
  exhibits: Exhibit[],
  who: Operator
): void {
  initManifest(caseDir)
  appendManifestEntry(caseDir, {
    type: 'renumber',
    caseId,
    assignments: exhibits.map((exhibit) => ({
      exhibitId: exhibit.id,
      exhibitNumber: exhibit.exhibitNumber,
      ...(exhibit.manifestSeq !== null ? { manifestIndex: exhibit.manifestSeq } : {})
    })),
    timestamp: new Date().toISOString(),
    ...who
  })
}

// A `derivation` entry already on the chain, as the backfill needs to see it.
interface PriorDerivation {
  index: number
  outputHash: string
}

// The output path is part of the key because a parent id alone does not name
// one file: a renamed import inherits the source's entry under the same parent
// id, and that entry describes the source's file, not the row's (#1814).
function derivationKey(exhibitId: string, derivation: string, outputPath: string): string {
  return `${exhibitId}\u0000${derivation}\u0000${inCasePath(outputPath)}`
}

// The `derivation` entries this Case's chain already carries, keyed by parent
// Exhibit, derivation name and in-Case output path.
//
// Read leniently, for the same reason `hasRenumberEntry` is: the question is
// "was one already appended", and the answer has to be yes even on a chain that
// does not verify. Nothing read here is treated as evidence — the index and
// hash decide only whether a database row lost to a kill can be re-recorded
// instead of a second entry being signed, and the bytes still have to hash to
// `outputHash` before that row is called anchored.
function priorDerivations(caseDir: string): Map<string, PriorDerivation> {
  const found = new Map<string, PriorDerivation>()
  for (const line of readManifestSnapshot(caseDir).entries) {
    if (line.type !== 'derivation') continue
    const { parentExhibitId, derivation, outputPath, outputHash, index } = line
    if (
      typeof parentExhibitId !== 'string' ||
      typeof derivation !== 'string' ||
      typeof outputPath !== 'string' ||
      typeof outputHash !== 'string' ||
      typeof index !== 'number'
    ) {
      continue
    }
    found.set(derivationKey(parentExhibitId, derivation, outputPath), { index, outputHash })
  }
  return found
}

// Everything a `derivation` entry for a Capture's thumbnail may be written
// against, and it all comes out of the SAME verified `capture` entry.
interface VerifiedParent {
  // The screenshot the thumbnail is computed from.
  screenshot: Buffer
  // The parent Exhibit's content hash, for the entry's `parentContentHash`.
  contentHash: string
}

// The verified parent for a Capture, or undefined when the signed chain does
// not vouch for one: the entry at the Capture's manifest index must carry a
// `screenshotHash`, and the bytes on disk must hash to it.
//
// EVERY value returned here is read off the VERIFIED chain entry, never off the
// `captures`/`exhibits` DB mirrors — those columns are reachable through the
// Database Admin hatch, and a signed entry must not carry anything a hand edit
// can choose. That covers `contentHash` as much as it covers the screenshot
// check: `parentContentHash` is the entry's claim about which parent bytes the
// thumbnail came from, so taking it from `exhibits.content_hash` would let an
// edited mirror be signed into the chain as a fact about the parent.
//
// The screenshot half is X34. Hashing whatever `{id}.png` happens to hold and
// anchoring the thumbnail computed from it would put a swapped screenshot's
// derivative into the chain under this migration's signature, which is a
// stronger claim than the app is entitled to make about bytes it never saw
// arrive. Undefined here means "regenerate nothing and anchor nothing".
function verifiedParent(
  caseId: string,
  captureId: string,
  store: CaptureStore,
  chainEntry: CaptureChainEntry | undefined
): VerifiedParent | undefined {
  if (chainEntry?.screenshotHash === undefined) return undefined
  const bytes = store.readArtifact(caseId, captureId, 'png')
  if (!bytes) return undefined
  const computed = createHash('sha256').update(bytes).digest('hex')
  if (computed !== chainEntry.screenshotHash) return undefined
  return { screenshot: bytes, contentHash: chainEntry.contentHash }
}

// The id a `derivation` entry names the Capture by: the `captureId` of its own
// verified `capture` entry when an import renamed the row (#1814). Both package
// verifiers look a derivation's parent up among the ids active entries carry,
// so an entry signed under the row's new id names a parent no entry anchors.
// The rename is accepted only through `entryDescribesRow`'s rule, the custody
// records and the id map the import anchored, never through an editable row
// column. Any other row, a native Capture included, keeps its own id.
function signedParentId(
  exhibit: Exhibit,
  own: AuthorChain,
  describes: ReturnType<typeof rowDescriber>
): string {
  const { manifestSeq } = exhibit
  if (manifestSeq === null || !own.chain.captureEntriesByIndex.has(manifestSeq)) return exhibit.id
  const parsed = ManifestEntrySchema.safeParse(own.entries[manifestSeq])
  if (!parsed.success || parsed.data.type !== 'capture') return exhibit.id
  const { caseId, captureId } = parsed.data
  if (captureId === exhibit.id) return exhibit.id
  return describes({ caseId, rowId: captureId }, exhibit) ? captureId : exhibit.id
}

// One Capture whose thumbnail has no `derived_files` row yet, with what its
// `derivation` entry would be written against.
interface PendingThumbnail {
  exhibit: Exhibit
  parentId: string
  chainEntry: CaptureChainEntry | undefined
  prior: PriorDerivation | undefined
}

// The Case's Captures still owed a thumbnail row. Called after any renumber
// append: the verified read then covers the entry this run wrote, and a
// `derivation` entry an earlier run appended before its row landed is visible
// rather than duplicated. A broken chain yields no entries, so nothing is
// anchored, which is the right outcome: there is no signed screenshot hash to
// check a regeneration against.
function thumbnailsPending(
  exhibits: Exhibit[],
  store: CaptureStore,
  caseDir: string
): PendingThumbnail[] {
  const own = readCaseChains(caseDir).own
  const prior = priorDerivations(caseDir)
  const describes = rowDescriber(caseDir, own)
  const pending: PendingThumbnail[] = []
  for (const exhibit of exhibits) {
    if (exhibit.kind !== 'capture') continue
    // Another member's Capture: its `manifestSeq` indexes its author's chain, not this one, and
    // only its author signs a derivation for it (#1811).
    if (exhibit.authorInstallationId !== null) continue
    // Checked before the signed id is resolved, so a launch spends nothing on
    // a row that is already recorded.
    if (hasDerivation(exhibit.id, THUMBNAIL_DERIVATION)) continue
    const chainEntry =
      exhibit.manifestSeq === null
        ? undefined
        : own.chain.captureEntriesByIndex.get(exhibit.manifestSeq)
    const parentId = signedParentId(exhibit, own, describes)
    const { rel } = store.thumbnailPaths(exhibit.caseId, exhibit.id)
    pending.push({
      exhibit,
      parentId,
      chainEntry,
      // An entry for the row's own file, under either id: the signed one is what
      // this build writes, the row's own is what a build before #1814 wrote.
      prior:
        prior.get(derivationKey(parentId, THUMBNAIL_DERIVATION, rel)) ??
        prior.get(derivationKey(exhibit.id, THUMBNAIL_DERIVATION, rel))
    })
  }
  return pending
}

// Whether `backfillThumbnail` would sign a `derivation` entry for one of them:
// it has no entry on the chain yet and a parent the signed chain vouches for.
function wouldSignDerivation(
  { exhibit, chainEntry, prior }: PendingThumbnail,
  store: CaptureStore
): boolean {
  return (
    prior === undefined &&
    verifiedParent(exhibit.caseId, exhibit.id, store, chainEntry) !== undefined
  )
}

async function backfillThumbnail(
  { exhibit, parentId, chainEntry, prior }: PendingThumbnail,
  store: CaptureStore,
  who: Operator
): Promise<'anchored' | 'unanchored' | 'skipped' | 'deferred'> {
  const paths = store.thumbnailPaths(exhibit.caseId, exhibit.id)

  if (prior !== undefined) {
    // The chain already carries an entry for this file and parent, whoever
    // signed it: a previous run killed before its row landed is one source.
    // Re-record the row against the entry that is already signed rather than
    // signing a second one for the same Derived File, and do not regenerate:
    // the bytes the entry names are the ones on disk or they are not, and
    // overwriting them would only make a second entry look necessary.
    if (!existsSync(paths.abs)) return 'skipped'
    const bytes = await readFile(paths.abs)
    if (!getExhibit(exhibit.id)) return 'skipped'
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const anchored = contentHash === prior.outputHash
    insertDerivedFile({
      exhibitId: exhibit.id,
      derivation: THUMBNAIL_DERIVATION,
      toolVersion: who.toolVersion,
      contentHash,
      path: paths.rel,
      createdAt: new Date().toISOString(),
      manifestSeq: anchored ? prior.index : null
    })
    return anchored ? 'anchored' : 'unanchored'
  }

  const parent = verifiedParent(exhibit.caseId, exhibit.id, store, chainEntry)

  if (!parent) {
    // No trustworthy source. A thumbnail already on disk is still recorded, so
    // the inventory can show it and say it is not anchored; one that is not
    // there is not invented.
    if (!existsSync(paths.abs)) return 'skipped'
    const bytes = await readFile(paths.abs)
    if (!getExhibit(exhibit.id)) return 'skipped'
    insertDerivedFile({
      exhibitId: exhibit.id,
      derivation: THUMBNAIL_DERIVATION,
      toolVersion: who.toolVersion,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      path: paths.rel,
      createdAt: new Date().toISOString(),
      manifestSeq: null
    })
    return 'unanchored'
  }

  // The operator gate (X47), at the branch that signs: the Case-wide check ran on an earlier
  // read of this screenshot, and one that verifies only now was not counted there.
  if (!who.operatorName) return 'deferred'

  // The same renderer `getThumbnail` uses, not a second copy of the pipeline:
  // the entry appended below anchors these bytes, so a later regeneration from
  // the same parent screenshot has to reproduce them.
  const { bytes, parameters } = await renderThumbnail(parent.screenshot)
  if (!getExhibit(exhibit.id)) return 'skipped'
  try {
    await writeFile(paths.abs, bytes)
    if (!getExhibit(exhibit.id)) {
      await rm(paths.abs, { force: true })
      return 'skipped'
    }
    const outputHash = createHash('sha256').update(bytes).digest('hex')
    const timestamp = new Date().toISOString()

    // Through the write-ahead seam, not a bare append: if `insertDerivedFile`
    // throws, the entry is truncated back off the chain rather than left
    // describing a Derived File the database has no record of — which the next
    // launch would answer by signing a second entry for the same file.
    //
    // Dated at migration with the migration as the tool (X34): the bytes were
    // produced now, by this build, and dating them at the Capture's ingest would
    // be a claim about a file that did not exist then.
    await withManifestEntry(
      store.caseDir(exhibit.caseId),
      {
        type: 'derivation',
        caseId: exhibit.caseId,
        parentExhibitId: parentId,
        parentContentHash: parent.contentHash,
        derivation: THUMBNAIL_DERIVATION,
        derivationToolVersion: who.toolVersion,
        derivationParameters: parameters,
        outputHash,
        outputPath: paths.rel,
        timestamp,
        ...who
      },
      (appended) => {
        insertDerivedFile({
          exhibitId: exhibit.id,
          derivation: THUMBNAIL_DERIVATION,
          toolVersion: who.toolVersion,
          contentHash: outputHash,
          path: paths.rel,
          createdAt: timestamp,
          manifestSeq: appended.index
        })
      }
    )
  } catch (err) {
    try {
      await rm(paths.abs, { force: true })
    } catch (cleanupErr) {
      throw new AggregateError([err, cleanupErr], 'Thumbnail backfill and cleanup failed', {
        cause: cleanupErr
      })
    }
    throw err
  }
  return 'anchored'
}

async function backfillCaseInSlot(
  caseId: string,
  deps: ExhibitBackfillDeps
): Promise<ExhibitBackfillCaseResult> {
  const store = deps.store ?? defaultCaptureStore
  const operatorName = trimmedOperatorName()
  const who = operator(operatorName, deps.toolVersion)
  const caseDir = store.caseDir(caseId)
  const result: ExhibitBackfillCaseResult = {
    caseId,
    // Normally 0: the v34 migration covers every Capture that existed when it
    // ran, and both insert paths write the row with the Capture. Called anyway
    // so the backfill is total rather than conditional on which build created a
    // row, and through the shared helper so the numbering is X41's, starting
    // above every number the chain has issued (X45).
    exhibitsCreated: backfillExhibitsForCaptures(caseId, nextExhibitNumber(caseId, store)),
    renumbered: false,
    thumbnailsAnchored: 0,
    thumbnailsUnanchored: 0
  }

  const exhibits = listExhibits(caseId)
  if (exhibits.length === 0) return result

  const { entries } = readManifestSnapshot(caseDir)
  // At most one per Case, and none when every Exhibit's own entry carries its
  // number: a Case begun since X46 has nothing to renumber.
  const unnumbered = hasRenumberEntry(entries) ? [] : awaitingRenumber(exhibits, entries)
  if (!operatorName) {
    // A Case that needs a signed entry gets no thumbnail rows either, signed or
    // not, so the run once a name is saved does the Case in one pass. Any other
    // Case goes on below, where every row it has left signs nothing.
    const toSign =
      unnumbered.length > 0 ||
      thumbnailsPending(exhibits, store, caseDir).some((pending) =>
        wouldSignDerivation(pending, store)
      )
    if (toSign) {
      logger.warn('exhibits', 'exhibits.backfill_deferred', { caseId: ident(caseId) })
      return { ...result, skipped: 'operator_name_required' }
    }
  }
  if (unnumbered.length > 0) {
    appendRenumberEntry(caseId, caseDir, unnumbered, who)
    result.renumbered = true
  }

  for (const pending of thumbnailsPending(exhibits, store, caseDir)) {
    const outcome = await backfillThumbnail(pending, store, who)
    if (outcome === 'deferred') {
      // The rows left wait with it for the run once a name is saved.
      logger.warn('exhibits', 'exhibits.backfill_deferred', { caseId: ident(caseId) })
      return { ...result, skipped: 'operator_name_required' }
    }
    if (outcome === 'anchored') result.thumbnailsAnchored += 1
    if (outcome === 'unanchored') result.thumbnailsUnanchored += 1
  }
  return result
}

// Queue every caller, including startup and repeated name saves, before taking snapshots.
const caseSlots = new Map<string, Promise<void>>()

export async function backfillCase(
  caseId: string,
  deps: ExhibitBackfillDeps
): Promise<ExhibitBackfillCaseResult> {
  const prev = caseSlots.get(caseId) ?? Promise.resolve()
  let release: () => void = () => {}
  const mine = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = prev.then(() => mine)
  caseSlots.set(caseId, tail)
  await prev
  try {
    return await backfillCaseInSlot(caseId, deps)
  } finally {
    release()
    if (caseSlots.get(caseId) === tail) caseSlots.delete(caseId)
  }
}

// Runs the backfill over every Case, including archived ones — an archived Case
// is still evidence and still gets its numbers. A failure on one Case is logged
// and the rest continue: this runs during startup, and a single unreadable case
// directory must not stop the app from opening. It runs again when a save takes
// the operator name from blank to set, for the Cases a blank name skipped (X47).
export async function runExhibitBackfill(
  deps: ExhibitBackfillDeps
): Promise<ExhibitBackfillCaseResult[]> {
  const results: ExhibitBackfillCaseResult[] = []
  for (const caseId of listAllCaseIds()) {
    try {
      results.push(await backfillCase(caseId, deps))
    } catch (err) {
      logger.error('exhibits', 'exhibits.backfill_failed', { caseId: ident(caseId) }, err)
    }
  }
  return results
}

// The work a blank operator name held (X47), run when a save first sets one: the
// backfill over the Cases it skipped, then the stamps the trusted-time worker kept
// pending, which wait on the network and so are started, not awaited. A failure is
// logged rather than thrown, because the name is saved by then and the save must
// not report that it was not.
export async function runHeldSigningWork(
  deps: ExhibitBackfillDeps & { processPendingTimestamps: () => Promise<unknown> }
): Promise<void> {
  try {
    await runExhibitBackfill(deps)
  } catch (err) {
    logger.error('exhibits', 'exhibits.backfill_failed', undefined, err)
  }
  void deps.processPendingTimestamps().catch((err) => {
    logger.error('timestampWorker', 'timestampWorker.stamp_failed', undefined, err)
  })
}
