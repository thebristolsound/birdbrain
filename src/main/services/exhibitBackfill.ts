import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { listAllCaseIds } from '@main/services/db/caseRepo'
import { backfillExhibitsForCaptures, listExhibits } from '@main/services/db/exhibitRepo'
import { nextExhibitNumber } from '@main/services/exhibitNumbering'
import { hasDerivation, insertDerivedFile } from '@main/services/db/derivedFileRepo'
import {
  appendManifestEntry,
  initManifest,
  readManifestSnapshot,
  verifyManifestChain,
  withManifestEntry,
  type CaptureChainEntry
} from '@main/services/manifest'
import { defaultCaptureStore, type CaptureStore } from '@main/services/captureStore'
import { getSettings } from '@main/services/settings'
import { getInstallationId } from '@main/services/installationId'
import { renderThumbnail } from '@main/services/thumbnails'
import { logger } from '@main/services/logger'
import { ident } from '@main/services/logSafe'
import type { Exhibit } from '@shared/types'

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
}

interface Operator {
  operatorId: string
  operatorName: string
  toolVersion: string
}

function operator(toolVersion: string): Operator {
  return {
    operatorId: getInstallationId(),
    operatorName: getSettings().operatorName ?? '',
    toolVersion
  }
}

// Whether this Case's chain already carries its `renumber` entry. Read from the
// raw lines rather than from a verified read on purpose: the question is "has
// one been written", and a Case whose chain is broken must not have a second
// one appended on top of the first.
function hasRenumberEntry(entries: Record<string, unknown>[]): boolean {
  return entries.some((entry) => entry.type === 'renumber')
}

// The Exhibits the `renumber` entry has to number: this installation's own
// whose anchoring entry carries no number. A Capture ingested since X46 and
// every committed Exhibit of another kind already has its number on its own
// entry, and listing it again would give one Exhibit two assignments. Another
// member's Exhibit is numbered in that member's chain (decision 7), and its
// `manifestSeq` indexes that chain, not this one. Read from the raw lines for
// the reason `hasRenumberEntry` is: the question is what was written.
function awaitingRenumber(exhibits: Exhibit[], entries: Record<string, unknown>[]): Exhibit[] {
  return exhibits.filter((exhibit) => {
    if (exhibit.authorInstallationId !== null) return false
    const anchoring = exhibit.manifestSeq === null ? undefined : entries[exhibit.manifestSeq]
    const numbered =
      (anchoring?.type === 'capture' || anchoring?.type === 'exhibit') &&
      typeof anchoring.exhibitNumber === 'number'
    return !numbered
  })
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

function derivationKey(exhibitId: string, derivation: string): string {
  return `${exhibitId}\u0000${derivation}`
}

// The `derivation` entries this Case's chain already carries, keyed by parent
// Exhibit and derivation name.
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
    const { parentExhibitId, derivation, outputHash, index } = line
    if (
      typeof parentExhibitId !== 'string' ||
      typeof derivation !== 'string' ||
      typeof outputHash !== 'string' ||
      typeof index !== 'number'
    ) {
      continue
    }
    found.set(derivationKey(parentExhibitId, derivation), { index, outputHash })
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

async function backfillThumbnail(
  exhibit: Exhibit,
  store: CaptureStore,
  who: Operator,
  chainEntry: CaptureChainEntry | undefined,
  prior: PriorDerivation | undefined
): Promise<'anchored' | 'unanchored' | 'skipped'> {
  if (hasDerivation(exhibit.id, THUMBNAIL_DERIVATION)) return 'skipped'

  const paths = store.thumbnailPaths(exhibit.caseId, exhibit.id)

  if (prior !== undefined) {
    // A previous run appended the entry and was killed before its row landed.
    // Re-record the row against the entry that is already signed rather than
    // signing a second one for the same Derived File, and do not regenerate:
    // the bytes the entry names are the ones on disk or they are not, and
    // overwriting them would only make a second entry look necessary.
    if (!existsSync(paths.abs)) return 'skipped'
    const bytes = await readFile(paths.abs)
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

  // The same renderer `getThumbnail` uses, not a second copy of the pipeline:
  // the entry appended below anchors these bytes, so a later regeneration from
  // the same parent screenshot has to reproduce them.
  const thumbnail = await renderThumbnail(parent.screenshot)
  await writeFile(paths.abs, thumbnail)
  const outputHash = createHash('sha256').update(thumbnail).digest('hex')
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
      parentExhibitId: exhibit.id,
      parentContentHash: parent.contentHash,
      derivation: THUMBNAIL_DERIVATION,
      derivationToolVersion: who.toolVersion,
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
  return 'anchored'
}

export async function backfillCase(
  caseId: string,
  deps: ExhibitBackfillDeps
): Promise<ExhibitBackfillCaseResult> {
  const store = deps.store ?? defaultCaptureStore
  const who = operator(deps.toolVersion)
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
  if (!hasRenumberEntry(entries)) {
    // At most one per Case, and none when every Exhibit's own entry carries
    // its number: a Case begun since X46 has nothing to renumber.
    const unnumbered = awaitingRenumber(exhibits, entries)
    if (unnumbered.length > 0) {
      appendRenumberEntry(caseId, caseDir, unnumbered, who)
      result.renumbered = true
    }
  }

  // One verified read for the whole Case, taken AFTER the renumber append so
  // the entry this run wrote is part of what was verified. A broken chain
  // yields no entries, so nothing is anchored — which is the right outcome:
  // there is no signed screenshot hash to check a regeneration against.
  const chain = verifyManifestChain(caseDir)
  // Read after the renumber append too, so a `derivation` entry an earlier run
  // appended before its row landed is visible here rather than duplicated.
  const prior = priorDerivations(caseDir)
  for (const exhibit of exhibits) {
    if (exhibit.kind !== 'capture') continue
    const chainEntry =
      exhibit.manifestSeq === null
        ? undefined
        : chain.captureEntriesByIndex.get(exhibit.manifestSeq)
    const outcome = await backfillThumbnail(
      exhibit,
      store,
      who,
      chainEntry,
      prior.get(derivationKey(exhibit.id, THUMBNAIL_DERIVATION))
    )
    if (outcome === 'anchored') result.thumbnailsAnchored += 1
    if (outcome === 'unanchored') result.thumbnailsUnanchored += 1
  }
  return result
}

// Runs the backfill over every Case, including archived ones — an archived Case
// is still evidence and still gets its numbers. A failure on one Case is logged
// and the rest continue: this runs during startup, and a single unreadable case
// directory must not stop the app from opening.
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
