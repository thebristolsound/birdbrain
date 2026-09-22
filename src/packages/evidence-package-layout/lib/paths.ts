// Where each member of an Evidence Package sits and what it is named: the
// Package Layout (CONTEXT.md). The writer (`export.ts`), the app's verify path,
// the standalone package verifier (`evidencePackage.ts`), `verify.sh` and
// `VERIFY.md` all read it from here, so no two of them can name one member
// differently. A layout rule held in two places is a file the exporter writes
// and a verifier reports missing.
//
// Pure: strings in, strings out. No `fs`, no `path.join`, so the SEA verifier
// bundle picks it up with the rest of verify-core and a consumer joins to its
// own directory.

import { MANIFEST_FILENAME } from '@shared/constants'

/** Package directory holding Capture page archives. */
export const CAPTURE_PACKAGE_DIRECTORY = 'pages'
/** Package directory holding content-addressed Capture screenshots. */
export const SCREENSHOT_PACKAGE_DIRECTORY = 'screenshots'
/** Package directory holding RFC 3161 Timestamp Tokens. */
export const TIMESTAMP_PACKAGE_DIRECTORY = 'timestamps'

const CAPTURE_PAGE_EXTENSION = '.mhtml'
const SCREENSHOT_EXTENSION = '.png'
const TIMESTAMP_TOKEN_EXTENSION = '.tst'

/**
 * The fixed documents at the package root. `manifest` is also the name the
 * Manifest has inside a Case directory, which is why that one is read from
 * `@shared/constants` rather than spelled here.
 */
export const PACKAGE_ROOT_FILES = Object.freeze({
  manifest: MANIFEST_FILENAME,
  report: 'report.html',
  certification: 'certification.html',
  signingPublicKey: 'signing-public-key.pem',
  verifyRunbook: 'VERIFY.md',
  verifyScript: 'verify.sh',
  evidenceIndex: 'evidence.json',
  exportEntry: 'export-entry.json',
  notes: 'notes.md',
  tsaRoot: 'tsa-root.pem',
  tsaIntermediates: 'tsa-intermediates.pem'
})

/** `pages/{captureId}.mhtml`: the page archive, whatever the row records. */
export function capturePagePath(captureId: string): string {
  return `${CAPTURE_PACKAGE_DIRECTORY}/${captureId}${CAPTURE_PAGE_EXTENSION}`
}

/** `screenshots/{sha256}.png`: content-addressed, so the name is its own digest. */
export function screenshotPath(digest: string): string {
  return `${SCREENSHOT_PACKAGE_DIRECTORY}/${digest}${SCREENSHOT_EXTENSION}`
}

/** `timestamps/{exhibitId}.tst`: named after the first Exhibit sharing the token. */
export function timestampTokenPath(exhibitId: string): string {
  return `${TIMESTAMP_PACKAGE_DIRECTORY}/${exhibitId}${TIMESTAMP_TOKEN_EXTENSION}`
}

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
 * Captures are not routed through here: their page archive is
 * `capturePagePath(id)` whatever the row records, because the packager
 * encloses the MHTML and a legacy `html` Capture encloses nothing at all.
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
