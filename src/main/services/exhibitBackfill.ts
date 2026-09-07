import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import sharp from 'sharp'
import { listAllCaseIds } from '@main/services/db/caseRepo'
import { backfillExhibitsForCaptures, listExhibits } from '@main/services/db/exhibitRepo'
import { hasDerivation, insertDerivedFile } from '@main/services/db/derivedFileRepo'
import {
  appendManifestEntry,
  initManifest,
  readManifestSnapshot,
  verifyManifestChain
} from '@main/services/manifest'
import { defaultCaptureStore, type CaptureStore } from '@main/services/captureStore'
import { getSettings } from '@main/services/settings'
import { getInstallationId } from '@main/services/installationId'
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
// launch.

// The derivation name for a Capture's list thumbnail. Matches the file suffix
// the Capture Store has always used (`_thumb.jpg`).
export const THUMBNAIL_DERIVATION = 'thumbnail'

const THUMB_WIDTH = 160
const THUMB_HEIGHT = 120

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
function hasRenumberEntry(caseDir: string): boolean {
  return readManifestSnapshot(caseDir).entries.some((entry) => entry.type === 'renumber')
}

// Appends the Case's single `renumber` entry (X18). Every Capture-kind Exhibit
// is listed, in number order; `manifestIndex` is OMITTED for a Capture with no
// Manifest Entry, which is how the chain records that its number is a citation
// aid and not an anchoring claim (X41).
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

// The screenshot bytes for a Capture, but ONLY when the signed chain vouches
// for them: the entry at the Capture's manifest index must carry a
// `screenshotHash`, and the bytes on disk must hash to it.
//
// This is the whole point of X34. Hashing whatever `{id}.png` happens to hold
// and anchoring the thumbnail computed from it would put a swapped screenshot's
// derivative into the chain under this migration's signature, which is a
// stronger claim than the app is entitled to make about bytes it never saw
// arrive. Undefined here means "regenerate nothing and anchor nothing".
function verifiedScreenshot(
  caseId: string,
  captureId: string,
  store: CaptureStore,
  // From the VERIFIED chain entry, never from `captures.screenshot_hash`: that
  // column is a mirror the Database Admin hatch can hand-edit, and checking
  // against it would let an edited mirror vouch for the bytes it describes.
  chainScreenshotHash: string | undefined
): Buffer | undefined {
  if (chainScreenshotHash === undefined) return undefined
  const bytes = store.readArtifact(caseId, captureId, 'png')
  if (!bytes) return undefined
  const computed = createHash('sha256').update(bytes).digest('hex')
  return computed === chainScreenshotHash ? bytes : undefined
}

async function backfillThumbnail(
  exhibit: Exhibit,
  store: CaptureStore,
  who: Operator,
  chainScreenshotHash: string | undefined
): Promise<'anchored' | 'unanchored' | 'skipped'> {
  if (hasDerivation(exhibit.id, THUMBNAIL_DERIVATION)) return 'skipped'

  const paths = store.thumbnailPaths(exhibit.caseId, exhibit.id)
  const screenshot = verifiedScreenshot(exhibit.caseId, exhibit.id, store, chainScreenshotHash)

  if (!screenshot) {
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

  const thumbnail = await sharp(screenshot)
    .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover', position: 'top' })
    .jpeg({ quality: 75 })
    .toBuffer()
  await writeFile(paths.abs, thumbnail)
  const outputHash = createHash('sha256').update(thumbnail).digest('hex')
  const timestamp = new Date().toISOString()

  // Dated at migration with the migration as the tool (X34): the bytes were
  // produced now, by this build, and dating them at the Capture's ingest would
  // be a claim about a file that did not exist then.
  const appended = appendManifestEntry(store.caseDir(exhibit.caseId), {
    type: 'derivation',
    caseId: exhibit.caseId,
    parentExhibitId: exhibit.id,
    parentContentHash: exhibit.contentHash,
    derivation: THUMBNAIL_DERIVATION,
    derivationToolVersion: who.toolVersion,
    outputHash,
    outputPath: paths.rel,
    timestamp,
    ...who
  })
  insertDerivedFile({
    exhibitId: exhibit.id,
    derivation: THUMBNAIL_DERIVATION,
    toolVersion: who.toolVersion,
    contentHash: outputHash,
    path: paths.rel,
    createdAt: timestamp,
    manifestSeq: appended.index
  })
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
    // row, and through the shared helper so the numbering is X41's.
    exhibitsCreated: backfillExhibitsForCaptures(caseId),
    renumbered: false,
    thumbnailsAnchored: 0,
    thumbnailsUnanchored: 0
  }

  const exhibits = listExhibits(caseId)
  if (exhibits.length === 0) return result

  if (!hasRenumberEntry(caseDir)) {
    appendRenumberEntry(caseId, caseDir, exhibits, who)
    result.renumbered = true
  }

  // One verified read for the whole Case, taken AFTER the renumber append so
  // the entry this run wrote is part of what was verified. A broken chain
  // yields no entries, so nothing is anchored — which is the right outcome:
  // there is no signed screenshot hash to check a regeneration against.
  const chain = verifyManifestChain(caseDir)
  for (const exhibit of exhibits) {
    if (exhibit.kind !== 'capture') continue
    const chainEntry =
      exhibit.manifestSeq === null
        ? undefined
        : chain.captureEntriesByIndex.get(exhibit.manifestSeq)
    const outcome = await backfillThumbnail(exhibit, store, who, chainEntry?.screenshotHash)
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
