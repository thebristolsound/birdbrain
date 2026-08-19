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
  ExportOptions,
  ExportPreflight,
  HashVerification,
  TrustedTime
} from '@shared/types'
import type { TrustedTimeResult } from '@shared/verify'
import {
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

export interface ReportData {
  caseId: string
  caseName: string
  caseDescription?: string
  dateRange: { first: string; last: string } | null
  investigatorName: string
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
  /** Modules that actually rendered, in order — used by the contents index. */
  included: ReportModuleId[]
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
  // Captures arrive newest-first from captureRepo; exhibits read chronologically.
  const ordered = [...data.captures].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const isPackage = options.format === 'zip'

  return ordered.map((capture, index) => {
    const verification = byCaptureId.get(capture.id)
    const trustedTime = data.trustedTimeByCaptureId.get(capture.id) ?? NO_TRUSTED_TIME
    const packaged = data.packagedPaths.get(capture.id) ?? NO_ARTIFACTS
    return {
      number: index + 1,
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
      pageArchiveMissing: isPackage && packaged.pageArchive === null
    }
  })
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
        detail:
          'A trusted timestamp was requested but has not been obtained. The capture time ' +
          "shown is the operator's local system clock and carries no independent corroboration."
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
    render: ({ data, exhibits, options }) => {
      const verified = exhibits.filter((e) => e.integrity.label === 'Verified').length
      const stamped = exhibits.filter((e) => e.time.basis === 'rfc3161').length
      const hosts = new Set(exhibits.map((e) => hostOf(e.capture.url)).filter(Boolean)).size
      const archived = exhibits.filter((e) => !e.pageArchiveMissing).length
      const total = exhibits.length
      const packaged = isPackagedExport(options)
      const verificationRan = data.verifications.length > 0

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
      total > 0 ? `${total} (Exhibits 1–${total})` : 'none'
    )}
    ${field('Report generated', mono(`${isoUtc(data.exportTimestamp)} (${local(data.exportTimestamp)})`))}
  </div>

  <p class="eyebrow spaced">Custody</p>
  <div class="field-grid rule-top">
    ${field('Investigator (self-asserted)', esc(data.investigatorName))}
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
      data.tsaUrl ? mono(esc(data.tsaUrl)) : 'none configured',
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
      ${packaged ? tally(`${archived} / ${total}`, 'Page archive present') : ''}
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
    render: ({ included, exhibits, options, data }) => {
      const listed = included.filter((id) => id !== 'cover' && id !== 'contents')
      if (listed.length === 0) return null
      const rows = listed
        .map((id) => {
          if (id === 'exhibits') {
            return exhibits
              .map(
                (e) =>
                  `<li class="toc-row"><span class="toc-label">Exhibit ${e.number} — ${esc(
                    e.capture.title
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
  } <code>VERIFY.md</code>,
  and the <code>pages/</code>, <code>screenshots/</code> and <code>timestamps/</code>
  directories.</p>`
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
    render: ({ data, exhibits, options }) => {
      const verifiedCount = exhibits.filter((e) => e.integrity.label === 'Verified').length
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
      data.verifications.length > 0
        ? mono(`${isoUtc(data.exportTimestamp)} · ${verifiedCount} of ${exhibits.length} verified`)
        : 'No verification was run for this export.'
    )}
  </div>

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
    <p>The export event is written to the live case manifest after this package is sealed, so the
    bundled copy of <code>manifest.jsonl</code> ends one entry earlier than the live case
    manifest. The package hash recorded in that trailing entry commits to packaged file content,
    not to the entry itself. This is disclosed so that a reviewer comparing the two files is not
    misled by the difference.</p>
  </div>
  <div class="note">
    <p class="note-title">Where the package hash lives</p>
    <p>The package hash is deliberately absent from this report: report.html is itself one of the
    hashed artefacts, so printing the hash here could not be self-consistent. It is recorded in
    the export entry of the live case manifest and can be recomputed from the artefact list in
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
    render: ({ exhibits, options }) => {
      if (!options.include.captures || exhibits.length === 0) return null
      const rows = exhibits
        .map(
          (e) => `
      <tr>
        <td class="num">${e.number}</td>
        <td class="mono nowrap">${isoUtc(e.capture.timestamp).replace('T', '<br>')}</td>
        <td>
          <span class="ex-title">${esc(e.capture.title)}</span>
          <span class="ex-url mono">${esc(e.capture.url)}</span>
        </td>
        <td class="mono break">${esc(e.capture.hash.slice(0, 16))}</td>
        <td class="state">
          <span class="state-primary">${esc(e.integrity.label)}</span>
          <span class="state-secondary">${esc(
            e.time.basis === 'rfc3161' ? 'RFC 3161' : e.time.label
          )}</span>
        </td>
      </tr>`
        )
        .join('')

      // Folded out of the rows above rather than read from data.preflight, like
      // the cover tally: a disclosure counted from a second source can go silent
      // while the rows it disclaims still say "Local clock only".
      const pendingCount = exhibits.filter((e) => e.time.basis === 'pending').length
      const noneCount = exhibits.filter((e) => e.time.basis === 'none').length
      const unstamped = pendingCount + noneCount
      const banner =
        unstamped > 0
          ? `<div class="note"><p class="note-title">${unstamped} capture${
              unstamped === 1 ? '' : 's'
            } without trusted time</p><p>${unstamped} capture${
              unstamped === 1 ? '' : 's'
            } in this package (${pendingCount} pending,
            ${noneCount} none) carr${
              unstamped === 1 ? 'ies' : 'y'
            } no RFC 3161 token. For ${
              unstamped === 1 ? 'it' : 'those'
            }, the capture time is the operator's local system clock only. The export was not
            blocked; the gap is recorded rather than concealed.</p></div>`
          : ''

      return `
<section class="sheet">
  <h2>Exhibit index and verification results</h2>
  <div class="rule-medium"></div>
  <p class="fine">Times are UTC. The digest column shows the first 16 hexadecimal characters of a
  64-character SHA-256 digest and is truncated for layout only; the full digest for every exhibit
  is printed on that exhibit's page and in <code>evidence.json</code>.</p>
  ${banner}
  <table class="index">
    <thead>
      <tr>
        <th class="num">Ex.</th><th>Captured (UTC)</th><th>Page title and URL</th>
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
    render: ({ exhibits, options }) => {
      if (!options.include.captures || exhibits.length === 0) return null
      return exhibits.map((e) => renderExhibit(e, exhibits.length)).join('\n')
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
function renderExhibit(e: ExhibitView, total: number): string {
  const c = e.capture
  const environment: Array<[string, string]> = []
  const add = (label: string, value: string | number | undefined | null): void => {
    if (value === undefined || value === null || value === '') return
    environment.push([label, String(value)])
  }
  add('Format', c.format === 'mhtml' ? 'MHTML archive' : 'HTML page')
  add('Method', c.method)
  add('HTTP status', c.httpStatus)
  add('Size', c.sizeBytes !== undefined ? formatBytes(c.sizeBytes) : undefined)
  add('Browser', c.browserVersion)
  add('Tool version', c.toolVersion)
  add('Extension version', c.extensionVersion)
  add('Manifest entry', c.manifestIndex !== undefined ? `#${c.manifestIndex}` : undefined)
  add('Consent overlay', c.consentSuppression ? `suppressed (${c.consentSuppression})` : undefined)
  add('Supersedes', c.supersedesCaptureId)

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
    <div class="plate-frame"><img src="data:image/png;base64,${e.screenshot}" alt="Exhibit ${
      e.number
    } screenshot"></div>
    <figcaption>
      <span class="cap-text"><strong>Exhibit ${e.number}, image.</strong> Rendered page as
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
    <span class="exhibit-tag">Exhibit ${e.number}</span>
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
      ${corroboration}
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

  // Two passes: the first discovers which modules actually render, so the
  // contents index can list exactly what follows it and nothing else. Contents
  // is held out of that pass — its own "nothing to list" guard reads `included`,
  // so probing it against the empty seed would drop the index from every report.
  // It may therefore appear in `included` while rendering null in the real pass;
  // that is harmless, because contents is the only reader of `included` and it
  // already excludes itself.
  const probe: ReportContext = { data, options, exhibits, included: [] }
  const included = moduleOrder.filter(
    (id) => id === 'contents' || REPORT_MODULES[id].render(probe) !== null
  )
  const ctx: ReportContext = { data, options, exhibits, included }

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
.steps > li { counter-increment: step; display: grid; grid-template-columns: 20pt 1fr; gap: 12pt; padding: 8pt 0; border-bottom: 1px solid var(--hair); break-inside: avoid; font-size: 10.5pt; line-height: 1.5; }
.steps > li::before { content: counter(step); font-family: var(--mono); font-weight: 700; color: var(--ink); }

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
  .scope-row, .legend-row, .steps > li { grid-template-columns: 1fr; gap: 4pt; }
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
