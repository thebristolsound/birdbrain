/**
 * Forensic report renderer for evidence-package exports (report.html).
 *
 * Replaces buildHtmlReport() in src/main/services/export.ts. Design decisions
 * that are load-bearing and should not be "tidied" away:
 *
 *  - Paper-first. The document is a flowing print document: @page owns the
 *    paper geometry (US Letter by default, A4 honoured via the size keyword
 *    swap in REPORT_PAGE_CSS), sections declare their own break behaviour, and
 *    every exhibit starts on a fresh sheet. There is no fixed-height sheet
 *    scaffolding, because generated content length is unbounded (long UAs,
 *    tall screenshots, long annotation legends) and fixed sheets silently clip.
 *
 *  - No page numbers are written into the HTML. Chromium does not support
 *    @page margin boxes, and counter(page) is unavailable outside them, so any
 *    number rendered here would be a guess. Numbering comes from the print
 *    engine: pass PDF_FOOTER_TEMPLATE to webContents.printToPDF (see the export
 *    at the bottom of this file) or let the browser's own print footer supply
 *    it. The contents module therefore indexes sections and exhibits, not
 *    pages.
 *
 *  - No package hash on the report. report.html is itself an artifact inside
 *    the package, and packageHash commits to artifact content, so printing the
 *    package hash here would be circular. The report points at manifest head +
 *    evidence.json instead.
 *
 *  - Greyscale-safe. Nothing in this document encodes meaning in colour: every
 *    state is spelled out in words. This survives photocopying, faxing and
 *    black-and-white printing, all of which happen to evidence exhibits.
 *
 *  - Modules are data. REPORT_MODULES is an ordered registry keyed by id; the
 *    caller passes the ids it wants, in the order it wants them. A module that
 *    has nothing to say returns null and is dropped, including from contents.
 */

import type {
  AnnotationPin,
  Capture,
  DerivedFileVerification,
  ExhibitVerification,
  ExportOptions,
  ExportPreflight,
  HashVerification,
  TrustedTime,
  WaybackRef
} from '@shared/types'
import type { TrustedTimeResult } from '@shared/verify'
import { recordedHttpStatus } from '@shared/httpStatus'
import { formatSnapshotDelta } from '@shared/wayback'
import {
  TRUSTED_TIME_AUTHORITY_DECLINED,
  TRUSTED_TIME_UNRECORDED_STAMPED_AT,
  trustedTimeAttestingParty,
  trustedTimeLabel
} from '@shared/trustedTimeDisclosure'

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * What the export package actually contains for one capture, as opposed to what
 * the capture record suggests it should. The renderer must never derive these
 * from proxies — a stored screenshotHash does not mean a screenshot was
 * packaged, and a capture id does not determine the timestamp token's filename
 * when duplicates share a content hash. The caller computes these from the same
 * manifest and filesystem snapshot the package is built from, so report.html
 * cannot cite a file the package does not contain.
 */
export interface PackagedArtifacts {
  /** `pages/<id>.mhtml`, or null when the archive could not be read. */
  pageArchive: string | null
  /** `screenshots/<sha256>.png`, or null when screenshots were not packaged. */
  screenshot: string | null
  /** `timestamps/<id>.tst`, or null when no token is packaged for this capture. */
  timestampToken: string | null
  /**
   * SHA-256 of the screenshot bytes this export actually read, which is what
   * the package stores and what the exhibit reproduces. Not the same as the
   * capture's recorded screenshotHash if the sidecar has changed since ingest —
   * the exhibit reports both when they disagree rather than picking one.
   */
  screenshotDigest: string | null
  /**
   * True when the image reproduced in the report differs from the packaged
   * original because annotations were burned into its pixels. Derived from
   * whether burning actually changed the bytes, not from the presence of pins —
   * shapes (redactions, highlights) burn without producing any pin.
   */
  imageAnnotated: boolean
}

/**
 * Everything the report renders. This is the existing ExportData shape plus
 * fields the old renderer did not have access to: caseId, manifestHead,
 * toolVersion and packagedPaths.
 */
/**
 * Whether a capture's manifest entry carries a per-entry RSA signature.
 *
 * `unsigned-legacy` is a `schemaVersion` 1 entry: per-entry signing was added
 * after the chain itself, so entries written before it have no `signature`
 * field. manifestChain.ts grandfathers them deliberately — they verify on chain
 * linkage alone — but a reader must be able to tell them apart from a signed
 * entry without opening manifest.jsonl (#581).
 *
 * `no-entry` is a capture with no `capture` entry in the chain at all, which is
 * the older "legacy record" case the integrity axis already reports.
 */
export type EntrySignatureStatus = 'signed' | 'unsigned-legacy' | 'no-entry'

/**
 * One Derived File as this export packages and reports it (X17, X31). It
 * carries no Exhibit Number of its own: a Derived File is cited by its parent
 * and its derivation, which is why `derivation` is the name shown.
 */
export interface ExportDerivedFile {
  id: string
  derivation: string
  toolVersion: string
  contentHash: string
  /** Storage-root-relative path, as the `derived_files` row records it. */
  storedPath: string
  /**
   * What the chain says about this file, in three states rather than two:
   *
   * - `anchored`: a `derivation` entry on the verified chain vouches for it.
   * - `no-entry`: no line names it at all (X34 — the legacy thumbnail the
   *   backfill could not anchor). The package does not enclose it and
   *   evidence.json does not list it.
   * - `chain-unverified`: a line names it and the chain does not verify. The
   *   file still ships, because the hold-back rule keys on a MISSING entry and
   *   not on a failing chain, and no document may say the entry is absent when
   *   it is sitting in the same package.
   */
  anchoring: 'anchored' | 'no-entry' | 'chain-unverified'
  /** Package-relative path, null when this export encloses nothing for it. */
  packagedPath: string | null
  manifestIndex: number | null
  /** Outcome of binding these bytes to the chain; absent when nothing ran. */
  verification?: DerivedFileVerification
}

/**
 * One committed non-Capture Exhibit as this export packages and reports it
 * (ADR-0023). The Capture fields a report exhibit carries — URL, page title,
 * capture environment — have no counterpart here: an attachment was supplied to
 * the operator rather than retrieved by Birdbrain, and the document says so
 * rather than leaving blanks that read as missing data.
 */
export interface ExportFileExhibit {
  id: string
  kind: string
  origin: string
  exhibitNumber: number
  /** The number as the document cites it: prefixed by Member Code in a Shared Case (#1510). */
  citation: string
  name: string
  contentHash: string
  storedPath: string | null
  sizeBytes: number | null
  committedAt: string
  manifestIndex: number | null
  /** Package-relative path, null for a non-package export or unreadable bytes. */
  packagedPath: string | null
  /** `timestamps/<id>.tst`, or null when no token is packaged for it. */
  timestampTokenPath: string | null
  derivedFiles: ExportDerivedFile[]
  trustedTime: TrustedTimeResult
  entrySignature: EntrySignatureStatus
  /** Outcome of the export's verification run; absent when none ran. */
  verification?: ExhibitVerification
}

export interface ReportData {
  caseId: string
  caseName: string
  caseDescription?: string
  dateRange: { first: string; last: string } | null
  exportTimestamp: string
  captures: Capture[]
  verifications: HashVerification[]
  /** captureId -> base64 PNG, as rendered into the report (may be annotated). */
  screenshots: Map<string, string>
  /** captureId -> annotation pins, present when annotations were burned in. */
  pins: Map<string, AnnotationPin[]>
  installationId: string
  operatorName: string
  operatorRole: string
  operatorOrganization: string
  tsaUrl: string
  /**
   * Whether the installation submits anything to the authority named by `tsaUrl`
   * (#1169). Optional and true when absent, matching the settings default: a
   * caller that predates the opt-out described an installation that timestamped.
   * Naming a configured authority under a declined opt-out would have the
   * document assert a relationship with a third party the operator refused.
   */
  tsaEnabled?: boolean
  /**
   * The same resolution `trustedTimeByCaptureId` carries, pre-counted. Nothing in
   * this renderer reads it — every figure printed here is folded out of the rows
   * it appears beside — but ExportData aliases this shape, and evidence.json's
   * warnings block is counted from it.
   */
  preflight: ExportPreflight
  toolVersion: string
  /** Manifest state this report was generated against; null when unreadable. */
  manifestHead: { index: number; entryHash: string } | null
  /**
   * Per-capture packaged artefact paths, keyed by capture id. Empty for a
   * standalone HTML export, which produces no package — the report then cites no
   * file paths at all rather than pointing at a package that was never built.
   */
  packagedPaths: Map<string, PackagedArtifacts>
  /**
   * Manifest-derived trusted time, keyed by capture id, resolved once from the
   * snapshot this package is built from and shared with `preflight` above — see
   * resolveExportTrustedTime in export.ts.
   */
  trustedTimeByCaptureId: Map<string, TrustedTimeResult>
  /**
   * Per-entry signature status, keyed by capture id, resolved from the same
   * manifest snapshot — see resolveEntrySignatures in export.ts. A capture with
   * no key here is reported as `no-entry` rather than as signed (#581).
   */
  entrySignatureByCaptureId: Map<string, EntrySignatureStatus>
  /**
   * Captures the chain still claims — a `capture` entry with no matching
   * `deletion` entry — that this package does not contain. Resolved once by
   * resolveUnreconciledChainCaptures in export.ts and shared with evidence.json's
   * warnings block, so the document and the index cannot disagree (#580).
   */
  unreconciledChainCaptureIds: string[]
  /**
   * Whether tsa-root.pem is shipped for the configured TSA. False for a
   * non-default authority, where tsa-intermediates.pem holds only
   * certificates lifted from the tokens themselves — validating a token against
   * those is circular, and the verification instructions must say so rather than
   * implying the check establishes authenticity.
   */
  tsaTrustAnchorBundled: boolean
  /**
   * Pinned archive.org references, keyed by capture id (#401). Corroboration
   * only, and deliberately references rather than content: nothing here was
   * retrieved, hashed or packaged by Birdbrain, and a pin never converts a
   * replayed snapshot into a Capture (ADR-0002). Empty or absent for a capture
   * the operator pinned nothing to, which renders no block at all.
   */
  waybackRefsByCaptureId: Map<string, WaybackRef[]>
  /**
   * Committed non-Capture Exhibits in this export, in Exhibit Number order
   * (ADR-0023, #1156). A Capture is an Exhibit too, and its row lives in
   * `captures` above — splitting the two here is a rendering convenience, not a
   * second model: both are numbered from the one `exhibits` table and both are
   * cited by that number.
   */
  fileExhibits: ExportFileExhibit[]
  /**
   * Stored Exhibit Number per Capture, read from the `exhibits` table (X18).
   * Never derived from sort position: a number is a citation, and a citation
   * that moves when a capture is added or deleted cites nothing.
   */
  exhibitNumberByCaptureId: Map<string, number>
  /**
   * The citation per Capture (#1510): `NK-12` in a Shared Case, `12`
   * otherwise. An export always carries the Member Code when the Case has a
   * roster (decision 7); the number above still orders the rows.
   */
  exhibitCitationByCaptureId: Map<string, string>
  /**
   * Derived Files per Capture — the list thumbnail at head (X34) — keyed by
   * capture id, with the same packaging and verification treatment every other
   * Exhibit's Derived Files get.
   */
  derivedFilesByCaptureId: Map<string, ExportDerivedFile[]>
  /**
   * Selection scope (#398, ADR-0009): set when the operator exported a
   * selection rather than the whole case. The custody module states that the
   * Manifest covers the whole Case while the artifacts cover the selection, so
   * the mismatch reads as designed behaviour rather than as missing evidence.
   *
   * `excludedExhibitCount` states how many committed non-Capture Exhibits the
   * selection leaves out, the disclosure #985 established for notes: a reader
   * reconciling the package against the chain must be told the number rather
   * than left to count it.
   *
   * `omittedNoteCount` carries that same disclosure for the operator notes the
   * scope leaves behind (#985). It is zero when notes were excluded from the
   * export altogether — there is no notes.md for the reader to mistake for the
   * Case's complete work product then, so the custody module says nothing.
   */
  selectionScope: {
    selectedCaptureCount: number
    caseCaptureCount: number
    excludedExhibitCount: number
    omittedNoteCount: number
  } | null
}

export type ReportModuleId =
  | 'cover'
  | 'contents'
  | 'scope'
  | 'methodology'
  | 'custody'
  | 'exhibitIndex'
  | 'exhibits'
  | 'verification'
  | 'signature'

/** Default order. Callers may reorder or drop any entry. */
export const DEFAULT_REPORT_MODULES: ReportModuleId[] = [
  'cover',
  'contents',
  'scope',
  'methodology',
  'custody',
  'exhibitIndex',
  'exhibits',
  'verification',
  'signature'
]

interface ReportModule {
  id: ReportModuleId
  /** Heading used in the document and in the contents index. */
  title: string
  /** Returns null when the module has nothing to render for this export. */
  render: (ctx: ReportContext) => string | null
}

interface ReportContext {
  data: ReportData
  options: ExportOptions
  exhibits: ExhibitView[]
  /** Committed non-Capture Exhibits, in Exhibit Number order (#1156). */
  fileExhibits: FileExhibitView[]
  /** Modules that actually rendered, in order — used by the contents index. */
  included: ReportModuleId[]
}

/**
 * The export's verification result, counted ONCE over the rows both the cover
 * and the chain-of-custody section print (the #611 pattern the certification
 * already follows). Two derivations is what let the cover say "4 / 4 integrity
 * verified · produced by the verification run recorded under Chain of custody"
 * over a custody section that said "1 of 1 verified" — or, on a selection of
 * committed Exhibits alone, "No verification was run for this export."
 */
function verificationTally(ctx: ReportContext): { verified: number; total: number; ran: boolean } {
  const rows = exhibitRows(ctx)
  return {
    verified: rows.filter((row) => row.view.integrity.label === 'Verified').length,
    total: rows.length,
    ran:
      ctx.data.verifications.length > 0 ||
      ctx.fileExhibits.some((exhibit) => exhibit.exhibit.verification !== undefined)
  }
}

/**
 * Every Exhibit the document lists, in stored Exhibit Number order across
 * kinds (X18). Captures are dropped when the operator excluded them; the other
 * kinds are not, because excluding captures is a statement about captures and
 * a package holding a committed attachment still has to account for it.
 */
type ExhibitRow =
  | { entity: 'capture'; number: number; citation: string; view: ExhibitView }
  | { entity: 'file'; number: number; citation: string; view: FileExhibitView }

function exhibitRows(ctx: ReportContext): ExhibitRow[] {
  const rows: ExhibitRow[] = ctx.options.include.captures
    ? ctx.exhibits.map((view) => ({
        entity: 'capture' as const,
        number: view.number,
        citation: view.citation,
        view
      }))
    : []
  for (const view of ctx.fileExhibits) {
    rows.push({ entity: 'file', number: view.number, citation: view.citation, view })
  }
  return rows.sort((a, b) => a.number - b.number)
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

interface StateView {
  /** Single-word state for tables. */
  label: string
  /** Sentence explaining what the state does and does not mean. */
  detail: string
}

interface ExhibitView {
  number: number
  citation: string
  capture: Capture
  verification?: HashVerification
  integrity: StateView
  time: StateView & { basis: TrustedTime }
  entrySignature: StateView
  /** base64 PNG as reproduced in this report, if screenshots were included. */
  screenshot?: string
  pins: AnnotationPin[]
  annotationsBurned: boolean
  /** Packaged artefact paths for this capture; all null for a non-package export. */
  packaged: PackagedArtifacts
  /**
   * True when the stored page archive is not in the package. Read from the
   * packaged path rather than from verification status, because an export that
   * runs no verification still knows perfectly well whether it packaged the file.
   */
  pageArchiveMissing: boolean
  /** Pinned archive.org references for this capture, oldest snapshot first. */
  waybackRefs: WaybackRef[]
  /** Derived Files computed from this Capture — its thumbnail at head (X34). */
  derivedFiles: ExportDerivedFile[]
}

/** A committed non-Capture Exhibit, as the document renders it (#1156). */
interface FileExhibitView {
  number: number
  citation: string
  exhibit: ExportFileExhibit
  integrity: StateView
  time: StateView & { basis: TrustedTime }
  entrySignature: StateView
  /** True when the package should hold the bytes and does not. */
  contentMissing: boolean
}

/**
 * How an Exhibit is cited. A number is only ever the one the `exhibits` table
 * recorded at commit (X18); when a row carries none — which no path in this
 * build produces, and a database restored by hand might — the document says so
 * rather than counting the exhibit's position and presenting that as a
 * citation. Escaped: a Member Code can arrive in an imported archive.
 */
function exhibitTag(citation: string): string {
  return citation ? `Exhibit ${esc(citation)}` : 'Exhibit (number not recorded)'
}

/**
 * The Exhibit Numbers in this package, stated as a citation range rather than
 * as "1–N": a selection-scoped export, or a case that has had an Exhibit
 * deleted, carries numbers with gaps in them and "1–N" would assert a
 * contiguity the chain does not record.
 *
 * A Shared Case cites `NK-12` and each member's sequence is its own, so a
 * numeric range across members would assert an order nobody recorded: the
 * citations are listed, or the reader is sent to the index.
 */
function describeExhibitNumbers(views: Array<{ number: number; citation: string }>): string {
  const known = views.filter((v) => v.number > 0).sort((a, b) => a.number - b.number)
  if (known.length === 0) return ''
  if (known.some((v) => v.citation !== String(v.number))) {
    if (known.length <= 8) return ` (Exhibits ${known.map((v) => esc(v.citation)).join(', ')})`
    return ` (${known.length} cited by Member Code; see the exhibit index)`
  }
  const first = known[0].number
  const last = known[known.length - 1].number
  if (last - first + 1 === known.length) {
    return known.length === 1 ? ` (Exhibit ${first})` : ` (Exhibits ${first}–${last})`
  }
  if (known.length <= 8) return ` (Exhibits ${known.map((v) => v.number).join(', ')})`
  return ` (Exhibits ${first}–${last}, with gaps; see the exhibit index)`
}

/**
 * True when this export produces an evidence package alongside the report. Only
 * then may the document refer to enclosed companion files; a standalone HTML
 * export bundles nothing, and sending a reviewer looking for files that were
 * never generated undermines the rest of the document.
 */
function isPackagedExport(options: ExportOptions): boolean {
  return options.format === 'zip'
}

const NO_ARTIFACTS: PackagedArtifacts = {
  pageArchive: null,
  screenshot: null,
  timestampToken: null,
  screenshotDigest: null,
  imageAnnotated: false
}

const NO_TRUSTED_TIME: TrustedTimeResult = { trustedTime: 'none' }

function buildExhibits(data: ReportData, options: ExportOptions): ExhibitView[] {
  const byCaptureId = new Map(data.verifications.map((v) => [v.captureId, v]))
  // Ordered by the Exhibit Number the `exhibits` table assigned (X18), with
  // capture time breaking a tie only for a row that carries no number. Sorting
  // by timestamp and numbering by position — what this did before #1156 — made
  // "Exhibit 3" mean a different capture in every export it appeared in.
  const ordered = [...data.captures].sort((a, b) => {
    const byNumber =
      (data.exhibitNumberByCaptureId.get(a.id) ?? 0) -
      (data.exhibitNumberByCaptureId.get(b.id) ?? 0)
    return byNumber !== 0 ? byNumber : a.timestamp.localeCompare(b.timestamp)
  })
  const isPackage = options.format === 'zip'

  return ordered.map((capture) => {
    const verification = byCaptureId.get(capture.id)
    const trustedTime = data.trustedTimeByCaptureId.get(capture.id) ?? NO_TRUSTED_TIME
    const packaged = data.packagedPaths.get(capture.id) ?? NO_ARTIFACTS
    const number = data.exhibitNumberByCaptureId.get(capture.id) ?? 0
    return {
      number,
      citation: number > 0 ? (data.exhibitCitationByCaptureId.get(capture.id) ?? `${number}`) : '',
      capture,
      verification,
      integrity: integrityView(verification, capture),
      time: { basis: trustedTime.trustedTime, ...trustedTimeView(trustedTime) },
      entrySignature: entrySignatureView(
        data.entrySignatureByCaptureId.get(capture.id) ?? 'no-entry'
      ),
      screenshot: data.screenshots.get(capture.id),
      pins: data.pins.get(capture.id) ?? [],
      annotationsBurned: packaged.imageAnnotated,
      packaged,
      // Only a package can be missing a packaged file. A standalone HTML export
      // bundles nothing, so absence there is not a gap to report.
      pageArchiveMissing: isPackage && packaged.pageArchive === null,
      waybackRefs: [...(data.waybackRefsByCaptureId.get(capture.id) ?? [])].sort((a, b) =>
        a.snapshotTimestamp.localeCompare(b.snapshotTimestamp)
      ),
      derivedFiles: data.derivedFilesByCaptureId.get(capture.id) ?? []
    }
  })
}

function buildFileExhibits(data: ReportData, options: ExportOptions): FileExhibitView[] {
  const isPackage = options.format === 'zip'
  return [...data.fileExhibits]
    .sort((a, b) => a.exhibitNumber - b.exhibitNumber)
    .map((exhibit) => ({
      number: exhibit.exhibitNumber,
      citation: exhibit.exhibitNumber > 0 ? exhibit.citation : '',
      exhibit,
      integrity: exhibitIntegrityView(exhibit),
      time: { basis: exhibit.trustedTime.trustedTime, ...trustedTimeView(exhibit.trustedTime) },
      entrySignature: entrySignatureView(exhibit.entrySignature),
      contentMissing: isPackage && exhibit.packagedPath === null
    }))
}

/**
 * Integrity for a committed Exhibit, worded as the Capture axis is and folded
 * out of the same verification run. The vocabulary is `verifyExhibit`'s (X37),
 * including `unsupported`, which is a statement about this build's age and must
 * never be rendered as tampering (X25).
 */
function exhibitIntegrityView(exhibit: ExportFileExhibit): StateView {
  const verification = exhibit.verification
  if (!verification) {
    return {
      label: 'Not verified in this export',
      detail:
        'No verification was run for this exhibit during this export, so no integrity ' +
        'statement is made here.'
    }
  }
  const at = exhibit.manifestIndex !== null ? ` at manifest entry #${exhibit.manifestIndex}` : ''
  switch (verification.status) {
    case 'verified':
      return {
        label: 'Verified',
        detail: `The stored bytes recompute to the digest the manifest chain records${at}.`
      }
    case 'tampered':
      return {
        label: 'Altered',
        detail:
          'The stored bytes no longer recompute to the digest recorded for this exhibit. It ' +
          'must not be relied upon.'
      }
    case 'chain-broken':
      return {
        label: 'Chain broken',
        detail:
          `The manifest chain does not reconcile${at}, so sequence and custody cannot be ` +
          `demonstrated for this exhibit.` +
          (verification.reason ? ` Reported reason: ${verification.reason}.` : '')
      }
    case 'missing':
      return {
        label: 'Absent',
        detail:
          'The stored file could not be read at verification time. This row is retained rather ' +
          'than removed so that the gap is visible.'
      }
    case 'unsupported':
      return {
        label: 'Not readable by this build',
        detail:
          'The manifest holds an entry written by a newer Birdbrain than the one that produced ' +
          'this report, so this build makes no integrity statement about this exhibit. That is ' +
          'not a finding of alteration.'
      }
    default:
      return {
        label: 'Unknown',
        detail: 'The verification result for this exhibit could not be interpreted.'
      }
  }
}

function integrityView(verification: HashVerification | undefined, capture: Capture): StateView {
  const status = verification?.status ?? capture.lastVerifiedStatus
  const at = verification?.manifestIndex ?? capture.manifestIndex
  const entry = at !== undefined ? ` at manifest entry #${at}` : ''

  if (!verification) {
    return {
      label: 'Not verified in this export',
      detail:
        'No verification was run for this capture during this export, so no integrity ' +
        'statement is made here. Any earlier verification result is not reproduced as a ' +
        'current finding.'
    }
  }
  switch (status) {
    case 'verified':
      return {
        label: 'Verified',
        detail: `The stored bytes recompute to the recorded digest and the manifest chain reconciles${entry}.`
      }
    case 'tampered':
      return {
        label: 'Altered',
        detail:
          'The stored bytes no longer recompute to the recorded digest. This capture must not ' +
          'be relied upon.' +
          (verification.reason ? ` Reported reason: ${verification.reason}.` : '')
      }
    case 'chain-broken':
      return {
        label: 'Chain broken',
        detail:
          `The stored bytes recompute to the recorded digest, but the manifest chain does not ` +
          `reconcile${entry}. Sequence and custody cannot be demonstrated for this entry.`
      }
    case 'missing':
      return {
        label: 'Absent',
        detail:
          'The stored artefact could not be read at verification time. This row is retained ' +
          'rather than removed so that the gap is visible.'
      }
    case 'legacy':
      return {
        label: 'Legacy record',
        detail:
          'This capture predates the hash-chained manifest. Its digest is recorded but is not ' +
          'chain-bound, so ordering cannot be demonstrated from the manifest alone.'
      }
    default:
      return {
        label: 'Unknown',
        detail: 'The verification result for this capture could not be interpreted.'
      }
  }
}

// Stated per exhibit because it is not uniform across a chain: a case older
// than the signing feature carries both kinds, and presenting the unsigned ones
// as plain "Verified" lets a reader infer a guarantee no entry gives them
// (#581). Absence is legitimate here — it is not a finding of tampering.
function entrySignatureView(status: EntrySignatureStatus): StateView {
  switch (status) {
    case 'signed':
      return {
        label: 'Present',
        detail:
          'The manifest entry for this capture carries an RSA signature over its entry ' +
          'hash, verifiable against the enclosed public key.'
      }
    case 'unsigned-legacy':
      return {
        label: 'Absent (pre-signing tool version)',
        detail:
          'This entry was written before per-entry signing existed, so it carries no ' +
          'signature. It is covered by chain linkage and by any timestamp appended later, ' +
          'and by nothing else. This is expected for an older entry, not a sign of alteration.'
      }
    case 'no-entry':
      return {
        label: 'No manifest entry',
        detail:
          'No entry for this capture was found in the chain, so there is no signature to ' +
          'report and no chain position to cite.'
      }
  }
}

// Labels and the token-fallback phrases come from the shared disclosure
// vocabulary so this report and the per-capture PDF cover name each axis value
// identically; the explanatory detail is this artifact's own.
function trustedTimeView(resolved: TrustedTimeResult): StateView {
  const label = trustedTimeLabel(resolved)
  switch (resolved.trustedTime) {
    case 'rfc3161': {
      const who = trustedTimeAttestingParty(resolved)
      const when = resolved.stampedAt ? isoUtc(resolved.stampedAt) : null
      return {
        label,
        detail:
          `${who} asserts that the capture content digest existed no later than ` +
          `${when ?? TRUSTED_TIME_UNRECORDED_STAMPED_AT}. The token attests to the ` +
          'digest only; it says nothing about what the page contained or who published it.'
      }
    }
    case 'pending':
      return {
        label,
        // Never "a timestamp was requested": the manifest records tokens, not
        // requests, and trusted timestamping can be declined for the whole
        // installation (#1169), in which case no request was ever made. The
        // axis means only that this capture is of a class that can be stamped
        // and carries no token.
        detail:
          'No RFC 3161 token is recorded for this capture; the manifest does not state ' +
          "whether one was ever requested. The capture time shown is the operator's local " +
          'system clock and carries no independent corroboration.'
      }
    case 'none':
    default:
      return {
        label,
        detail:
          'No RFC 3161 token is retained for this capture. The capture time shown is the ' +
          "operator's local system clock and carries no independent corroboration."
      }
  }
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

export const REPORT_MODULES: Record<ReportModuleId, ReportModule> = {
  cover: {
    id: 'cover',
    title: 'Cover',
    render: (ctx) => {
      const { data, exhibits, fileExhibits, options } = ctx
      // Counted over every kind the package holds (ADR-0023): a tally that
      // covered captures only would report "2 / 2 integrity verified" over a
      // package that also encloses an altered attachment.
      const rows = exhibitRows(ctx)
      const { verified, total, ran: verificationRan } = verificationTally(ctx)
      const stamped = rows.filter((r) => r.view.time.basis === 'rfc3161').length
      const hosts = new Set(exhibits.map((e) => hostOf(e.capture.url)).filter(Boolean)).size
      const archived = exhibits.filter((e) => !e.pageArchiveMissing).length
      const packaged = isPackagedExport(options)

      return `
<section class="sheet cover">
  <header class="wordmark">
    <span class="wordmark-name">Birdbrain</span>
    <span class="wordmark-kind">Forensic capture report</span>
  </header>
  <div class="rule-heavy"></div>

  <p class="eyebrow">Case</p>
  <h1 class="case-name">${esc(data.caseName)}</h1>
  ${data.caseDescription ? `<p class="case-desc">${esc(data.caseDescription)}</p>` : ''}

  <div class="field-grid rule-top">
    ${field('Case identifier', mono(esc(data.caseId)))}
    ${field(
      'Capture period (UTC)',
      mono(
        data.dateRange
          ? `${isoUtc(data.dateRange.first)} — ${isoUtc(data.dateRange.last)}`
          : 'no captures'
      )
    )}
    ${field(
      packaged ? 'Captures in package' : 'Captures described',
      exhibits.length > 0 ? `${exhibits.length}${describeExhibitNumbers(exhibits)}` : 'none'
    )}
    ${
      fileExhibits.length > 0
        ? field(
            packaged ? 'Other exhibits in package' : 'Other exhibits described',
            `${fileExhibits.length}${describeExhibitNumbers(fileExhibits)}`
          )
        : ''
    }
    ${field('Report generated', mono(`${isoUtc(data.exportTimestamp)} (${local(data.exportTimestamp)})`))}
  </div>

  <p class="eyebrow spaced">Custody</p>
  <div class="field-grid rule-top">
    ${field('Operator (self-asserted)', esc(operatorLine(data)))}
    ${field('Installation identifier', mono(esc(data.installationId)))}
    ${field('Tool / hash algorithm', `Birdbrain ${esc(data.toolVersion)} · SHA-256`)}
  </div>

  <p class="eyebrow spaced">Manifest reference</p>
  <div class="rule-top">
    ${
      data.manifestHead
        ? field(
            'Manifest head at generation',
            mono(`entry #${data.manifestHead.index} · ${esc(data.manifestHead.entryHash)}`),
            true
          )
        : field(
            'Manifest head at generation',
            'Not available — the case manifest could not be read when this report was generated.',
            true
          )
    }
    ${field(
      'Time-stamping authority (configured)',
      data.tsaEnabled === false
        ? esc(TRUSTED_TIME_AUTHORITY_DECLINED)
        : data.tsaUrl
          ? mono(esc(data.tsaUrl))
          : 'none configured',
      true
    )}
  </div>

  <div class="attest-box">
    <p class="box-title">${packaged ? 'Attested state of this package' : 'State of the captures described'}</p>
    <div class="tally">
      ${
        verificationRan
          ? tally(`${verified} / ${total}`, 'Integrity verified')
          : tally(`0 / ${total}`, 'Integrity verified')
      }
      ${tally(`${stamped} / ${total}`, 'RFC 3161 trusted time')}
      ${packaged ? tally(`${archived} / ${exhibits.length}`, 'Page archive present') : ''}
      ${tally(String(hosts), hosts === 1 ? 'Distinct host' : 'Distinct hosts')}
    </div>
    <p class="box-note">${
      verificationRan
        ? 'The integrity count is produced by the verification run recorded under “Chain of custody”.'
        : '<strong>No verification was run for this export</strong>, so no capture is counted as integrity verified; the figure is not a finding of failure. The trusted-time count is read from the manifest rather than recomputed.'
    } Identity fields above are entered by the operator and are not authenticated by
    Birdbrain. This report attests to the integrity and timing of stored bytes only — never to
    the truthfulness of the captured content.${
      packaged
        ? ''
        : ' This document was exported on its own; the captures it describes are not enclosed with it.'
    }</p>
  </div>
</section>`
    }
  },

  contents: {
    id: 'contents',
    title: 'Contents',
    render: (ctx) => {
      const { included, options, data } = ctx
      const listed = included.filter((id) => id !== 'cover' && id !== 'contents')
      if (listed.length === 0) return null
      const rows = listed
        .map((id) => {
          if (id === 'exhibits') {
            return exhibitRows(ctx)
              .map(
                (row) =>
                  `<li class="toc-row"><span class="toc-label">${exhibitTag(row.citation)} — ${esc(
                    row.entity === 'capture' ? row.view.capture.title : row.view.exhibit.name
                  )}</span></li>`
              )
              .join('')
          }
          return `<li class="toc-row"><span class="toc-label">${esc(
            REPORT_MODULES[id].title
          )}</span></li>`
        })
        .join('')

      return `
<section class="sheet">
  <h2>Contents</h2>
  <div class="rule-medium"></div>
  <ol class="toc">${rows}</ol>
  <p class="fine">Page numbers are supplied by the printing engine rather than written into this
  file, so that a printed copy can never disagree with its own index. Sections and exhibits are
  listed in document order.</p>
  ${
    isPackagedExport(options)
      ? `<p class="fine">Companion files in this evidence package: <code>evidence.json</code>,
  <code>manifest.jsonl</code>, <code>certification.html</code>,
  <code>signing-public-key.pem</code>, <code>tsa-intermediates.pem</code>,${
    data.tsaTrustAnchorBundled ? ' <code>tsa-root.pem</code>,' : ''
  } <code>VERIFY.md</code>, <code>verify.sh</code>,
  and the <code>pages/</code>, <code>screenshots/</code> and <code>timestamps/</code>
  directories${
    ctx.fileExhibits.length > 0
      ? `, plus the enclosed bytes of every other exhibit under ${[
          ...new Set(
            ctx.fileExhibits
              .map((e) => (e.exhibit.packagedPath ?? '').split('/')[0])
              .filter((dir) => dir.length > 0)
          )
        ]
          .sort()
          .map((dir) => `<code>${esc(dir)}/</code>`)
          .join(', ')}`
      : ''
  }.</p>`
      : `<p class="fine">This is a standalone report, not an evidence package. The stored page
  archives, timestamp tokens, signing key and machine-readable record described in the following
  sections are not enclosed with it; export the case as an evidence package to obtain them.</p>`
  }
</section>`
    }
  },

  scope: {
    id: 'scope',
    title: 'Scope and limitations',
    render: () => `
<section class="sheet">
  <h2>Scope and limitations</h2>
  <div class="rule-medium"></div>
  <p>This report describes what Birdbrain recorded and what it can demonstrate about that
  recording. It is deliberately narrow. A reader should treat the four statements below as the
  boundary of the tool's assertions.</p>
  <dl class="scope rule-top">
    <div class="scope-row">
      <dt>Is attested</dt>
      <dd>Of each capture <em>whose exhibit records a verified result</em>: that its stored bytes
      recompute to the recorded SHA-256 digest, and that the digest is bound into an append-only
      hash-chained manifest. Where a timestamp token is retained, that the digest existed no later
      than the time asserted by the named RFC 3161 authority. This is asserted per capture and
      never for the package as a whole — the exhibit index states the result for each, and any
      capture recorded there as altered, chain-broken, absent, legacy or not verified is excluded
      from this statement.</dd>
    </div>
    <div class="scope-row">
      <dt>Is not attested</dt>
      <dd>The truthfulness, authorship or lawfulness of any captured page; the identity of the
      person or entity operating a captured site; and the real-world identity of this tool's
      operator. Operator name, role and organisation are entered by the operator and are not
      cryptographically authenticated by Birdbrain.</dd>
    </div>
    <div class="scope-row">
      <dt>Corroboration only</dt>
      <dd>Where a TLS certificate chain or a public web-archive record appears in an exhibit it
      is labelled as corroboration. It was obtained by contacting the origin or the archive
      <em>after</em> storage, at the stated retrieval time, and is therefore not bound to the
      captured transaction.</dd>
    </div>
    <div class="scope-row">
      <dt>Clock basis</dt>
      <dd>Capture times shown without an RFC 3161 token derive from the operator's local system
      clock and carry no independent corroboration. Every exhibit states which basis applies to
      it; no capture is presented as timestamped unless a token is retained for it.</dd>
    </div>
  </dl>
</section>`
  },

  methodology: {
    id: 'methodology',
    title: 'Method of capture and preservation',
    render: ({ options }) => `
<section class="sheet">
  <h2>Method of capture and preservation</h2>
  <div class="rule-medium"></div>
  <p>Each page was captured as a self-contained MHTML archive, so that the HTML, stylesheets,
  scripts and images served at capture time are preserved together in one file rather than
  re-fetched at reading time. The captured bytes were hashed with SHA-256 immediately on
  storage.</p>
  <p>Each digest was appended to a per-case manifest as a single-line entry containing the entry
  index, the previous entry's hash and the hash of the entry itself. Because every entry commits
  to its predecessor, altering a capture or removing, reordering or editing a manifest line
  breaks the chain at that point and is detectable by recomputation.</p>
  <p>Where trusted time is enabled, the capture content digest — not the page content — was
  submitted to an RFC 3161 Time-Stamping Authority, and the returned token was retained beside
  the capture${
    isPackagedExport(options) ? ' and bundled under <code>timestamps/</code>' : ''
  }. A token asserts that the digest existed
  at or before the time the authority states; it says nothing about what the page contained or
  who published it.</p>
  <p>Screenshots are stored content-addressed: the file name of each image is its own SHA-256
  digest${
    isPackagedExport(options)
      ? ', so an image reproduced in an exhibit can be matched to the packaged file by name alone'
      : ''
  }. Where annotations were burned into an exhibit image for legibility, the exhibit says so and
  the unannotated original remains the stored, digest-anchored copy.</p>
</section>`
  },

  custody: {
    id: 'custody',
    title: 'Chain of custody and manifest reference',
    render: (ctx) => {
      const { data, options } = ctx
      // The same single derivation the cover prints, over the same rows: the
      // cover's note points the reader here, so a second count would send them
      // to a figure that contradicts the one they were sent from.
      const tally = verificationTally(ctx)
      const packaged = isPackagedExport(options)
      return `
<section class="sheet">
  <h2>Chain of custody and manifest reference</h2>
  <div class="rule-medium"></div>
  <p>Custody of this evidence is recorded in the manifest, not in this document. The values below
  identify the exact manifest state this report was generated against.</p>
  <div class="rule-top">
    ${field('Manifest file', `<code>manifest.jsonl</code> (append-only, hash-chained)`, true)}
    ${
      data.manifestHead
        ? field('Head entry', mono(`#${data.manifestHead.index}`)) +
          field('Head entry hash (SHA-256, full)', mono(esc(data.manifestHead.entryHash)))
        : field(
            'Head entry',
            'Not available — the case manifest could not be read when this report was generated.',
            true
          )
    }
    ${field('Signing key', `<code>signing-public-key.pem</code>`)}
    ${field(
      'Verification run',
      tally.ran
        ? mono(`${isoUtc(data.exportTimestamp)} · ${tally.verified} of ${tally.total} verified`)
        : 'No verification was run for this export.'
    )}
  </div>

  ${
    data.selectionScope
      ? `<div class="note">
    <p class="note-title">Selection-scoped export</p>
    <p>This export covers a selection of ${data.selectionScope.selectedCaptureCount} of the
    case's ${data.selectionScope.caseCaptureCount} captures, chosen by the operator.${
      data.selectionScope.excludedExhibitCount > 0
        ? ` It also leaves out ${data.selectionScope.excludedExhibitCount} committed exhibit${
            data.selectionScope.excludedExhibitCount === 1 ? '' : 's'
          } of other kinds that the case holds. The number is stated here rather than left to be
    counted: an exhibit the chain records and this package does not enclose is accounted for by
    the operator's selection, not missing.`
        : ''
    }${
      // Only for a package: a standalone report encloses no notes.md, so there
      // is no file here for the count to describe (#985).
      packaged && options.include.notes && data.selectionScope.omittedNoteCount > 0
        ? ` The enclosed <code>notes.md</code> follows the same scope: it holds the operator notes
    attached to the selected captures, and leaves out ${data.selectionScope.omittedNoteCount}
    note${data.selectionScope.omittedNoteCount === 1 ? '' : 's'} the case holds. A note attached
    to no capture, or to a capture outside the selection, is left behind by the scope, as is a
    note attached to a selected capture that also points at another of the case's captures this
    export leaves out; the number is stated here so the file is not read as the operator's
    complete work product.`
        : ''
    }${
      packaged
        ? ` The enclosed <code>manifest.jsonl</code> deliberately covers the <em>whole case</em> —
    the manifest is never sliced, because its completeness is what makes deletions and omissions
    detectable — while the enclosed page archives, screenshots and exhibits cover only the
    selection. Captures the chain records but this package does not enclose are accounted for by
    the signed export entry (<code>export-entry.json</code>), which records the selected capture
    identifiers; their absence is designed behaviour, not a gap.`
        : ''
    }</p>
  </div>`
      : ''
  }
  ${
    data.unreconciledChainCaptureIds.length > 0
      ? `<div class="alert">
    <p class="alert-title">The chain claims captures this package does not contain</p>
    <p>The manifest holds ${
      data.unreconciledChainCaptureIds.length
    } capture entries with no corresponding deletion entry whose captures are neither listed as
    exhibits below nor enclosed as stored page archives. The chain and the contents of this
    package therefore disagree by that number. It is disclosed rather than omitted: a reader
    reconciling the two would otherwise find the shortfall unexplained.</p>
    <p>The known cause is Birdbrain's own capture-pipeline self-test, which in versions before
    this fix wrote a capture entry into a real case's chain and removed it without recording a
    deletion. Such entries carry the URL <code>birdbrain://pipeline-test</code>. An entry with any
    other URL is not accounted for by that explanation and should be treated as a gap.</p>
    ${field(
      'Capture identifiers',
      mono(data.unreconciledChainCaptureIds.map((id) => esc(id)).join('<br>')),
      true
    )}
  </div>`
      : ''
  }
  ${
    packaged
      ? `<div class="note">
    <p class="note-title">Disclosed ordering artefact</p>
    <p>This export's own entry is appended to the live case manifest after the package contents
    are assembled, so the bundled copy of <code>manifest.jsonl</code> ends one entry earlier than
    the live case manifest. That trailing entry is enclosed beside it as
    <code>export-entry.json</code> — the same signed line, whose <code>prevHash</code> equals the
    bundled manifest's last entry hash. The package hash recorded in it commits to packaged file
    content, not to the entry itself. This is disclosed so that a reviewer comparing the files is
    not misled by the difference.</p>
  </div>
  <div class="note">
    <p class="note-title">Where the package hash lives</p>
    <p>The package hash is deliberately absent from this report: report.html is itself one of the
    hashed artefacts, so printing the hash here could not be self-consistent. It is recorded in
    the signed export entry — enclosed as <code>export-entry.json</code> and appended to the live
    case manifest — and can be recomputed from the artefact list in
    <code>evidence.json</code>.</p>
  </div>`
      : `<div class="note">
    <p class="note-title">Nothing is enclosed with this report</p>
    <p>This document was exported on its own rather than as an evidence package. The manifest and
    signing key named above are held by the tool; they are not enclosed here, and neither are the
    stored page archives or timestamp tokens. The values above therefore identify the state this
    report describes, but a reader holding only this file cannot reconcile them independently.</p>
  </div>`
  }
</section>`
    }
  },

  exhibitIndex: {
    id: 'exhibitIndex',
    title: 'Exhibit index and verification results',
    render: (ctx) => {
      // Rendered whenever the package holds Exhibits of any kind (#1156, D12).
      // Gating the whole module on `include.captures`, as this did, left a
      // package of committed attachments with no index at all.
      const all = exhibitRows(ctx)
      if (all.length === 0) return null
      const rows = all
        .map((row) =>
          row.entity === 'capture'
            ? `
      <tr>
        <td class="num">${row.view.number > 0 ? esc(row.citation) : '—'}</td>
        <td>capture<span class="state-secondary">${esc(
          row.view.capture.method ?? 'extension'
        )}</span></td>
        <td class="mono nowrap">${isoUtc(row.view.capture.timestamp).replace('T', '<br>')}</td>
        <td>
          <span class="ex-title">${esc(row.view.capture.title)}</span>
          <span class="ex-url mono">${esc(row.view.capture.url)}</span>
        </td>
        <td class="mono break">${esc(row.view.capture.hash.slice(0, 16))}</td>
        <td class="state">
          <span class="state-primary">${esc(row.view.integrity.label)}</span>
          <span class="state-secondary">${esc(
            row.view.time.basis === 'rfc3161' ? 'RFC 3161' : row.view.time.label
          )}</span>
        </td>
      </tr>`
            : `
      <tr>
        <td class="num">${row.view.number > 0 ? esc(row.citation) : '—'}</td>
        <td>${esc(row.view.exhibit.kind)}<span class="state-secondary">${esc(
          row.view.exhibit.origin
        )}</span></td>
        <td class="mono nowrap">${isoUtc(row.view.exhibit.committedAt).replace('T', '<br>')}</td>
        <td>
          <span class="ex-title">${esc(row.view.exhibit.name)}</span>
          <span class="ex-url mono">${esc(row.view.exhibit.packagedPath ?? 'not enclosed')}</span>
        </td>
        <td class="mono break">${esc(row.view.exhibit.contentHash.slice(0, 16))}</td>
        <td class="state">
          <span class="state-primary">${esc(row.view.integrity.label)}</span>
          <span class="state-secondary">${esc(
            row.view.time.basis === 'rfc3161' ? 'RFC 3161' : row.view.time.label
          )}</span>
        </td>
      </tr>`
        )
        .join('')

      // Folded out of the rows above rather than read from data.preflight, like
      // the cover tally: a disclosure counted from a second source can go silent
      // while the rows it disclaims still say "Local clock only".
      const pendingCount = all.filter((r) => r.view.time.basis === 'pending').length
      const noneCount = all.filter((r) => r.view.time.basis === 'none').length
      const unstamped = pendingCount + noneCount
      const banner =
        unstamped > 0
          ? `<div class="note"><p class="note-title">${unstamped} exhibit${
              unstamped === 1 ? '' : 's'
            } without trusted time</p><p>${unstamped} exhibit${
              unstamped === 1 ? '' : 's'
            } in this package (${pendingCount} pending,
            ${noneCount} none) carr${unstamped === 1 ? 'ies' : 'y'} no RFC 3161 token. For ${
              unstamped === 1 ? 'it' : 'those'
            }, the recorded time is the operator's local system clock only. The export was not
            blocked; the gap is recorded rather than concealed.</p></div>`
          : ''

      return `
<section class="sheet">
  <h2>Exhibit index and verification results</h2>
  <div class="rule-medium"></div>
  <p class="fine">Times are UTC. The digest column shows the first 16 hexadecimal characters of a
  64-character SHA-256 digest and is truncated for layout only; the full digest for every exhibit
  is printed on that exhibit's page and in <code>evidence.json</code>. Exhibit numbers are the
  ones recorded when each exhibit was committed to the case; they are not positions in this
  table, and a package covering a selection carries gaps.</p>
  ${banner}
  <table class="index">
    <thead>
      <tr>
        <th class="num">Ex.</th><th>Kind and origin</th><th>Recorded (UTC)</th>
        <th>Title or file name</th>
        <th>SHA-256 (first 16 of 64)</th><th>State</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="legend">
    <p class="box-title">How to read the state column</p>
    ${legendRow('Verified', 'Stored bytes recompute to the recorded digest and the manifest chain reconciles through this entry.')}
    ${legendRow('Altered', 'Stored bytes no longer recompute to the recorded digest. The capture must not be relied upon.')}
    ${legendRow('Chain broken', 'Bytes match, but the manifest chain does not reconcile at or before this entry.')}
    ${legendRow('Absent', 'The stored artefact could not be read at verification time. The row is retained rather than removed.')}
    ${legendRow('Legacy record', 'The capture predates the hash-chained manifest; its digest is recorded but not chain-bound.')}
    ${legendRow('Local clock', "No RFC 3161 token is retained; the capture time is the operator's system clock only.")}
  </div>
</section>`
    }
  },

  exhibits: {
    id: 'exhibits',
    title: 'Exhibits',
    render: (ctx) => {
      const rows = exhibitRows(ctx)
      if (rows.length === 0) return null
      return rows
        .map((row) =>
          row.entity === 'capture'
            ? renderExhibit(row.view, rows.length, isPackagedExport(ctx.options))
            : renderFileExhibit(row.view, rows.length, isPackagedExport(ctx.options))
        )
        .join('\n')
    }
  },

  verification: {
    id: 'verification',
    title: 'Independent verification instructions',
    render: ({ options, data }) => `
<section class="sheet">
  <h2>Independent verification instructions</h2>
  <div class="rule-medium"></div>
  <p>Nothing in this report needs to be taken on trust. A reviewer holding the evidence package
  can reproduce every integrity claim it makes using standard tools. The full procedure,
  including exact commands, is in <code>VERIFY.md</code>.</p>
  ${
    isPackagedExport(options)
      ? ''
      : `<div class="alert">
    <p class="alert-title">These steps require the evidence package</p>
    <p>This document was exported on its own. The files named below — the stored page archives,
    the manifest, the signing key, the timestamp tokens and <code>evidence.json</code> — are not
    enclosed with it, so none of the steps can be carried out against this file alone. They are
    reproduced here so that a reader knows exactly what an independent reviewer would be able to
    check, and what to request in order to check it.</p>
  </div>`
  }
  <ol class="steps rule-top">
    <li><strong>Rehash each stored page.</strong> Compute the SHA-256 of each file in
    <code>pages/</code> and compare it to that exhibit's digest in <code>evidence.json</code> and
    on its exhibit page.</li>
    <li><strong>Replay the manifest chain.</strong> Walk <code>manifest.jsonl</code> from the
    first entry, recomputing each entry hash over its canonical form plus its predecessor's hash.
    The chain must reconcile to the head hash printed under “Chain of custody”.</li>
    <li><strong>Check the entry signatures.</strong> Verify each signed manifest entry against
    <code>signing-public-key.pem</code>. This binds the entries to the installation identified on
    the cover — not to any named person.</li>
    <li><strong>Validate the timestamp tokens.</strong> For each <code>.tst</code> in
    <code>timestamps/</code>, confirm the token's message imprint equals that exhibit's capture
    digest and that its signing chain, built with <code>tsa-intermediates.pem</code>, terminates in
    ${
      data.tsaTrustAnchorBundled
        ? `the self-signed root shipped as <code>tsa-root.pem</code>. That file is a convenience copy,
    not an independent anchor: check its SHA-256 fingerprint against the authority’s published
    value or your own trust store first (<code>VERIFY.md</code> step 6a prints the expected
    fingerprint and the exact <code>openssl</code> command)`
        : 'a trust anchor you obtain independently from the authority named on the cover'
    }.</li>
    <li><strong>Match the screenshots.</strong> Each file name in <code>screenshots/</code> is its
    own digest; recomputing it confirms that the packaged image is the one the exhibit cites.</li>
    <li><strong>Recompute the package hash.</strong> Hash the canonical, path-sorted artefact list
    in <code>evidence.json</code> and compare it to the package hash in the export entry of the
    live case manifest.</li>
  </ol>
  ${
    data.tsaTrustAnchorBundled
      ? ''
      : `<div class="alert">
    <p class="alert-title">No trust anchor is bundled for the configured authority</p>
    <p>Birdbrain ships a trust anchor only for its default time-stamping authority. A different
    authority is configured for this case, so no root file is bundled and
    <code>tsa-intermediates.pem</code> holds only certificates carried inside the tokens
    themselves. Validating a token against certificates it
    supplied is circular and establishes nothing about who issued it. Step 4 therefore requires a
    root obtained independently from the authority named on the cover; until one is used, the
    tokens demonstrate internal consistency but not authenticity.</p>
  </div>`
  }
</section>`
  },

  signature: {
    id: 'signature',
    title: 'Operator statement and signature',
    render: ({ data }) => `
<section class="sheet">
  <h2>Operator statement and signature</h2>
  <div class="rule-medium"></div>
  ${
    data.verifications.length > 0
      ? `<p>I generated this report from the Birdbrain case identified on the cover. I have not altered
  the captures, the manifest or the packaged artefacts, and the counts and digests reproduced here
  are those produced by the tool at the verification run recorded under “Chain of custody”.</p>`
      : `<p>I generated this report from the Birdbrain case identified on the cover. I have not altered
  the captures, the manifest or the packaged artefacts. <strong>No verification was run for this
  export</strong>, so the digests reproduced here are those recorded for each capture rather than
  values recomputed from the stored bytes at the time of export, and I make no statement about
  whether the stored bytes still match them.</p>`
  }
  <div class="tbd">
    <p class="tbd-title">Sworn declaration wording not supplied</p>
    <p>The statement above is a factual operator statement, not a sworn declaration. Certifying
    language for the applicable rule and jurisdiction must be supplied by counsel; it is not
    asserted here and must not be inferred. See <code>certification.html</code> in this
    package.</p>
  </div>
  <div class="sig-grid">
    <div class="sig-line">
      <span class="sig-caption">Signature of operator</span>
      <span class="sig-name">${esc(operatorLine(data))}</span>
    </div>
    <div class="sig-line"><span class="sig-caption">Date</span></div>
  </div>
</section>`
  }
}

/**
 * Exhibit layout is the "filed cover sheet" two-column plate: a narrow metadata
 * rail carries the record, stored artefacts and capture environment, while the
 * wide column carries the reproduced image and anything qualifying it. The rail
 * keeps the digest, integrity state and clock basis physically beside the image
 * a reviewer is looking at, and the layout stays legible when a package runs to
 * dozens of exhibits. The cover sheet stays flush-left ("ruled docket"); only
 * the exhibits use the two-column register.
 */
function renderExhibit(e: ExhibitView, total: number, packaged: boolean): string {
  const c = e.capture
  const environment: Array<[string, string]> = []
  const add = (label: string, value: string | number | undefined | null): void => {
    if (value === undefined || value === null || value === '') return
    environment.push([label, String(value)])
  }
  add('Format', c.format === 'mhtml' ? 'MHTML archive' : 'HTML page')
  add('Method', c.method)
  add('HTTP status', recordedHttpStatus(c.httpStatus))
  add('Size', c.sizeBytes !== undefined ? formatBytes(c.sizeBytes) : undefined)
  add('Browser', c.browserVersion)
  add('Tool version', c.toolVersion)
  add('Extension version', c.extensionVersion)
  add('Manifest entry', c.manifestIndex !== undefined ? `#${c.manifestIndex}` : undefined)
  add('Consent overlay', c.consentSuppression ? `suppressed (${c.consentSuppression})` : undefined)
  add('Supersedes', c.supersedesCaptureId)
  add('Duplicate of', c.duplicateOfCaptureId)

  // Every path here comes from what the package actually contains. Nothing is
  // inferred from the capture record, so the report cannot send a reviewer
  // looking for a file that was never written.
  const artefacts: Array<[string, string]> = []
  if (e.packaged.pageArchive) {
    artefacts.push(['Page archive', esc(e.packaged.pageArchive)])
  } else if (e.pageArchiveMissing) {
    artefacts.push(['Page archive', 'not available'])
  }
  if (e.packaged.timestampToken) {
    artefacts.push(['Timestamp token', esc(e.packaged.timestampToken)])
  }
  if (e.packaged.screenshot) {
    artefacts.push(['Screenshot', esc(e.packaged.screenshot)])
  }
  if (c.textHash) {
    artefacts.push(['Text digest', `${esc(c.textHash.slice(0, 16))}… (first 16 of 64)`])
  }
  for (const derived of e.derivedFiles) {
    artefacts.push([
      `Derived file — ${derived.derivation}`,
      derived.packagedPath
        ? esc(derived.packagedPath)
        : derived.anchoring === 'no-entry'
          ? 'not enclosed — no manifest entry names it'
          : 'not enclosed'
    ])
  }

  const tls = c.tlsCertChain
  const corroboration =
    tls && 'refetchedAt' in tls
      ? `<div class="note">
      <p class="note-title">Corroboration only — not bound to the capture</p>
      <p>${
        'error' in tls
          ? `A TLS certificate chain could not be retrieved from the origin at ${isoUtc(tls.refetchedAt)}: ${esc(tls.error)}.`
          : `A TLS certificate chain was retrieved from the origin at ${isoUtc(tls.refetchedAt)}, after this capture was stored. It records the certificate served at that
            retrieval time, not at capture time. The interval between the two is stated so that a
            reviewer can weigh it.`
      }</p></div>`
      : ''

  // Pinned archive.org references (#401). This is corroboration in exactly the
  // sense the scope section already defines: obtained from a third party after
  // storage, not bound to the captured transaction. What it establishes is
  // narrower still than the TLS block above — Birdbrain never retrieved the
  // archived page, so the reference attests to a listing, not to content.
  const waybackCorroboration =
    e.waybackRefs.length > 0
      ? `<div class="note">
      <p class="note-title">Corroboration only — archive.org references, not bound to the capture</p>
      <p>The operator pinned ${e.waybackRefs.length} archive.org snapshot${
        e.waybackRefs.length === 1 ? '' : 's'
      } of this URL as corroboration. ${
        e.waybackRefs.length === 1 ? 'It was' : 'They were'
      } recorded by the Internet Archive, independently of this capture and at the
      time${e.waybackRefs.length === 1 ? '' : 's'} stated below. Birdbrain did not
      retrieve, hash or package the archived content: what follows is a reference to
      a third party's record, and this package contains no copy of it. A pinned
      reference establishes that archive.org listed a snapshot at the stated time
      when the operator looked the URL up. It does not establish what the archived
      page contained, nor that the archived page is the page reproduced in this
      exhibit.</p>
      <ul>${e.waybackRefs
        .map((ref) => {
          const delta = formatSnapshotDelta(ref.snapshotTimestamp, e.capture.timestamp)
          const facts = [
            // Escaped like every other value here despite being typed a number:
            // the type is a repo cast over a SQLite column, and INTEGER affinity
            // keeps non-numeric text as TEXT. The repo now coerces on read, so
            // this is the second line and not the only one.
            ref.statusCode !== undefined ? `HTTP ${esc(String(ref.statusCode))}` : null,
            ref.mimeType ? esc(ref.mimeType) : null,
            `looked up ${isoUtc(ref.checkedAt)}`
          ].filter((fact): fact is string => fact !== null)
          return `<li><span class="mono">${isoUtc(ref.snapshotTimestamp)}</span>${
            delta ? ` — ${esc(delta)}` : ''
          }<br><span class="mono">${esc(ref.snapshotUrl)}</span><br><span class="sub">${facts.join(
            ' · '
          )}</span></li>`
        })
        .join('')}</ul></div>`
      : ''

  const missingBanner = e.pageArchiveMissing
    ? `<div class="alert">
    <p class="alert-title">Stored page archive not available</p>
    <p>The MHTML archive for this capture could not be read when this package was assembled. The
    metadata below is reproduced from the case record, but the page bytes it describes are not
    present in this package and cannot be independently rehashed. This exhibit is retained rather
    than removed so that the gap is visible.</p>
  </div>`
    : ''

  const image = e.screenshot
    ? `<figure class="plate">
    <div class="plate-frame"><img src="data:image/png;base64,${e.screenshot}" alt="${exhibitTag(
      e.citation
    )} screenshot"></div>
    <figcaption>
      <span class="cap-text"><strong>${exhibitTag(e.citation)}, image.</strong> Rendered page as
      captured${e.annotationsBurned ? ', with operator annotations burned in for legibility' : ''}.
      ${
        e.annotationsBurned
          ? 'Because the annotations are burned into the pixels, this image intentionally differs from the unannotated, digest-anchored copy in the package. Hashing the image reproduced here will not reproduce the digest below, and that mismatch is expected rather than evidence of alteration.'
          : e.packaged.screenshot
            ? `Packaged copy: <code>${esc(e.packaged.screenshot)}</code>.`
            : ''
      }</span>
      ${screenshotDigestCaption(e)}
    </figcaption>
  </figure>`
    : ''

  const legend =
    e.pins.length > 0
      ? `<div class="legend-block">
    <p class="micro-heading">Annotation legend</p>
    <ol class="pins">${e.pins
      .slice()
      .sort((a, b) => a.number - b.number)
      // value= carries the pin's own number. Deleting a pin does not renumber
      // the rest, so letting the browser count from 1 would caption the image's
      // pin 2 as legend entry 1 — a legend that disagrees with the exhibit.
      .map((p) => `<li value="${p.number}">${esc(p.body)}</li>`)
      .join('')}</ol>
  </div>`
      : ''

  // The head strip restates integrity and clock basis in words, so an exhibit
  // photocopied out of the package still carries its own qualification.
  const headState = [
    e.integrity.label,
    e.time.basis === 'rfc3161' ? 'RFC 3161' : e.time.label,
    isoUtc(c.timestamp)
  ].join(' · ')

  return `
<section class="sheet exhibit">
  <div class="exhibit-head">
    <span class="exhibit-tag">${exhibitTag(e.citation)}</span>
    <span class="exhibit-of mono">of ${total} · ${esc(headState)}</span>
  </div>
  <h3 class="exhibit-title">${esc(c.title)}</h3>
  <p class="exhibit-url mono">${esc(c.url)}</p>
  <div class="rule-medium tight"></div>

  <div class="plate-grid">
    <aside class="rail">
      <p class="micro-heading first">Record</p>
      ${railRow('Capture identifier', mono(esc(c.id)))}
      ${railRow('Captured at', mono(`${isoUtc(c.timestamp)}<br>${local(c.timestamp)} local`))}
      ${railRow('Capture SHA-256 (full)', mono(esc(c.hash)))}
      ${railRow(
        'Integrity at verification',
        `<span class="strong">${esc(e.integrity.label)}</span><span class="sub">${esc(
          e.integrity.detail
        )}</span>`
      )}
      ${railRow(
        'Trusted time',
        `<span class="strong">${esc(e.time.label)}</span><span class="sub">${esc(e.time.detail)}</span>`
      )}
      ${railRow(
        'Entry signature',
        `<span class="strong">${esc(e.entrySignature.label)}</span><span class="sub">${esc(
          e.entrySignature.detail
        )}</span>`
      )}

      <p class="micro-heading">Stored artefacts</p>
      ${artefacts.map(([l, v]) => railRow(l, mono(v))).join('')}

      <p class="micro-heading">Recorded capture environment</p>
      ${environment.map(([l, v]) => railRow(l, esc(v))).join('')}
      ${c.userAgent ? railRow('User agent', mono(esc(c.userAgent))) : ''}
      ${
        c.operatorName || c.operatorId
          ? railRow(
              'Recorded operator',
              `${esc(
                [c.operatorName, c.operatorId].filter(Boolean).join(' · ')
              )}<span class="sub"><em>Self-asserted; not authenticated by Birdbrain.</em></span>`
            )
          : ''
      }
    </aside>

    <div class="plate-main">
      ${missingBanner}
      ${image}
      ${legend}
      ${derivedFilesBlock(e.derivedFiles, packaged)}
      ${corroboration}
      ${waybackCorroboration}
    </div>
  </div>
</section>`
}

/**
 * One derived file in a standalone report: what the chain says about it, and
 * what the export's verification run found in its stored bytes. Both, because
 * the chain half alone leaves an operator holding a Case with a LOST derived
 * file untold that it is lost — the packaged report says so plainly and this
 * one has no reason to be quieter. Neither half mentions enclosure: a
 * standalone report encloses nothing.
 */
function standaloneDerivedRow(derived: ExportDerivedFile): string {
  const chainState =
    derived.anchoring === 'anchored'
      ? 'anchored in the chain by its own entry'
      : derived.anchoring === 'chain-unverified'
        ? 'named by a manifest entry, over a chain that did not verify'
        : 'named by no manifest entry'
  // Absent for a file the chain does not vouch for: nothing was hashed against
  // anything, and the chain half above already says why.
  const byteState =
    derived.verification?.status === 'verified'
      ? 'the stored bytes recompute to the digest that entry records'
      : derived.verification?.status === 'tampered'
        ? 'the stored bytes no longer recompute to the digest that entry records'
        : derived.verification?.status === 'missing'
          ? 'the stored file could not be read'
          : null
  return `<li><span class="mono">${esc(derived.derivation)}</span> — ${esc(chainState)}${
    byteState ? `; ${esc(byteState)}` : ''
  }<br><span class="sub">Recorded digest ${esc(derived.contentHash)}</span></li>`
}

/**
 * The derived-file disclosure, for an Exhibit of any kind.
 *
 * Three facts decide what is said, and all three are settled before this runs:
 * what the chain says about the file (`anchoring`, from `verifyDerivedFiles`),
 * whether the export actually read its bytes for packaging (`packagedPath`,
 * from the single enclosure read in export.ts), and what the verification run
 * found in those bytes (`verification.status`, which the standalone branch
 * renders as the stored-file result). Nothing here re-derives any of them, and
 * no sentence about enclosure is printed unless a package was produced.
 *
 * Each state has been told wrongly once, which is why they are enumerated:
 * an unanchored legacy thumbnail (X34) shipped under an anchoring claim no
 * entry supported; a file on a BROKEN chain was described as one "no entry
 * states what was produced" for, while its `derivation` entry sat in the same
 * zip saying both; a file with no entry whose bytes were also gone was
 * reported as one the chain anchors; and a file whose bytes existed but could
 * not be read was named as enclosed at a path the zip did not contain.
 */
function derivedFilesBlock(files: ExportDerivedFile[], packaged: boolean): string {
  if (files.length === 0) return ''

  const row = (derived: ExportDerivedFile, path: string): string =>
    `<li><span class="mono">${esc(derived.derivation)}</span> — <span class="mono">${esc(
      path
    )}</span><br><span class="sub">Recorded digest ${esc(derived.contentHash)}</span></li>`

  // A standalone report encloses nothing, so it says nothing about enclosure:
  // every file here would otherwise land in the not-enclosed bucket and be
  // described as a gap, over bytes that are on disk and fine.
  if (!packaged) {
    return `<div class="note">
    <p class="note-title">Derived files</p>
    <p>${files.length} file${files.length === 1 ? ' was' : 's were'} computed from this exhibit by
    the tool. A derived file is cited by its parent and its derivation and carries no exhibit
    number of its own. This document was exported on its own rather than as an evidence package,
    so ${
      files.length === 1 ? 'it is' : 'they are'
    } not enclosed with it and nothing here states otherwise; what is stated is what the case
    records and what the manifest chain says about ${files.length === 1 ? 'it' : 'them'}.</p>
    <ul>${files.map(standaloneDerivedRow).join('')}</ul>
  </div>`
  }

  const enclosed = files.filter((file) => file.anchoring === 'anchored' && file.packagedPath)
  const absent = files.filter((file) => file.anchoring === 'anchored' && !file.packagedPath)
  const unverified = files.filter((file) => file.anchoring === 'chain-unverified')
  const held = files.filter((file) => file.anchoring === 'no-entry')

  const enclosedBlock =
    enclosed.length === 0
      ? ''
      : `<div class="note">
    <p class="note-title">Derived files</p>
    <p>${enclosed.length} file${enclosed.length === 1 ? ' was' : 's were'} computed from this
    exhibit by the tool and ${
      enclosed.length === 1 ? 'is' : 'are'
    } enclosed beside it. A derived file is cited by its parent and its derivation and carries no
    exhibit number of its own; each of these is anchored in the chain by its own entry, which
    records the digest of what was produced.</p>
    <ul>${enclosed.map((derived) => row(derived, derived.packagedPath ?? '')).join('')}</ul>
  </div>`

  const absentBlock =
    absent.length === 0
      ? ''
      : `<div class="alert">
    <p class="alert-title">${absent.length} anchored derived file${
      absent.length === 1 ? '' : 's'
    } could not be read and ${absent.length === 1 ? 'is' : 'are'} not enclosed</p>
    <p>The chain anchors ${absent.length} file${absent.length === 1 ? '' : 's'} computed from this
    exhibit, and the stored bytes could not be read when this package was assembled, so
    ${absent.length === 1 ? 'it is' : 'they are'} not enclosed and ${
      absent.length === 1 ? 'is' : 'are'
    } not listed in <code>evidence.json</code>, which indexes what this package contains. This is
    a gap, not a design choice: verification of this package will report the missing ${
      absent.length === 1 ? 'file' : 'files'
    } against the entries that anchor ${absent.length === 1 ? 'it' : 'them'}.</p>
    <ul>${absent.map((derived) => row(derived, 'not enclosed')).join('')}</ul>
  </div>`

  // Worded from the enclosed subset rather than from the bucket: the bytes of
  // a file named over a broken chain can be unreadable too, and "they are
  // enclosed so that a reviewer can check them" would then be false.
  const unverifiedEnclosed = unverified.filter((file) => file.packagedPath).length
  const unverifiedBlock =
    unverified.length === 0
      ? ''
      : `<div class="alert">
    <p class="alert-title">The chain does not verify, so the anchoring of ${
      unverified.length
    } derived file${unverified.length === 1 ? '' : 's'} could not be established</p>
    <p>The enclosed manifest names ${unverified.length} file${
      unverified.length === 1 ? '' : 's'
    } computed from this exhibit, with the derivation and the digest produced, but the manifest
    chain itself did not verify for this export. Nothing therefore vouches for ${
      unverified.length === 1 ? 'that entry' : 'those entries'
    }, and no statement is made here about whether ${
      unverified.length === 1 ? 'this file is' : 'these files are'
    } anchored. ${
      unverifiedEnclosed === unverified.length
        ? `${unverified.length === 1 ? 'It is' : 'They are'} enclosed so that a reviewer can check ${
            unverified.length === 1 ? 'it' : 'them'
          } against the manifest directly`
        : unverifiedEnclosed === 0
          ? `The stored bytes could not be read either, so ${
              unverified.length === 1 ? 'it is' : 'they are'
            } not enclosed`
          : `${unverifiedEnclosed} of ${unverified.length} could be read and ${
              unverifiedEnclosed === 1 ? 'is' : 'are'
            } enclosed; the ${unverified.length - unverifiedEnclosed} listed below as not enclosed
      could not be read`
    }; the chain failure is reported under “Chain of custody”.</p>
    <ul>${unverified
      .map((derived) => row(derived, derived.packagedPath ?? 'not enclosed'))
      .join('')}</ul>
  </div>`

  const heldBlock =
    held.length === 0
      ? ''
      : `<div class="alert">
    <p class="alert-title">${held.length} derived file${
      held.length === 1 ? '' : 's'
    } recorded but not anchored, and therefore not enclosed</p>
    <p>The case records ${held.length} file${held.length === 1 ? '' : 's'} computed from this
    exhibit that no manifest entry names: nothing in the chain states what was produced or from
    which bytes. ${held.length === 1 ? 'It is' : 'They are'} deliberately not enclosed in this
    package, because a file the chain does not cover cannot be verified against it, and
    ${held.length === 1 ? 'it is' : 'they are'} named here rather than omitted silently. The
    tool produces this state when a thumbnail was found beside a capture whose stored screenshot
    could not be verified.</p>
    <ul>${held.map((derived) => row(derived, 'not enclosed')).join('')}</ul>
  </div>`

  return `${enclosedBlock}${absentBlock}${unverifiedBlock}${heldBlock}`
}

/**
 * One committed non-Capture Exhibit, on the same plate as a Capture exhibit so
 * a reader meets one document rather than two (ADR-0023).
 *
 * What is deliberately absent: a reproduced image, a URL, and a capture
 * environment. Birdbrain did not retrieve these bytes — the operator supplied
 * them — so the only things it can attest are the digest, when they were
 * committed to the case, and what the chain says about them since. The block
 * states that limit rather than leaving fields blank.
 */
function renderFileExhibit(e: FileExhibitView, total: number, packaged: boolean): string {
  const { exhibit } = e
  const artefacts: Array<[string, string]> = []
  if (exhibit.packagedPath) {
    artefacts.push(['Enclosed file', esc(exhibit.packagedPath)])
  } else {
    artefacts.push(['Enclosed file', 'not available'])
  }
  if (exhibit.sizeBytes !== null) artefacts.push(['Size', formatBytes(exhibit.sizeBytes)])
  if (exhibit.timestampTokenPath) {
    artefacts.push(['Timestamp token', esc(exhibit.timestampTokenPath)])
  }
  for (const derived of exhibit.derivedFiles) {
    artefacts.push([
      `Derived file — ${derived.derivation}`,
      derived.packagedPath
        ? esc(derived.packagedPath)
        : derived.anchoring === 'no-entry'
          ? 'not enclosed — no manifest entry names it'
          : 'not enclosed'
    ])
  }

  const missingBanner = e.contentMissing
    ? `<div class="alert">
    <p class="alert-title">Stored file not available</p>
    <p>The stored bytes of this exhibit could not be read when this package was assembled. The
    record below is reproduced from the case, but the bytes it describes are not present in this
    package and cannot be independently rehashed. This exhibit is retained rather than removed so
    that the gap is visible.</p>
  </div>`
    : ''

  const headState = [
    e.integrity.label,
    e.time.basis === 'rfc3161' ? 'RFC 3161' : e.time.label,
    isoUtc(exhibit.committedAt)
  ].join(' · ')

  return `
<section class="sheet exhibit">
  <div class="exhibit-head">
    <span class="exhibit-tag">${exhibitTag(e.citation)}</span>
    <span class="exhibit-of mono">of ${total} · ${esc(headState)}</span>
  </div>
  <h3 class="exhibit-title">${esc(exhibit.name)}</h3>
  <p class="exhibit-url mono">${esc(exhibit.kind)} · ${esc(exhibit.origin)}</p>
  <div class="rule-medium tight"></div>

  <div class="plate-grid">
    <aside class="rail">
      <p class="micro-heading first">Record</p>
      ${railRow('Exhibit identifier', mono(esc(exhibit.id)))}
      ${railRow(
        'Committed at',
        mono(`${isoUtc(exhibit.committedAt)}<br>${local(exhibit.committedAt)} local`)
      )}
      ${railRow('SHA-256 (full)', mono(esc(exhibit.contentHash)))}
      ${railRow(
        'Integrity at verification',
        `<span class="strong">${esc(e.integrity.label)}</span><span class="sub">${esc(
          e.integrity.detail
        )}</span>`
      )}
      ${railRow(
        'Trusted time',
        `<span class="strong">${esc(e.time.label)}</span><span class="sub">${esc(e.time.detail)}</span>`
      )}
      ${railRow(
        'Entry signature',
        `<span class="strong">${esc(e.entrySignature.label)}</span><span class="sub">${esc(
          e.entrySignature.detail
        )}</span>`
      )}
      ${railRow(
        'Manifest entry',
        exhibit.manifestIndex !== null
          ? mono(`#${exhibit.manifestIndex}`)
          : 'none — this exhibit is not anchored in the chain'
      )}

      <p class="micro-heading">Stored artefacts</p>
      ${artefacts.map(([l, v]) => railRow(l, mono(v))).join('')}
    </aside>

    <div class="plate-main">
      ${missingBanner}
      <div class="note">
        <p class="note-title">Supplied to the tool, not captured by it</p>
        <p>This exhibit is a file the operator committed to the case (recorded origin:
        ${esc(exhibit.origin)}). Birdbrain did not retrieve it and makes no statement about where
        it came from or what it shows. What is attested is narrower and is stated above: the
        digest of the bytes, the point at which they entered the case, and whether the chain still
        reconciles for them.</p>
      </div>
      ${derivedFilesBlock(exhibit.derivedFiles, packaged)}
    </div>
  </div>
</section>`
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function buildHtmlReport(
  data: ReportData,
  options: ExportOptions,
  moduleOrder: ReportModuleId[] = DEFAULT_REPORT_MODULES
): string {
  const exhibits = buildExhibits(data, options)
  const fileExhibits = buildFileExhibits(data, options)

  // Two passes: the first discovers which modules actually render, so the
  // contents index can list exactly what follows it and nothing else. Contents
  // is held out of that pass — its own "nothing to list" guard reads `included`,
  // so probing it against the empty seed would drop the index from every report.
  // It may therefore appear in `included` while rendering null in the real pass;
  // that is harmless, because contents is the only reader of `included` and it
  // already excludes itself.
  const probe: ReportContext = { data, options, exhibits, fileExhibits, included: [] }
  const included = moduleOrder.filter(
    (id) => id === 'contents' || REPORT_MODULES[id].render(probe) !== null
  )
  const ctx: ReportContext = { data, options, exhibits, fileExhibits, included }

  const body = included
    .map((id) => REPORT_MODULES[id].render(ctx))
    .filter((html): html is string => html !== null)
    .join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Forensic capture report — ${esc(data.caseName)}</title>
<style>${REPORT_PAGE_CSS}</style>
</head>
<body>
${body}
<footer class="running">
  <span>Birdbrain ${esc(data.toolVersion)} · report.html</span>
  <span class="mono">${esc(data.caseName)} · ${isoUtc(data.exportTimestamp)}</span>
</footer>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Print CSS
// ---------------------------------------------------------------------------

/**
 * Swap `size: letter` for `size: A4` for metric users; nothing else in the
 * sheet depends on paper dimensions (no viewport units, no fixed heights).
 */
export const REPORT_PAGE_CSS = `
@page { size: letter; margin: 0.75in 0.7in 0.9in; }

:root {
  --ink: #09090b;
  --ink-2: #18181b;
  --ink-3: #3f3f46;
  --ink-4: #52525b;
  --muted: #71717a;
  --faint: #a1a1aa;
  --hair: #e4e4e7;
  --rule: #d4d4d8;
  --wash: #f4f4f5;
  --sans: Inter, "Inter Variable", "Helvetica Neue", Helvetica, Arial, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

* { margin: 0; padding: 0; box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  font-family: var(--sans);
  font-size: 11pt;
  line-height: 1.55;
  color: var(--ink-2);
  background: #fff;
  max-width: 7.1in;
  margin: 0 auto;
  padding: 0.75in 0.7in 0.9in;
  text-wrap: pretty;
}
@media print { body { max-width: none; padding: 0; } }

.mono, code { font-family: var(--mono); font-size: 0.92em; }
code { background: none; }
a { color: var(--ink); text-decoration: underline; text-underline-offset: 2px; }
a:hover { color: var(--ink-4); }
.break { overflow-wrap: anywhere; }
.nowrap { white-space: nowrap; }
.fine { font-size: 9.5pt; line-height: 1.5; color: var(--ink-3); margin-top: 10pt; }
em { font-style: italic; }
strong, .strong { font-weight: 650; color: var(--ink); }

/* Sheets ---------------------------------------------------------------- */
.sheet { break-after: page; page-break-after: always; }
.sheet:last-of-type { break-after: auto; page-break-after: auto; }
.exhibit { break-inside: auto; }

/* On screen the page breaks are invisible, so sections would otherwise run
   together with nothing between them. Separate them with a rule and space, and
   give the document room to breathe at the end — print keeps its own geometry. */
@media screen {
  .sheet + .sheet { border-top: 1px solid var(--rule); margin-top: 34pt; padding-top: 30pt; }
  body { padding-bottom: 3rem; }
  .running { margin-top: 34pt; }
}

/* Cover ----------------------------------------------------------------- */
.wordmark { display: flex; justify-content: space-between; align-items: baseline; }
.wordmark-name { font-size: 12pt; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink); }
.wordmark-kind { font-family: var(--mono); font-size: 8pt; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
.rule-heavy { height: 3px; background: var(--ink); margin: 9pt 0 24pt; }
.rule-medium { height: 2px; background: var(--ink); margin: 4pt 0 13pt; }
.rule-medium.tight { margin: 10pt 0 0; }
.rule-top { border-top: 1px solid var(--ink); }
.eyebrow { font-size: 7.5pt; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); margin-bottom: 7pt; }
.eyebrow.spaced { margin-top: 22pt; }
.case-name { font-size: 25pt; line-height: 1.15; font-weight: 700; letter-spacing: -0.02em; color: var(--ink); }
.case-desc { font-size: 11.5pt; line-height: 1.5; color: var(--ink-3); margin-top: 10pt; max-width: 58ch; }

.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 30pt; }
.field { border-bottom: 1px solid var(--hair); padding: 8pt 0; min-width: 0; }
.field.wide { grid-column: 1 / -1; }
.field-label { font-size: 7pt; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
.field-value { font-size: 10.5pt; line-height: 1.4; color: var(--ink); margin-top: 3pt; overflow-wrap: anywhere; }
.field-value .sub { display: block; font-size: 9pt; line-height: 1.45; color: var(--ink-4); margin-top: 2pt; }

.attest-box { border: 1px solid var(--ink); padding: 12pt 13pt; margin-top: 22pt; }
.box-title { font-size: 7.5pt; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink); }
.tally { display: flex; flex-wrap: wrap; gap: 20pt; margin-top: 9pt; }
.tally-value { font-size: 17pt; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
.tally-label { font-size: 8pt; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-4); margin-top: 1pt; }
.box-note { font-size: 9pt; line-height: 1.5; color: var(--ink-3); border-top: 1px solid var(--hair); margin-top: 10pt; padding-top: 8pt; }

/* Headings & prose ------------------------------------------------------ */
h2 { font-size: 15pt; font-weight: 700; letter-spacing: -0.01em; color: var(--ink); }
.sheet > p { margin-top: 9pt; }
.micro-heading { font-size: 7pt; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); margin-top: 15pt; margin-bottom: 5pt; }

/* Contents -------------------------------------------------------------- */
.toc { list-style: none; }
.toc-row { display: flex; align-items: baseline; gap: 8pt; padding: 6pt 0; border-bottom: 1px solid var(--wash); }
.toc-label { font-size: 10.5pt; color: var(--ink); }

/* Scope ----------------------------------------------------------------- */
.scope-row { display: grid; grid-template-columns: 1.15in 1fr; gap: 15pt; padding: 9pt 0; border-bottom: 1px solid var(--hair); break-inside: avoid; }
.scope-row dt { font-size: 7.5pt; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink); }
.scope-row dd { font-size: 10.5pt; line-height: 1.5; color: var(--ink-2); }

/* Steps ----------------------------------------------------------------- */
.steps { list-style: none; counter-reset: step; }
/* Deliberately not a grid. These items carry inline <strong> and <code>, and every inline
   child of a grid container becomes its own grid item — the prose landed in the 20pt counter
   column and wrapped one word per line (#633). Absolute positioning keeps the same 32pt
   indent without making the item a container. */
.steps > li { counter-increment: step; position: relative; padding: 8pt 0 8pt 32pt; border-bottom: 1px solid var(--hair); break-inside: avoid; font-size: 10.5pt; line-height: 1.5; }
.steps > li::before { content: counter(step); position: absolute; left: 0; top: 8pt; font-family: var(--mono); font-weight: 700; color: var(--ink); }

/* Notes & alerts (greyscale-safe: weight and rules carry the emphasis) --- */
.note { border-left: 3px solid var(--ink); padding: 8pt 0 8pt 11pt; margin-top: 13pt; break-inside: avoid; }
.note-title { font-size: 7.5pt; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink); }
.note p + p, .note-title + p { font-size: 9.5pt; line-height: 1.5; color: var(--ink-2); margin-top: 4pt; }
.alert { border: 2px solid var(--ink); padding: 10pt 12pt; margin-top: 13pt; break-inside: avoid; }
.alert-title { font-size: 8.5pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink); }
.alert p + p { font-size: 9.5pt; line-height: 1.5; margin-top: 5pt; }

/* Index table ----------------------------------------------------------- */
table.index { width: 100%; border-collapse: collapse; margin-top: 13pt; }
table.index th { text-align: left; font-size: 7pt; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-4); padding: 0 6pt 5pt 0; border-bottom: 1.5px solid var(--ink); }
table.index td { vertical-align: top; padding: 8pt 6pt 8pt 0; border-bottom: 1px solid var(--hair); font-size: 9.5pt; }
table.index th:last-child, table.index td:last-child { padding-right: 0; }
table.index tr { break-inside: avoid; }
td.num, th.num { width: 22pt; font-weight: 700; color: var(--ink); }
.ex-title { display: block; font-size: 10pt; font-weight: 600; color: var(--ink); line-height: 1.3; }
.ex-url { display: block; font-size: 8pt; color: var(--ink-4); margin-top: 2pt; overflow-wrap: anywhere; }
.state-primary { display: block; font-size: 8pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink); }
.state-secondary { display: block; font-size: 8pt; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-4); margin-top: 2pt; }

.legend { border: 1px solid var(--rule); margin-top: 18pt; break-inside: avoid; }
.legend .box-title { padding: 8pt 11pt; border-bottom: 1px solid var(--rule); background: var(--wash); }
.legend-row { display: grid; grid-template-columns: 0.95in 1fr; gap: 12pt; padding: 6pt 11pt; font-size: 9.5pt; line-height: 1.45; }
.legend-row span:first-child { font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }

/* Exhibits -------------------------------------------------------------- */
.exhibit-head { display: flex; align-items: baseline; gap: 9pt; }
.exhibit-tag { font-size: 8.5pt; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: #fff; background: var(--ink); padding: 3pt 7pt; }
.exhibit-of { font-size: 8pt; letter-spacing: 0.06em; color: var(--muted); }
.exhibit-title { font-size: 16pt; font-weight: 700; line-height: 1.25; letter-spacing: -0.01em; color: var(--ink); margin-top: 9pt; }
.exhibit-url { font-size: 9.5pt; font-family: var(--mono); line-height: 1.4; color: var(--ink-2); margin-top: 4pt; overflow-wrap: anywhere; }

/* Two-column exhibit plate: metadata rail beside the reproduced image. The
   columns are independent, so a long rail and a tall image each flow without
   clipping the other. min-width:0 on both keeps long digests and URLs from
   forcing the grid wider than the sheet. */
.plate-grid { display: grid; grid-template-columns: 2.3in 1fr; gap: 0 24pt; margin-top: 14pt; align-items: start; }
.rail, .plate-main { min-width: 0; }
.rail { border-top: 1px solid var(--ink); }
.rail .micro-heading { margin-top: 13pt; margin-bottom: 3pt; }
.rail .micro-heading.first { margin-top: 7pt; }
.rail-row { border-bottom: 1px solid var(--hair); padding: 5pt 0; }
.rail-label { font-size: 6.5pt; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
.rail-value { font-size: 9pt; line-height: 1.4; color: var(--ink); margin-top: 2pt; overflow-wrap: anywhere; }
.rail-value .sub { display: block; font-size: 8pt; line-height: 1.45; color: var(--ink-4); margin-top: 3pt; }
.rail-value .strong { font-size: 9.5pt; }
.plate-main > .alert:first-child, .plate-main > .plate:first-child { margin-top: 0; }

.plate { margin-top: 14pt; break-inside: avoid; }
.plate-frame { border: 1px solid var(--ink); background: var(--wash); padding: 7pt; }
.plate-frame img { display: block; width: 100%; height: auto; max-height: 6.4in; object-fit: contain; object-position: top; }
.plate figcaption { margin-top: 6pt; border-bottom: 1px solid var(--rule); padding-bottom: 6pt; }
.cap-text { display: block; font-size: 9.5pt; line-height: 1.45; color: var(--ink-2); }
.cap-meta { display: block; font-size: 8pt; line-height: 1.45; color: var(--ink-4); overflow-wrap: anywhere; margin-top: 3pt; }
.legend-block { break-inside: avoid; }
.pins { padding-left: 16pt; font-size: 9.5pt; line-height: 1.5; }
.pins li { margin-top: 3pt; }

/* Signature ------------------------------------------------------------- */
.tbd { border: 2px dashed var(--muted); padding: 9pt 11pt; margin-top: 13pt; break-inside: avoid; }
.tbd-title { font-size: 7.5pt; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-3); }
.tbd p + p { font-size: 9.5pt; line-height: 1.5; color: var(--ink-3); margin-top: 4pt; }
.sig-grid { display: grid; grid-template-columns: 1fr 1.7in; gap: 32pt; margin-top: 40pt; break-inside: avoid; }
.sig-line { border-top: 1px solid var(--ink); padding-top: 5pt; }
.sig-caption { display: block; font-size: 7.5pt; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-4); }
.sig-name { display: block; font-size: 10pt; color: var(--ink); margin-top: 7pt; }

/* Running footer: position:fixed repeats on every printed page. No page
   number here — see PDF_FOOTER_TEMPLATE for numbered output. */
.running { display: flex; justify-content: space-between; gap: 16pt; font-size: 7.5pt; letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); border-top: 1px solid var(--hair); padding-top: 7pt; margin-top: 24pt; }
@media print {
  .running { position: fixed; bottom: 0; left: 0; right: 0; margin: 0; padding: 5pt 0; background: #fff; }
}

/* Narrow screens ---------------------------------------------------------
   Every multi-column grid above is sized in inches for paper. Below roughly a
   sheet's text width those columns stop working — a 2.3in rail leaves too
   little for the plate, and 64-character digests shred a half-width field. Fold
   them to a single column on screen only; @page and print layout are untouched,
   so this can never change what comes out of a printer. */
@media screen and (max-width: 680px) {
  body { padding: 1.25rem 1rem 3rem; font-size: 10.5pt; }
  .field-grid, .plate-grid { grid-template-columns: 1fr; }
  .plate-grid { gap: 0; }
  .rail { border-top: none; }
  .plate-main { margin-top: 16pt; }
  .scope-row, .legend-row { grid-template-columns: 1fr; gap: 4pt; }
  .sig-grid { grid-template-columns: 1fr; gap: 24pt; }
  .tally { gap: 14pt; }
  .case-name { font-size: 20pt; }
  .exhibit-title { font-size: 14pt; }
  /* The index table cannot fold, so let it scroll inside its own box rather
     than forcing the whole document to scroll sideways. */
  table.index { display: block; overflow-x: auto; white-space: nowrap; }
  table.index td, table.index th { white-space: normal; }
  .running { flex-direction: column; gap: 3pt; }
}
`

/**
 * Footer template for webContents.printToPDF({ displayHeaderFooter: true }),
 * for callers that render report.html to PDF in-app and want numbered pages.
 * Hide the in-document .running strip when using this to avoid two footers.
 */
export const PDF_FOOTER_TEMPLATE = `
<div style="width:100%;font-family:Arial,Helvetica,sans-serif;font-size:7pt;letter-spacing:0.08em;
text-transform:uppercase;color:#71717a;padding:0 0.7in;display:flex;justify-content:space-between">
  <span class="title"></span>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`

// ---------------------------------------------------------------------------
// Fragment helpers
// ---------------------------------------------------------------------------

function field(label: string, valueHtml: string, wide = false): string {
  return `<div class="field${wide ? ' wide' : ''}">
    <div class="field-label">${esc(label)}</div>
    <div class="field-value">${valueHtml}</div>
  </div>`
}

/**
 * The digest line under an exhibit image. Two digests can be in play: the one
 * recorded for the capture at ingest, and the one the bytes this export read
 * actually hash to. They normally match. When they do not, the sidecar has
 * changed since ingest — which is exactly the kind of drift the document exists
 * to surface, so both are printed and the disagreement is named.
 */
function screenshotDigestCaption(e: ExhibitView): string {
  const recorded = e.capture.screenshotHash
  const actual = e.packaged.screenshotDigest
  const label = e.annotationsBurned ? 'unannotated original SHA-256' : 'image SHA-256'

  if (!recorded && !actual) {
    return `<span class="cap-meta mono">image digest not recorded for this capture</span>`
  }
  if (recorded && actual && recorded !== actual) {
    return `<span class="cap-meta mono">${label} ${esc(actual)}<br>recorded at capture ${esc(
      recorded
    )} — the stored image no longer matches the digest recorded for it</span>`
  }
  return `<span class="cap-meta mono">${label} ${esc(actual ?? recorded ?? '')}</span>`
}

/** One labelled row in an exhibit's metadata rail. `valueHtml` is not escaped. */
function railRow(label: string, valueHtml: string): string {
  return `<div class="rail-row">
    <div class="rail-label">${esc(label)}</div>
    <div class="rail-value">${valueHtml}</div>
  </div>`
}

function tally(value: string, label: string): string {
  return `<div><div class="tally-value">${esc(value)}</div><div class="tally-label">${esc(
    label
  )}</div></div>`
}

function legendRow(term: string, detail: string): string {
  return `<div class="legend-row"><span>${esc(term)}</span><span>${esc(detail)}</span></div>`
}

function mono(html: string): string {
  return `<span class="mono break">${html}</span>`
}

function operatorLine(data: ReportData): string {
  const tail = [data.operatorRole, data.operatorOrganization].filter(Boolean).join(', ')
  return tail ? `${data.operatorName} — ${tail}` : data.operatorName
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/**
 * ISO 8601 UTC, seconds precision — the canonical form for every timestamp.
 *
 * Both this and local() return HTML-safe output, including on the unparseable
 * path: capture timestamps originate from an upload payload, so an unparseable
 * value is attacker-controlled text that most call sites interpolate without
 * escaping. Callers must therefore NOT wrap these in esc().
 */
function isoUtc(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return esc(iso)
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Operator-local rendering, shown only alongside the UTC form, never alone. */
function local(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return esc(iso)
  return d.toLocaleString()
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B (${bytes} bytes)`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB (${bytes} bytes)`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB (${bytes} bytes)`
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
