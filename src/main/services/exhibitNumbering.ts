import { highestLocalExhibitNumber } from '@main/services/db/exhibitRepo'
import { readManifestSnapshot } from '@main/services/manifest'
import { defaultCaptureStore, type CaptureStore } from '@main/services/captureStore'
import { highestIssuedExhibitNumber } from '@shared/verify'

/**
 * The next Exhibit Number this installation takes in a Case (X45): one more
 * than the highest its own chain has issued, deleted Exhibits included, so a
 * number the chain records is never issued twice (X18). The chain read is
 * `manifest.jsonl`, the local installation's own chain; another member's chain
 * is a separate file, and numbers are per member (decision 7).
 *
 * The live rows are a floor under the chain, not a cache of it. A Capture can
 * have its number on its row and on no entry: one ingested before X46 after
 * its Case's `renumber`, or one in a Case whose `renumber` the startup backfill
 * has not written yet, such as an archive imported this session. The floor
 * keeps that number from being issued while the row exists. Once the row is
 * deleted nothing records the number, so if it was the highest it can be
 * issued again. For the first kind, recording it needs a second `renumber` or
 * a number on the `deletion` entry, a ruling this change does not make.
 *
 * A caller takes the number and appends the entry that carries it with no
 * `await` between the two, so a concurrent ingest reads a chain that already
 * holds it.
 */
export function nextExhibitNumber(
  caseId: string,
  store: CaptureStore = defaultCaptureStore
): number {
  const { entries } = readManifestSnapshot(store.caseDir(caseId))
  return Math.max(highestIssuedExhibitNumber(entries), highestLocalExhibitNumber(caseId)) + 1
}
