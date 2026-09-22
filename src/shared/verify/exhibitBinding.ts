// What binds a Derived File to the chain (ADR-0023, #1156). Where an
// Exhibit's bytes sit inside an evidence package is the Package Layout, held in
// src/packages/evidence-package-layout; this module only decides whether a
// `derivation` entry vouches for a file that layout locates.
//
// The app's verify path (`exhibits.ts`) and the standalone package verifier
// (`evidencePackage.ts`) both answer that question here, so they cannot
// disagree about the same bytes.
//
// Pure — no `fs`, no `crypto` — so this module stays on the `@shared/verify`
// barrel and the SEA bundle picks it up with the rest of verify-core.

import { inCasePath } from '../../packages/evidence-package-layout/index'

/** The fields of a `derivation` entry a binding is allowed to read. */
export interface DerivationEntryFacts {
  /**
   * The Case the ENTRY names, which on an imported Case is the source Case and
   * not the row's. Carried so a custody-aware `parentMatches` has the entry's
   * own value to resolve against rather than being handed the row's back.
   */
  caseId: string
  parentExhibitId: string
  outputPath: string
  outputHash: string
}

/** The file being bound: its parent, where it is stored, and the bytes read back. */
export interface DerivedFileFacts {
  parentExhibitId: string
  storedPath: string
  /** sha256 of the bytes the caller actually read. */
  computedHash: string
}

export type DerivedFileBinding =
  | { status: 'verified'; entry: DerivationEntryFacts }
  | { status: 'tampered'; entry: DerivationEntryFacts }
  | { status: 'unanchored'; reason: string }

export interface DerivedFileBindingOptions {
  /**
   * Whether an entry names this file's parent. Defaults to id equality; the
   * main process passes the custody-aware resolution an archive import needs,
   * where the entry keeps the source Case's id for both fields. The whole entry
   * is passed, not just the parent id, so that resolution reads the entry's
   * `caseId` — handing it the row's would make the custody half a tautology.
   */
  parentMatches?: (entry: DerivationEntryFacts) => boolean
}

/**
 * Binds one Derived File to the `derivation` entries a VERIFIED chain carries
 * (X37, D7). The caller passes only entries it has established are covered by
 * the chain; this decides whether one of them vouches for these bytes.
 *
 * Three facts must line up, and a manifest index alone is never one of them:
 * the entry's parent names this file's parent Exhibit, its `outputPath` is the
 * same in-Case path the file is stored at, and its `outputHash` is the digest
 * of the bytes that were read. Binding on the index alone — which is what the
 * app did before #1156 — lets a row point at any `derivation` entry on the
 * chain, so a thumbnail could be vouched for by an entry written about another
 * Exhibit's file. That is the advisory PR #1469 left open, and it is why the
 * app and the standalone verifier now answer this question in one place: if
 * they can disagree about the same bytes, one of them mis-attests.
 *
 * A path that matches with a hash that does not is `tampered`, never
 * `unanchored`: the chain says what these bytes should be and they are not it.
 *
 * `matchDerivationEntries` is the first half on its own, for a caller that has
 * to answer "does the chain name this file at all" BEFORE it can read the
 * bytes — a file whose bytes are unreadable still has an entry or it does not,
 * and deciding that from the read failure classified a file nothing anchors as
 * anchored.
 */
export function matchDerivationEntries(
  file: { parentExhibitId: string; storedPath: string },
  entries: readonly DerivationEntryFacts[],
  options: DerivedFileBindingOptions = {}
): DerivationEntryFacts[] {
  const parentMatches =
    options.parentMatches ??
    ((entry: DerivationEntryFacts): boolean => entry.parentExhibitId === file.parentExhibitId)
  const wanted = inCasePath(file.storedPath)
  return entries.filter((entry) => parentMatches(entry) && inCasePath(entry.outputPath) === wanted)
}

export function bindDerivedFile(
  file: DerivedFileFacts,
  entries: readonly DerivationEntryFacts[],
  options: DerivedFileBindingOptions = {}
): DerivedFileBinding {
  const candidates = matchDerivationEntries(file, entries, options)
  if (candidates.length === 0) {
    return {
      status: 'unanchored',
      reason: 'No derivation entry in the verified chain names this file for its parent exhibit'
    }
  }
  // A re-derivation appends a second entry for the same file, so any candidate
  // whose hash matches binds; the last one is cited when none does, because it
  // is the chain's most recent statement about these bytes.
  const match = candidates.find((entry) => entry.outputHash === file.computedHash)
  if (match) return { status: 'verified', entry: match }
  return { status: 'tampered', entry: candidates[candidates.length - 1] }
}
