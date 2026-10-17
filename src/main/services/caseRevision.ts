import { defaultCaptureStore, type CaptureStore } from '@main/services/captureStore'
import { getCaseRevisionRow } from '@main/services/db/caseRevisionRepo'
import { getManifestHead, type ManifestHeadRef } from '@main/services/manifest'

// The Case revision (ADR-0042): a generation that changes whenever the database
// or the Case is replaced, a counter that every write to a run input advances,
// and the head of the Case's `manifest.jsonl`. Two revisions are equal only when
// all three parts are. The MCP server's `get_case_revision` returns it as it is.
export interface CaseRevision {
  caseId: string
  generation: string
  counter: number
  // Null while the Case's Manifest holds no entry.
  manifestHead: ManifestHeadRef | null
}

// Null for an id the database holds no Case for, without reading any file: the
// id goes into a path only once a row shows it names a Case. A damaged last
// Manifest line throws, as it does for the append path (`getManifestHead`).
export function readCaseRevision(
  caseId: string,
  store: Pick<CaptureStore, 'caseDir'> = defaultCaptureStore
): CaseRevision | null {
  const row = getCaseRevisionRow(caseId)
  if (!row) return null
  const { prevHash, nextIndex } = getManifestHead(store.caseDir(caseId))
  return {
    caseId,
    generation: row.generation,
    counter: row.counter,
    manifestHead: nextIndex === 0 ? null : { index: nextIndex - 1, entryHash: prevHash }
  }
}
