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
  /**
   * Absent for a capture ingested with no extracted text — and also for one
   * captured before schema v19, which added the column and left existing rows
   * NULL (`migrations.ts:369`). A missing hash therefore means "nothing attests
   * to this text", not "there is no text": the sidecar has to be looked for
   * before either can be claimed.
   */
  textHash?: string
}

/**
 * What backed the text a result was computed against.
 *
 * `hash-verified` is the normal case. `unattested` means the sidecar was read
 * but `text_hash` is NULL, so nothing binds those bytes to the capture — a
 * pre-v19 capture. The passage may well be found in it; what cannot be said is
 * that the text is the text that was captured.
 */
export type TextBasis = 'hash-verified' | 'unattested'

/**
 * One outcome per situation, because they mean different things to a reader.
 *
 * `unresolved` is a claim about a page whose text is intact: the passage is
 * genuinely not there any more. It must not be used to describe a capture that
 * never had stored text, one whose stored text failed its digest, or one that
 * is no longer in the database at all — those are separate findings, and
 * collapsing them would report a missing artifact as if it were a moved
 * paragraph. Each is a gap of a different shape, and the shape is the finding.
 */
export type NoteAnchorResolution =
  | { status: 'resolved'; via: 'offset' | 'quote' | 'context'; offset: number; basis: TextBasis }
  | { status: 'unresolved'; basis: TextBasis }
  | { status: 'no-stored-text' }
  | { status: 'integrity-failed'; reason: 'missing' | 'digest-mismatch' }
  | { status: 'capture-missing' }

/**
 * Resolve a text anchor. A null `target` means the capture it names is no
 * longer in the database.
 *
 * That case is a distinct outcome rather than an error because deleting a
 * capture does not, and must not, erase the anchors pointing at it. SQLite
 * sets `notes.capture_id` to NULL on delete but cannot reach the `captureId`
 * inside `anchor_json`, and the answer to that is not to scrub the anchor: a
 * note whose evidence was deleted must survive as a visible gap, the same rule
 * the design states for a brief block whose referent is gone. Erasing it would
 * destroy the record that the note ever cited anything, leaving prose whose
 * referent cannot be traced — the opposite of what an evidence tool owes.
 *
 * The parameter is nullable so a caller cannot forget: there is no way to ask
 * this question without deciding what an absent capture means.
 */
export function resolveTextAnchor(
  target: AnchorTarget | null,
  anchor: TextAnchor,
  store: CaptureStore
): NoteAnchorResolution {
  if (!target) return { status: 'capture-missing' }

  const buf = store.readArtifact(target.caseId, target.id, 'txt')

  // No hash and no sidecar: the capture genuinely has no stored text. No hash
  // but a sidecar on disk: a pre-v19 capture, whose text can be searched but
  // cannot be attested. Reporting the second as `no-stored-text` would deny
  // the existence of text a reader can plainly see.
  if (!target.textHash) {
    if (!buf) return { status: 'no-stored-text' }
    return { ...matchTextAnchor(buf.toString('utf-8'), anchor), basis: 'unattested' }
  }

  if (!buf) return { status: 'integrity-failed', reason: 'missing' }

  const computed = createHash('sha256').update(buf).digest('hex')
  if (computed !== target.textHash) {
    return { status: 'integrity-failed', reason: 'digest-mismatch' }
  }

  return { ...matchTextAnchor(buf.toString('utf-8'), anchor), basis: 'hash-verified' }
}
