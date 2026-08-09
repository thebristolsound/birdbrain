/**
 * Resolving a note anchor against the evidence its target actually attests to.
 *
 * Text-anchor resolution reads the on-disk `.txt` sidecar, not the
 * `capture_texts` row. Both hold a copy of the same text and in every healthy
 * capture they agree, but only the sidecar is covered by a digest at all — and
 * as of #234 that digest is read from the SIGNED manifest capture entry, not
 * `captures.text_hash`. The `captures` columns are a DB mirror maintained for
 * convenience (re-bind sidecars without re-reading the manifest); they carry
 * no chain integrity of their own, so a caller who edited a sidecar and its
 * mirror row together — file and column, matching each other but not the
 * manifest — must still see the divergence. The manifest is the only one of
 * the two that is chain-verified and signed, so it is the only one resolution
 * can rest a `hash-verified` claim on. See migrations.ts:369 and
 * captureLifecycle.ts's `verifySidecars`, which binds the app's own verify
 * button the same way.
 */
import { createHash } from 'crypto'
import type { CaptureStore } from '@main/services/captureStore'
import { verifyManifestChain, type CaptureChainEntry } from '@main/services/manifest'
import { matchTextAnchor, type TextAnchor } from '@shared/noteAnchor'

/** The parts of a capture text-anchor resolution needs. Kept narrow so tests need no row. */
export interface AnchorTarget {
  id: string
  caseId: string
  /**
   * This capture's own stored content hash (`captures.hash`). Used only to
   * confirm the manifest entry named by `manifestIndex` actually belongs to
   * THIS capture, not merely to some entry the verified chain happens to
   * contain: an index alone is not a binding, because a coordinated edit to
   * `manifestIndex` and the `.txt` sidecar together could point resolution at
   * a different capture's verified entry and inherit its `hash-verified`
   * claim. `computeVerification` (captureLifecycle.ts) performs the same
   * contentHash confirmation before trusting a chain index for the same
   * reason.
   */
  contentHash: string
  /**
   * This capture's index into the case's manifest.jsonl — the `capture` entry
   * resolution reads its digest from (#234). Absent for a capture that
   * predates the manifest chain entirely (a pre-v11 'html'-format capture):
   * there is no entry to bind to, so resolution proceeds exactly as it does
   * for an entry that carries no `textHash` — the sidecar can be searched,
   * but nothing attests to it.
   */
  manifestIndex?: number
}

/**
 * What backed the text a result was computed against.
 *
 * `hash-verified` means the sidecar matches the digest recorded in the
 * SIGNED manifest capture entry. `unattested` means the sidecar was read but
 * the entry (or the capture, for a pre-chain legacy row) carries no digest to
 * check it against. The passage may well be found in it; what cannot be said
 * is that the text is the text that was captured.
 */
export type TextBasis = 'hash-verified' | 'unattested'

/**
 * One outcome per situation, because they mean different things to a reader.
 *
 * `unresolved` is a claim about a page whose text is intact: the passage is
 * genuinely not there any more. It must not be used to describe a capture that
 * never had stored text, one whose stored text failed its digest, one whose
 * manifest cannot be trusted, or one that is no longer in the database at
 * all — those are separate findings, and collapsing them would report a
 * missing artifact as if it were a moved paragraph. Each is a gap of a
 * different shape, and the shape is the finding.
 *
 * `integrity-failed` / `chain-invalid` is distinct from both `unattested` and
 * the other `integrity-failed` reasons (#234 AC#5): a capture whose
 * `manifestIndex` names an entry the verified chain does not have, or whose
 * chain does not verify at all, is not a capture that was never hashed — it
 * is one whose attestation SHOULD exist and cannot currently be trusted.
 * Folding it into `unattested` would understate the problem.
 */
export type NoteAnchorResolution =
  | { status: 'resolved'; via: 'offset' | 'quote' | 'context'; offset: number; basis: TextBasis }
  | { status: 'unresolved'; basis: TextBasis }
  | { status: 'no-stored-text' }
  | { status: 'integrity-failed'; reason: 'missing' | 'digest-mismatch' | 'chain-invalid' }
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

  // A legacy pre-chain capture (no manifestIndex) never had an entry to bind
  // to, so chain validity is irrelevant to its resolution — it must not be
  // gated behind a chain check that exists only to protect entries it does
  // not have. Only fetch and verify the chain when this capture actually
  // names an entry in it.
  let entry: CaptureChainEntry | undefined
  if (typeof target.manifestIndex === 'number') {
    // Bind to the signed manifest, not the DB mirror (#234). A chain that
    // does not verify means nothing in this case's manifest can be trusted,
    // so no digest read from it — or its absence — is meaningful.
    const chain = verifyManifestChain(store.caseDir(target.caseId))
    if (!chain.valid) return { status: 'integrity-failed', reason: 'chain-invalid' }

    entry = chain.captureEntriesByIndex.get(target.manifestIndex)
    // A defined manifestIndex names an entry ingest actually wrote. If a
    // verified chain no longer has it, the DB and the manifest have drifted
    // — report it rather than silently falling back to "no digest to offer".
    if (!entry) {
      return { status: 'integrity-failed', reason: 'chain-invalid' }
    }
    // The index alone is not a binding: confirm the entry actually belongs to
    // THIS capture before trusting anything it says, the same check
    // `computeVerification` runs against `captureHashesByIndex` before
    // comparing a stored hash. Without it, a `manifestIndex` swapped onto
    // another capture's valid entry (paired with a matching sidecar swap)
    // would read as `hash-verified` for the wrong capture.
    if (entry.contentHash !== target.contentHash) {
      return { status: 'integrity-failed', reason: 'chain-invalid' }
    }
  }

  const buf = store.readArtifact(target.caseId, target.id, 'txt')

  // No digest and no sidecar: the capture genuinely has no stored text. No
  // digest but a sidecar on disk: a legacy capture (pre-chain, or a pre-#118
  // entry with no textHash field), whose text can be searched but cannot be
  // attested. Reporting the second as `no-stored-text` would deny the
  // existence of text a reader can plainly see.
  const textHash = entry?.textHash
  if (!textHash) {
    if (!buf) return { status: 'no-stored-text' }
    return { ...matchTextAnchor(buf.toString('utf-8'), anchor), basis: 'unattested' }
  }

  if (!buf) return { status: 'integrity-failed', reason: 'missing' }

  const computed = createHash('sha256').update(buf).digest('hex')
  if (computed !== textHash) {
    return { status: 'integrity-failed', reason: 'digest-mismatch' }
  }

  return { ...matchTextAnchor(buf.toString('utf-8'), anchor), basis: 'hash-verified' }
}

/**
 * Whether a `finding`/`selectorMatch` anchor's targets still exist.
 *
 * Pure booleans supplied by the caller (who owns the DB lookups) rather than
 * ids, so this stays as narrow and filesystem/DB-free as `resolveTextAnchor`'s
 * own ladder. A capture id resolves to `capture-missing` the same way a text
 * anchor's does; a selector id resolves to the equivalent `selector-missing`
 * (#234 item 3) — the same class of gap `capture-missing` names, for the
 * other id a selector-match anchor embeds. Neither outcome scrubs the anchor;
 * both are visible gaps, not silent drops, matching the rule the whole
 * resolver module follows.
 */
export interface SelectorMatchTarget {
  captureExists: boolean
  selectorExists: boolean
}

export type SelectorMatchResolution =
  { status: 'resolved' } | { status: 'capture-missing' } | { status: 'selector-missing' }

export function resolveSelectorMatchAnchor(target: SelectorMatchTarget): SelectorMatchResolution {
  if (!target.captureExists) return { status: 'capture-missing' }
  if (!target.selectorExists) return { status: 'selector-missing' }
  return { status: 'resolved' }
}
