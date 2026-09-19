// Where an Exhibit's bytes sit inside an evidence package, and what binds them
// to the chain (ADR-0023, #1156).
//
// Three callers decide those two questions and they must decide them the same
// way: the exporter writing the files (`export.ts`), the app's verify path
// (`exhibits.ts`) and the standalone package verifier (`evidencePackage.ts`).
// A layout rule held in two places is a file the exporter writes and the
// verifier reports missing, so it is held here once.
//
// Pure — no `fs`, no `crypto` — so this module stays on the `@shared/verify`
// barrel and the SEA bundle picks it up with the rest of verify-core.

/** Package directory holding Capture page archives. */
export const CAPTURE_PACKAGE_DIRECTORY = 'pages'

/**
 * The part of a storage path that lies inside the Case directory:
 * `{caseId}/attachments/x.zip` -> `attachments/x.zip`.
 *
 * The first segment is DROPPED rather than matched against a known caseId. An
 * archive import re-roots a row's path into the new Case (`rerootPath` in
 * exhibitRepo.ts) while the chain entry keeps the source Case's path, so a
 * caseId comparison would un-bind every imported Case's files. Backslashes are
 * normalized because `path.join` produces them on Windows while package entry
 * names and manifest paths are always `/`.
 */
export function inCasePath(storagePath: string): string {
  const normalized = storagePath.replace(/\\/g, '/')
  const slash = normalized.indexOf('/')
  return slash === -1 ? normalized : normalized.slice(slash + 1)
}

function baseName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

/**
 * The package directory an Exhibit of `kind` ships under: `pages/` for a
 * Capture, and otherwise the kind subdirectory the Case store already uses,
 * read off the stored path rather than from a kind table — a kind this build
 * has never heard of then lands where its own writer put it (X43).
 *
 * `''` means the package root, which is where an Exhibit stored flat in the
 * Case directory goes.
 */
export function exhibitPackageDirectory(kind: string, storagePath: string | null): string {
  if (kind === 'capture') return CAPTURE_PACKAGE_DIRECTORY
  if (!storagePath) return ''
  const inCase = inCasePath(storagePath)
  const slash = inCase.lastIndexOf('/')
  return slash === -1 ? '' : inCase.slice(0, slash)
}

/**
 * Where a non-Capture Exhibit's bytes sit in a package: its in-Case path, so
 * `{caseId}/documents/{id}.pdf` ships as `documents/{id}.pdf`, keyed by
 * Exhibit id with the stored extension (D1).
 *
 * Captures are not routed through here: their page archive is `pages/{id}.mhtml`
 * whatever the row records, because the packager encloses the MHTML and a
 * legacy `html` Capture encloses nothing at all.
 */
export function exhibitPackagePath(storagePath: string): string {
  return inCasePath(storagePath)
}

/** Where a Derived File sits: beside its parent, under the parent's directory. */
export function derivedFilePackagePath(
  parentDirectory: string,
  derivedStoragePath: string
): string {
  const name = baseName(derivedStoragePath)
  return parentDirectory ? `${parentDirectory}/${name}` : name
}

/** The three fields of a `derivation` entry a binding is allowed to read. */
export interface DerivationEntryFacts {
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
   * Whether an entry's `parentExhibitId` names this file's parent. Defaults to
   * id equality; the main process passes the custody-aware resolution an
   * archive import needs, where the entry keeps the source's id.
   */
  parentMatches?: (entryParentExhibitId: string) => boolean
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
 */
export function bindDerivedFile(
  file: DerivedFileFacts,
  entries: readonly DerivationEntryFacts[],
  options: DerivedFileBindingOptions = {}
): DerivedFileBinding {
  const parentMatches =
    options.parentMatches ?? ((id: string): boolean => id === file.parentExhibitId)
  const wanted = inCasePath(file.storedPath)
  const candidates = entries.filter(
    (entry) => parentMatches(entry.parentExhibitId) && inCasePath(entry.outputPath) === wanted
  )
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
