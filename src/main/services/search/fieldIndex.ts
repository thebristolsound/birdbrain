import { createHash } from 'crypto'
import { defaultCaptureStore } from '@main/services/captureStore'
import type { CaptureStore } from '@main/services/captureStore'
import * as searchFieldRepo from '@main/services/db/searchFieldRepo'
import type { FieldBuildOutcome, FieldSource } from '@main/services/db/searchFieldRepo'
import {
  extractFields,
  FIELD_EXTRACTOR_VERSION,
  type ExtractedField
} from '@main/services/search/fieldExtractor'
import { logger } from '@main/services/logger'
import { ident } from '@main/services/logSafe'
import type { FieldBuildSummary } from '@shared/ipc'

// Builds the Case search field records from the stored files (docs/plans/2026-10-09-
// case-retrieval-first-slice.md, D5): one Capture after ingest or duplication, the
// Captures a Case lacks or an older extractor built, every Capture in a Case on
// reprocess, and every Capture on a rebuild. A build that fails writes a `failed`
// build row and a log entry, and is retried by a reprocess, a rebuild or a new
// extractor version, not on the next Case open.

type ArtifactReader = Pick<CaptureStore, 'readArtifact'>

interface BuiltFields {
  fields: ExtractedField[]
  textHash: string | null
  outcome: FieldBuildOutcome
  skippedJson: string | null
}

function extractFromStore(
  { exhibitId, caseId, url }: FieldSource,
  store: ArtifactReader
): BuiltFields {
  const mhtml = store.readArtifact(caseId, exhibitId, 'mhtml')
  // A legacy Capture from before MHTML has its page as `.html` instead.
  const html = mhtml ? null : store.readArtifact(caseId, exhibitId, 'html')
  const text = store.readArtifact(caseId, exhibitId, 'txt')
  const textHash = text ? createHash('sha256').update(text).digest('hex') : null
  if (!mhtml && !html && !text) {
    return { fields: [], textHash, outcome: 'no-source', skippedJson: null }
  }
  const { fields, skippedParts, mainDocumentSkipped, truncated } = extractFields({
    captureUrl: url,
    mhtml,
    html: html ? html.toString('utf8') : null,
    text: text ? text.toString('utf-8') : null
  })
  const { tooLarge, overPartCount, overTotalSize } = skippedParts
  const partial = tooLarge + overPartCount + overTotalSize > 0 || mainDocumentSkipped || truncated
  return {
    fields,
    textHash,
    outcome: partial ? 'partial' : 'built',
    skippedJson: partial
      ? JSON.stringify({ ...skippedParts, mainDocumentSkipped, truncated })
      : null
  }
}

/**
 * Replaces one Capture's field records with a build from its stored files. Returns
 * the outcome, or null when the Capture or its Exhibit row is gone. Throws only when
 * the database does.
 */
export function buildExhibitFields(
  exhibitId: string,
  store: ArtifactReader = defaultCaptureStore
): FieldBuildOutcome | null {
  const source = searchFieldRepo.getFieldSource(exhibitId)
  if (!source) return null
  let built: BuiltFields
  try {
    built = extractFromStore(source, store)
  } catch (err) {
    logger.error('searchFields', 'searchFields.build_failed', { exhibitId: ident(exhibitId) }, err)
    built = { fields: [], textHash: null, outcome: 'failed', skippedJson: null }
  }
  const { fields, ...build } = built
  searchFieldRepo.replaceExhibitFields(
    {
      ...build,
      exhibitId,
      caseId: source.caseId,
      contentHash: source.contentHash,
      extractor: FIELD_EXTRACTOR_VERSION,
      builtAt: new Date().toISOString()
    },
    fields
  )
  return build.outcome
}

async function buildEach(exhibitIds: string[], store: ArtifactReader): Promise<FieldBuildSummary> {
  let indexed = 0
  let noSource = 0
  let failed = 0
  for (const exhibitId of exhibitIds) {
    // Yield between Captures, as reprocessCase does: each build runs on the main
    // process, and a Case can hold thousands.
    await new Promise<void>((resolve) => setImmediate(resolve))
    try {
      const outcome = buildExhibitFields(exhibitId, store)
      if (outcome === 'failed') failed += 1
      else if (outcome === 'no-source') noSource += 1
      else if (outcome !== null) indexed += 1
    } catch (err) {
      failed += 1
      logger.error(
        'searchFields',
        'searchFields.build_failed',
        { exhibitId: ident(exhibitId) },
        err
      )
    }
  }
  return { indexed, noSource, failed }
}

// One pass per Case at a time: a Case opened again, or opened while its import's
// pass is still running, joins the pass in progress.
const ensuring = new Map<string, Promise<FieldBuildSummary>>()

/** Builds each Capture in the Case with no build row, or one an older extractor wrote. */
export function ensureCaseFields(
  caseId: string,
  store: ArtifactReader = defaultCaptureStore
): Promise<FieldBuildSummary> {
  const running = ensuring.get(caseId)
  if (running) return running
  const pass = (async () =>
    buildEach(searchFieldRepo.listExhibitsNeedingFields(caseId, FIELD_EXTRACTOR_VERSION), store))()
  const tracked = pass.finally(() => ensuring.delete(caseId))
  ensuring.set(caseId, tracked)
  return tracked
}

/** Builds every Capture in the Case again, failed builds included, as reprocess asks. */
export async function rebuildCaseFields(
  caseId: string,
  store: ArtifactReader = defaultCaptureStore
): Promise<FieldBuildSummary> {
  return buildEach(searchFieldRepo.listCaseCaptureExhibits(caseId), store)
}

/** Clears every Case's field records and builds them again from the stored files. */
export async function rebuildAllFields(
  store: ArtifactReader = defaultCaptureStore
): Promise<FieldBuildSummary> {
  searchFieldRepo.clearAllSearchFields()
  return buildEach(searchFieldRepo.listAllCaptureExhibits(), store)
}
