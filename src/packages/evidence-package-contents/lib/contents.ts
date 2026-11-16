// What one export encloses for its Timestamp Tokens, its Exhibits that are not
// Captures and every Derived File: the Package Contents. Decided here, once,
// from the chain entries, the rows in scope and the bytes the byte source
// returns. The report, the index, the Certification and the zip all read the
// result, so for these files none of them can name one another leaves out. A
// Capture's own files are still decided in `export.ts`.
//
// Verification never reads this module: Package Verification, `verify.sh` and
// the Verify Runbook restate what a package must hold on purpose (ADR-0004),
// and `.dependency-cruiser.cjs` refuses any import that reaches it from them.

import type { Capture, DerivedFile, DerivedFileVerification, Exhibit } from '@shared/types'
import { stampFor } from '@shared/verify/trustedTime'
import {
  derivedFilePackagePath,
  exhibitPackageDirectory,
  exhibitPackagePath,
  timestampTokenPath
} from '../../evidence-package-layout/index'
import type { PackageByteSource } from './byteSource'

/**
 * What the export produces. A `report` is the standalone HTML document: it
 * encloses nothing, and nothing is read for it.
 */
export type ExportForm = 'evidence-package' | 'working-copy' | 'report'

export interface PackageContentsInput {
  form: ExportForm
  /**
   * Every entry the package vouches for: the local chain's, then the accepted
   * entries of every other member and lineage chain.
   */
  entries: readonly Record<string, unknown>[]
  /**
   * How the signed entry of a row an import renamed names it, by row id. A row
   * absent here goes by its own id and path.
   */
  chainNames: ReadonlyMap<string, { id: string; path: string | null }>
  /** The Captures in scope. */
  captures: readonly Pick<Capture, 'id' | 'hash' | 'mhtmlPath'>[]
  /** The Exhibits in scope that are not Captures. */
  fileExhibits: readonly Pick<Exhibit, 'id' | 'kind' | 'path' | 'contentHash'>[]
  /** Derived File rows by the row id of the Exhibit they were computed from. */
  derivedFiles: ReadonlyMap<string, readonly DerivedFile[]>
  /** What binding each Derived File to the chain found, by the same row id. */
  derivedVerifications: ReadonlyMap<string, readonly DerivedFileVerification[]>
  source: PackageByteSource
}

/** One file the export encloses: where it sits in the package, and its bytes. */
export interface EnclosedFile {
  path: string
  bytes: Buffer
}

/**
 * What the chain says about a Derived File:
 *
 * - `anchored`: a `derivation` entry on the verified chain names it.
 * - `no-entry`: no entry names it (X34). It is never enclosed: the rows are a
 *   database mirror, and a package holds only what the chain covers.
 * - `chain-unverified`: an entry names it and the chain does not verify. It is
 *   still enclosed, because the rule holds back a missing entry, not a failing
 *   chain.
 */
export type DerivedFileAnchoring = 'anchored' | 'no-entry' | 'chain-unverified'

export interface DerivedFileContents {
  file: DerivedFile
  /** The verification `anchoring` was read from; absent when none was given. */
  verification?: DerivedFileVerification
  anchoring: DerivedFileAnchoring
  /** Null when the file is held back, or when its bytes could not be read. */
  enclosed: EnclosedFile | null
}

export interface CaptureContents {
  /** Where the Capture's Timestamp Token sits, or null when none is enclosed. */
  timestampTokenPath: string | null
  /** One for each Derived File row of the Capture, in the order given. */
  derivedFiles: readonly DerivedFileContents[]
}

export interface FileExhibitContents {
  /** Null when the Exhibit's bytes could not be read, or it has no stored path. */
  enclosed: EnclosedFile | null
  timestampTokenPath: string | null
  /** One for each Derived File row of the Exhibit, in the order given. */
  derivedFiles: readonly DerivedFileContents[]
}

export interface PackageContents {
  /** By row id. Throws for a Capture that was not in the input. */
  ofCapture(rowId: string): CaptureContents
  /** By row id. Throws for an Exhibit that was not in the input. */
  ofFileExhibit(rowId: string): FileExhibitContents
  /** Each enclosed Timestamp Token once, in the order the zip writes them. */
  timestampTokens: readonly EnclosedFile[]
  /**
   * Every enclosed file of the Exhibits that are not Captures, in the order
   * the zip writes them: each Exhibit's own file, then its Derived Files.
   */
  fileExhibitFiles: readonly EnclosedFile[]
}

interface TimestampEntry {
  [key: string]: unknown
  type: 'timestamp'
  index: number
  captureContentHash: string
}

function isTimestampEntry(entry: Record<string, unknown>): entry is TimestampEntry {
  return (
    entry.type === 'timestamp' &&
    typeof entry.index === 'number' &&
    typeof entry.captureContentHash === 'string'
  )
}

interface TokenSubject {
  id: string
  contentHash: string
}

/**
 * The Timestamp Tokens an Evidence Package encloses, and the one path each
 * Content Hash cites. Any Exhibit can be stamped (X26). Exhibits that share a
 * Content Hash share one token file, named after the first of them.
 *
 * A token is enclosed only where `stampFor` accepts its entry (#1108), the
 * function the trusted-time axis is resolved with: one that fails to parse, or
 * whose imprint attests other content, is neither enclosed nor cited. The
 * bytes enclosed for a hash are those of the first entry accepted for it,
 * which need not be the first entry naming it.
 */
function decideTimestampTokens(
  subjects: readonly TokenSubject[],
  entries: readonly Record<string, unknown>[]
): { pathByContentHash: Map<string, string>; files: EnclosedFile[] } {
  const pathByContentHash = new Map<string, string>()
  const files: EnclosedFile[] = []
  const enclosedPaths = new Set<string>()
  for (const entry of entries) {
    if (!isTimestampEntry(entry) || typeof entry.tsaToken !== 'string') continue
    const contentHash = entry.captureContentHash
    if (!stampFor(entry, contentHash)) continue
    const subject = subjects.find((candidate) => candidate.contentHash === contentHash)
    if (!subject) continue
    const path = pathByContentHash.get(contentHash) ?? timestampTokenPath(subject.id)
    pathByContentHash.set(contentHash, path)
    if (enclosedPaths.has(path)) continue
    files.push({ path, bytes: Buffer.from(entry.tsaToken, 'base64') })
    enclosedPaths.add(path)
  }
  return { pathByContentHash, files }
}

function anchoringOf(verification: DerivedFileVerification | undefined): DerivedFileAnchoring {
  // No verification at all fails closed: nothing established an entry, so
  // nothing may be enclosed on the strength of one.
  if (verification === undefined) return 'no-entry'
  // `verified`, `tampered` and `missing` are all decided after the chain was
  // found to carry an entry for the file.
  if (verification.status !== 'unverified') return 'anchored'
  return verification.unanchoredCause === 'chain-unverified' ? 'chain-unverified' : 'no-entry'
}

export function decidePackageContents(input: PackageContentsInput): PackageContents {
  const { form, entries, chainNames, captures, fileExhibits, source } = input
  const encloses = form !== 'report'
  const chainIdOf = (rowId: string): string => chainNames.get(rowId)?.id ?? rowId

  const tokens =
    form === 'evidence-package'
      ? decideTimestampTokens(
          [
            ...captures.map(({ id, hash }) => ({ id: chainIdOf(id), contentHash: hash })),
            ...fileExhibits.map(({ id, contentHash }) => ({ id: chainIdOf(id), contentHash }))
          ],
          entries
        )
      : { pathByContentHash: new Map<string, string>(), files: [] }

  // A Derived File sits beside its parent, under the parent's directory. The
  // read decides enclosure: nothing probes for the file and then reads it.
  const derivedFilesOf = (parentRowId: string, parentDirectory: string): DerivedFileContents[] => {
    const verifications = new Map(
      (input.derivedVerifications.get(parentRowId) ?? []).map((result) => [
        result.derivedFileId,
        result
      ])
    )
    return (input.derivedFiles.get(parentRowId) ?? []).map((file) => {
      const verification = verifications.get(file.id)
      const anchoring = anchoringOf(verification)
      const bytes = encloses && anchoring !== 'no-entry' ? source.storedFile(file.path) : null
      return {
        file,
        ...(verification !== undefined ? { verification } : {}),
        anchoring,
        enclosed:
          bytes !== null
            ? { path: derivedFilePackagePath(parentDirectory, file.path), bytes }
            : null
      }
    })
  }

  const fileExhibitFiles: EnclosedFile[] = []
  const byFileExhibit = new Map<string, FileExhibitContents>()
  for (const exhibit of fileExhibits) {
    const bytes = encloses && exhibit.path ? source.storedFile(exhibit.path) : null
    // The file sits where the Exhibit's signed entry puts it, which for a
    // renamed row is not where its own path would.
    const packagedFrom = chainNames.get(exhibit.id)?.path ?? exhibit.path
    const enclosed =
      bytes !== null && packagedFrom ? { path: exhibitPackagePath(packagedFrom), bytes } : null
    const derivedFiles = derivedFilesOf(
      exhibit.id,
      exhibitPackageDirectory(exhibit.kind, exhibit.path)
    )
    byFileExhibit.set(exhibit.id, {
      enclosed,
      timestampTokenPath: tokens.pathByContentHash.get(exhibit.contentHash) ?? null,
      derivedFiles
    })
    if (enclosed) fileExhibitFiles.push(enclosed)
    for (const derived of derivedFiles)
      if (derived.enclosed) fileExhibitFiles.push(derived.enclosed)
  }

  const byCapture = new Map<string, CaptureContents>(
    captures.map((capture) => [
      capture.id,
      {
        timestampTokenPath: tokens.pathByContentHash.get(capture.hash) ?? null,
        derivedFiles: derivedFilesOf(
          capture.id,
          exhibitPackageDirectory('capture', capture.mhtmlPath ?? null)
        )
      }
    ])
  )

  // A row the decision never saw has no contents to report, and an answer of
  // "nothing enclosed" for it would read as a decision that was made.
  const decided = <T>(contents: Map<string, T>, rowId: string, noun: string): T => {
    const found = contents.get(rowId)
    if (!found) throw new Error(`package contents: ${noun} ${rowId} was not in the export's scope`)
    return found
  }

  return {
    ofCapture: (rowId) => decided(byCapture, rowId, 'Capture'),
    ofFileExhibit: (rowId) => decided(byFileExhibit, rowId, 'Exhibit'),
    timestampTokens: tokens.files,
    fileExhibitFiles
  }
}
