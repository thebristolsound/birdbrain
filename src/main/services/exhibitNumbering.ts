import { highestLocalExhibitNumber } from '@main/services/db/exhibitRepo'
import { readManifestSnapshot } from '@main/services/manifest'
import { defaultCaptureStore, type CaptureStore } from '@main/services/captureStore'
import { highestIssuedExhibitNumber } from '@shared/verify'

/**
 * The next Exhibit Number this installation takes in a Case (X45): one more
 * than the highest its own chain has issued, deleted Exhibits included, so a
 * number is never issued twice (X18). The chain read is `manifest.jsonl`, the
 * local installation's own chain; another member's chain is a separate file,
 * and numbers are per member (decision 7).
 *
 * The live rows are a floor under the chain, not a cache of it. A Capture
 * ingested before X46 has its number on its row and on no entry, and issuing
 * that number again would reuse it.
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
