/**
 * Resolving a text anchor against the bytes the capture's hash actually binds.
 *
 * Resolution reads the on-disk `.txt` sidecar, not the `capture_texts` row.
 * Both hold a copy of the same text and in every healthy capture they agree,
 * but only the sidecar is covered by `captures.text_hash`. The table is a
 * convenience copy maintained for search; anchoring to it would mean anchoring
 * to something nothing verifies, and the two only ever diverge in exactly the
 * situation an anchor needs to survive.
 */
import { createHash } from 'crypto'
import type { CaptureStore } from '@main/services/captureStore'
import { matchTextAnchor, type TextAnchor } from '@shared/noteAnchor'

/** The parts of a capture resolution needs. Kept narrow so tests need no row. */
export interface AnchorTarget {
  id: string
  caseId: string
  /** Absent when the capture was ingested with no extracted text at all. */
  textHash?: string
}

/**
 * Four outcomes, because there are four situations and they mean different
 * things to a reader.
 *
 * `unresolved` is a claim about a page whose text is intact: the passage is
 * genuinely not there any more. It must not be used to describe a capture that
 * never had stored text, nor one whose stored text failed its digest — those
 * are separate findings, and collapsing them would report a missing artifact
 * as if it were a moved paragraph.
 */
export type NoteAnchorResolution =
  | { status: 'resolved'; via: 'offset' | 'quote' | 'context'; offset: number }
  | { status: 'unresolved' }
  | { status: 'no-stored-text' }
  | { status: 'integrity-failed'; reason: 'missing' | 'digest-mismatch' }

export function resolveTextAnchor(
  target: AnchorTarget,
  anchor: TextAnchor,
  store: CaptureStore
): NoteAnchorResolution {
  if (!target.textHash) return { status: 'no-stored-text' }

  const buf = store.readArtifact(target.caseId, target.id, 'txt')
  if (!buf) return { status: 'integrity-failed', reason: 'missing' }

  const computed = createHash('sha256').update(buf).digest('hex')
  if (computed !== target.textHash) {
    return { status: 'integrity-failed', reason: 'digest-mismatch' }
  }

  return matchTextAnchor(buf.toString('utf-8'), anchor)
}
