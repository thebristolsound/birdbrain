// What one export encloses: the Package Contents (CONTEXT.md). Decided here,
// once, from the chain entries, the rows in scope and the bytes the byte source
// returns. The report, the index, the Certification and the zip all read the
// result, so none of them can name a file another leaves out.
//
// Verification never reads this module: Package Verification, `verify.sh` and
// the Verify Runbook restate what a package must hold on purpose (ADR-0004),
// and `.dependency-cruiser.cjs` refuses any import that reaches it from them.

import type { Capture, DerivedFile, DerivedFileVerification, Exhibit } from '@shared/types'
import { createHash } from 'crypto'
import { stampFor } from '@shared/verify/trustedTime'
import {
  capturePagePath,
  derivedFilePackagePath,
  exhibitPackageDirectory,
  exhibitPackagePath,
  pdfPath,
  screenshotPath,
  timestampTokenPath,
  transactionRecordPath
} from '../../evidence-package-layout/index'
import type { CaptureFileType, PackageByteSource } from './byteSource'

/**
 * What the export produces, with the choices that change what it encloses.
 *
 * - An Evidence Package encloses every file a signed entry anchors, whatever
 *   was asked for. `screenshots` adds the screenshots no entry anchors. When
 *   the read of a file a signed entry records returns nothing (a Capture's
 *   anchored file, a non-Capture Exhibit's file, a Derived File an entry
 *   names), the decision throws and the export writes no package (#2225).
 * - A Working Copy is not a verifiable object (ADR-0010). It encloses the page
 *   archives when `pageArchives` is set, and for a screenshot the copy the
 *   operator works with, which `operatorScreenshots` supplies by Capture row
 *   id and which may have annotations burned in.
 * - A `report` is the standalone HTML document: it encloses nothing, and
 *   nothing is read for it.
 */
export type ExportForm =
  | { kind: 'evidence-package'; screenshots: boolean }
  | {
      kind: 'working-copy'
      pageArchives: boolean
      operatorScreenshots: ReadonlyMap<string, Buffer>
    }
  | { kind: 'report' }

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
  captures: readonly Pick<Capture, 'id' | 'caseId' | 'hash' | 'mhtmlPath'>[]
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
  /**
   * Null when the file is held back, or when its bytes could not be read
   * where that does not fail the export (see ExportForm).
   */
  enclosed: EnclosedFile | null
}

/** The fields of a `capture` entry that carry the hash of one of the Capture's files. */
export type CaptureAnchor = 'contentHash' | 'screenshotHash' | 'transactionRecordHash' | 'pdfHash'

/** One of a Capture's own files, as the export encloses it. */
export interface EnclosedCaptureFile {
  path: string
  /** SHA-256 of the bytes enclosed, which is the one read the export made of them. */
  sha256: string
  /**
   * The field of the Capture's signed entry that carries this file's hash, or
   * null when no signed entry anchors the file. Always null for a Working
   * Copy's screenshot, which is the operator's copy and not the signed bytes.
   */
  anchoredBy: CaptureAnchor | null
}

export interface CaptureContents {
  /** Null when the Capture holds no page archive, or the form leaves it out. */
  pageArchive: EnclosedCaptureFile | null
  screenshot: EnclosedCaptureFile | null
  transactionRecord: EnclosedCaptureFile | null
  pdf: EnclosedCaptureFile | null
  /** Where the Capture's Timestamp Token sits, or null when none is enclosed. */
  timestampTokenPath: string | null
  /** One for each Derived File row of the Capture, in the order given. */
  derivedFiles: readonly DerivedFileContents[]
}

export interface FileExhibitContents {
  /**
   * Null when the Exhibit has no stored path, or when its bytes could not be
   * read where that does not fail the export (see ExportForm).
   */
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
  /**
   * Each enclosed Timestamp Token once, in the order the zip writes them,
   * which is before the package's own documents.
   */
  timestampTokens: readonly EnclosedFile[]
  /**
   * Every other enclosed file once, in the order the zip writes them. An
   * Evidence Package writes them after its own documents.
   *
   * - Evidence Package: each Capture's page archive, screenshot, Transaction
   *   Record and PDF; then each other Exhibit's file and Derived Files; then
   *   each Capture's Derived Files.
   * - Working Copy: each Capture's page archive, screenshot and Derived
   *   Files; then each other Exhibit's file and Derived Files.
   */
  files: readonly EnclosedFile[]
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

/**
 * Which signed field anchors which of a Capture's files, and what an Evidence
 * Package does with a file no signed entry anchors. An Evidence Package always
 * encloses a file whose field the entry carries, because Package Verification
 * fails a signed hash whose file the package lacks (#1986; D10 of
 * docs/plans/2026-10-10-capture-engine-first-slice.md), and fails the export
 * when it cannot read one (see ExportForm). A Working Copy is not verifiable
 * and does not read this table (ADR-0010).
 *
 * A screenshot, a Transaction Record and a PDF are named by their SHA-256, so
 * Captures holding the same bytes share one file. The page archive is named
 * by the Capture's chain id. Listed in the order the zip writes them.
 */
const CAPTURE_FILE_RULES: ReadonlyArray<{
  slot: 'pageArchive' | 'screenshot' | 'transactionRecord' | 'pdf'
  type: CaptureFileType
  anchor: CaptureAnchor
  /** How an export that cannot read the file names it to the operator. */
  noun: string
  unanchored: 'enclosed' | 'when-screenshots-asked' | 'left-out'
  path: (chainId: string, sha256: string) => string
}> = [
  {
    slot: 'pageArchive',
    type: 'mhtml',
    anchor: 'contentHash',
    noun: 'page archive',
    unanchored: 'enclosed',
    path: (chainId) => capturePagePath(chainId)
  },
  {
    slot: 'screenshot',
    type: 'png',
    anchor: 'screenshotHash',
    noun: 'screenshot',
    unanchored: 'when-screenshots-asked',
    path: (_chainId, sha256) => screenshotPath(sha256)
  },
  // Neither verifier checks a file the entry carries no hash for, so an
  // unanchored one stays out, as a Derived File no entry names does (X34).
  {
    slot: 'transactionRecord',
    type: 'warc.gz',
    anchor: 'transactionRecordHash',
    noun: 'Transaction Record',
    unanchored: 'left-out',
    path: (_chainId, sha256) => transactionRecordPath(sha256)
  },
  {
    slot: 'pdf',
    type: 'pdf',
    anchor: 'pdfHash',
    noun: 'PDF',
    unanchored: 'left-out',
    path: (_chainId, sha256) => pdfPath(sha256)
  }
]

/**
 * The failure of an Evidence Package export whose read of a file a signed
 * entry records returned nothing (#2225). Package Verification fails a package
 * that lacks a file a signed entry anchors, so the export stops rather than
 * write one; it stops the same way on a Derived File an entry names over a
 * chain that does not verify, which the package would otherwise enclose.
 */
function signedFileUnread(owner: string, noun: string, path: string): Error {
  return new Error(
    `No package was written: could not read the ${noun} of ${owner} (${path}), ` +
      'which a signed entry records.'
  )
}

const NO_CAPTURE_FILES = {
  pageArchive: null,
  screenshot: null,
  transactionRecord: null,
  pdf: null
} satisfies Partial<CaptureContents>

/**
 * Each Capture's or each other Exhibit's signed entry by its chain id; where a
 * chain holds more than one, the last wins.
 */
function entriesByChainId(
  entries: readonly Record<string, unknown>[],
  type: 'capture' | 'exhibit'
): Map<string, Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>()
  for (const entry of entries) {
    const id = type === 'capture' ? entry.captureId : entry.exhibitId
    if (entry.type === type && typeof id === 'string') byId.set(id, entry)
  }
  return byId
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

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
  const encloses = form.kind !== 'report'
  const chainIdOf = (rowId: string): string => chainNames.get(rowId)?.id ?? rowId

  const tokens =
    form.kind === 'evidence-package'
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
  const derivedFilesOf = (
    parentRowId: string,
    parentDirectory: string,
    owner: string
  ): DerivedFileContents[] => {
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
      const path = derivedFilePackagePath(parentDirectory, file.path)
      if (bytes === null && anchoring !== 'no-entry' && form.kind === 'evidence-package') {
        throw signedFileUnread(owner, `${file.derivation} Derived File`, path)
      }
      return {
        file,
        ...(verification !== undefined ? { verification } : {}),
        anchoring,
        enclosed: bytes !== null ? { path, bytes } : null
      }
    })
  }
  const enclosedDerivedFiles = (decided: readonly DerivedFileContents[]): EnclosedFile[] =>
    decided.flatMap(({ enclosed }) => (enclosed ? [enclosed] : []))

  const files: EnclosedFile[] = []
  // A file named by its SHA-256 is written once, whichever Captures hold it.
  const contentAddressedPaths = new Set<string>()

  const captureEntries = entriesByChainId(entries, 'capture')
  const evidenceFilesOf = (
    capture: PackageContentsInput['captures'][number],
    screenshots: boolean
  ): Pick<CaptureContents, 'pageArchive' | 'screenshot' | 'transactionRecord' | 'pdf'> => {
    const chainId = chainIdOf(capture.id)
    const entry = captureEntries.get(chainId)
    const decided: Pick<
      CaptureContents,
      'pageArchive' | 'screenshot' | 'transactionRecord' | 'pdf'
    > = { ...NO_CAPTURE_FILES }
    for (const rule of CAPTURE_FILE_RULES) {
      const signedHash = entry?.[rule.anchor]
      const anchoredBy = typeof signedHash === 'string' ? rule.anchor : null
      const wanted =
        anchoredBy !== null ||
        rule.unanchored === 'enclosed' ||
        (rule.unanchored === 'when-screenshots-asked' && screenshots)
      const bytes = wanted ? source.captureFile(capture, rule.type) : null
      if (bytes === null && typeof signedHash === 'string') {
        // Named at the path Package Verification looks for it, from the signed hash.
        throw signedFileUnread(`Capture ${chainId}`, rule.noun, rule.path(chainId, signedHash))
      }
      if (bytes === null) continue
      const digest = sha256(bytes)
      const path = rule.path(chainId, digest)
      decided[rule.slot] = { path, sha256: digest, anchoredBy }
      if (rule.slot === 'pageArchive') {
        files.push({ path, bytes })
      } else if (!contentAddressedPaths.has(path)) {
        files.push({ path, bytes })
        contentAddressedPaths.add(path)
      }
    }
    return decided
  }

  const workingCopyFilesOf = (
    capture: PackageContentsInput['captures'][number],
    workingCopy: Extract<ExportForm, { kind: 'working-copy' }>
  ): Pick<CaptureContents, 'pageArchive' | 'screenshot' | 'transactionRecord' | 'pdf'> => {
    const chainId = chainIdOf(capture.id)
    const entry = captureEntries.get(chainId)
    const page = workingCopy.pageArchives ? source.captureFile(capture, 'mhtml') : null
    const pageArchive = page
      ? {
          path: capturePagePath(chainId),
          sha256: sha256(page),
          anchoredBy: typeof entry?.contentHash === 'string' ? ('contentHash' as const) : null
        }
      : null
    if (page && pageArchive) files.push({ path: pageArchive.path, bytes: page })
    // Named by the Capture's id, not by a hash: content addressing and the
    // hash signed at ingest are Evidence Package concepts, and no reader has
    // to agree with this path, so it is not in the Package Layout.
    const copy = workingCopy.operatorScreenshots.get(capture.id)
    const screenshot =
      copy && copy.length > 0
        ? { path: `screenshots/${chainId}.png`, sha256: sha256(copy), anchoredBy: null } // layout-exempt: Working Copy
        : null
    if (copy && screenshot) files.push({ path: screenshot.path, bytes: copy })
    return { ...NO_CAPTURE_FILES, pageArchive, screenshot }
  }

  const byCapture = new Map<string, CaptureContents>()
  for (const capture of captures) {
    const ownFiles =
      form.kind === 'evidence-package'
        ? evidenceFilesOf(capture, form.screenshots)
        : form.kind === 'working-copy'
          ? workingCopyFilesOf(capture, form)
          : NO_CAPTURE_FILES
    const derivedFiles = derivedFilesOf(
      capture.id,
      exhibitPackageDirectory('capture', capture.mhtmlPath ?? null),
      `Capture ${chainIdOf(capture.id)}`
    )
    // A Working Copy writes a Capture's Derived Files beside its own files.
    if (form.kind === 'working-copy') files.push(...enclosedDerivedFiles(derivedFiles))
    byCapture.set(capture.id, {
      ...ownFiles,
      timestampTokenPath: tokens.pathByContentHash.get(capture.hash) ?? null,
      derivedFiles
    })
  }

  const exhibitEntries = entriesByChainId(entries, 'exhibit')
  const byFileExhibit = new Map<string, FileExhibitContents>()
  for (const exhibit of fileExhibits) {
    const owner = `Exhibit ${chainIdOf(exhibit.id)}`
    const bytes = encloses && exhibit.path ? source.storedFile(exhibit.path) : null
    const signedPath = exhibitEntries.get(chainIdOf(exhibit.id))?.path
    if (bytes === null && typeof signedPath === 'string' && form.kind === 'evidence-package') {
      throw signedFileUnread(owner, `${exhibit.kind} file`, exhibitPackagePath(signedPath))
    }
    // The file sits where the Exhibit's signed entry puts it, which for a
    // renamed row is not where its own path would.
    const packagedFrom = chainNames.get(exhibit.id)?.path ?? exhibit.path
    const enclosed =
      bytes !== null && packagedFrom ? { path: exhibitPackagePath(packagedFrom), bytes } : null
    const derivedFiles = derivedFilesOf(
      exhibit.id,
      exhibitPackageDirectory(exhibit.kind, exhibit.path),
      owner
    )
    byFileExhibit.set(exhibit.id, {
      enclosed,
      timestampTokenPath: tokens.pathByContentHash.get(exhibit.contentHash) ?? null,
      derivedFiles
    })
    if (enclosed) files.push(enclosed)
    files.push(...enclosedDerivedFiles(derivedFiles))
  }

  // An Evidence Package writes every Capture's Derived Files last.
  if (form.kind === 'evidence-package') {
    for (const capture of captures) {
      files.push(...enclosedDerivedFiles(byCapture.get(capture.id)?.derivedFiles ?? []))
    }
  }

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
    files
  }
}
