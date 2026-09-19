import { app } from 'electron'
import { REPORT_PAGE_CSS, type EntrySignatureStatus } from '@main/services/reportHtml'
import type { Capture, TrustedTime } from '@shared/types'
import type { TrustedTimeResult } from '@shared/verify'

// Minimal shape of the export-time data the certification needs. Kept structural
// (not a hard import of ExportData) so the certifier can be exercised in tests
// without constructing the full export pipeline.
export interface CertificationInput {
  caseName: string
  /** Operator-assigned case number (#399); rendered 'not stated' when absent. */
  caseNumber?: string
  /**
   * Demonstration case (#405): when true the certification carries a prominent
   * statement that the case is seeded fixture data, not collected evidence.
   */
  isDemo: boolean
  /** Free-text purpose-or-authority from the export dialog (#399). */
  purposeOrAuthority?: string
  /**
   * Manifest chain head this package was built against — the same single
   * snapshot the report and evidence.json cite. Null when the manifest was
   * empty or unreadable.
   */
  manifestHead: { index: number; entryHash: string } | null
  /** SHA-256 (hex) of the bundled signing-public-key.pem bytes. */
  signingKeyFingerprint: string
  /** What this package actually contains, counted from what was packaged. */
  contents: {
    captureCount: number
    screenshotCount: number
    noteCount: number
    /**
     * Committed Exhibits of every other kind, counted per kind (ADR-0023,
     * #1156). Absent means none — a package of captures alone states the three
     * counts above and nothing more.
     */
    exhibitCountsByKind?: Record<string, number>
    /** Files the tool computed from an Exhibit and enclosed beside it (X17). */
    derivedFileCount?: number
    /**
     * Derived Files the case records that NO manifest entry names, and that
     * this package therefore does NOT enclose (X34). Stated rather than left
     * out of the arithmetic: a reader comparing the package against the case
     * has to be told the difference, not left to find it.
     */
    unanchoredDerivedFileCount?: number
    /**
     * Derived Files a manifest entry DOES name over a chain that did not
     * verify. They are enclosed, and this document makes no claim either way
     * about their anchoring — which is a different statement from the count
     * above, and collapsing the two told a reader the chain was silent about a
     * file whose entry is in the same package.
     */
    unverifiableDerivedFileCount?: number
    /**
     * Derived Files the chain anchors whose stored bytes could not be read at
     * export time. Enclosed by neither the package nor `evidence.json`, so
     * they are counted apart from the enclosed files rather than inside them.
     */
    missingDerivedFileCount?: number
  }
  exportTimestamp: string
  installationId: string
  operatorName: string
  operatorRole: string
  operatorOrganization: string
  tsaUrl: string
  captures: Capture[]
  /**
   * The export's single trusted-time resolution, keyed by capture id — see
   * resolveExportTrustedTime in export.ts. This document's ONLY source for the
   * axis, by design (#492): the summary prose is folded out of the same rows it
   * introduces, so the two cannot contradict each other whatever else changes.
   *
   * Not the DB mirror, which is rebuildable state that can disagree with the
   * tokens actually retained; and not the export's HashVerification results,
   * whose trustedTime is an earlier read of the same manifest and so can only be
   * superseded by the snapshot the package is built from.
   */
  trustedTimeByCaptureId: Map<string, TrustedTimeResult>
  /**
   * The export's single per-entry signature resolution, keyed by capture id —
   * see resolveEntrySignatures in export.ts. This document's ONLY source for the
   * axis, by design (#611): the summary counts are folded out of the same rows
   * report.html states per exhibit, so the two documents cannot report different
   * totals whatever else changes.
   *
   * That is a guarantee about the counts and about nothing else. The prose the
   * counts sit in is written here and can still say something report.html
   * contradicts — it did, for the no-entry class, before review caught it. A
   * claim about what covers an unsigned capture has to be checked against
   * entrySignatureView in reportHtml.ts by hand.
   *
   * Total over `captures` by construction — resolveEntrySignatures backfills
   * every capture with 'no-entry' — so the lookup relies on that rather than
   * defaulting an absent key to a status nothing resolved. A default would be
   * unreachable today and would silently understate the unsigned share if the
   * invariant ever broke; see #1110 for that failure on the trusted-time axis.
   */
  entrySignatureByCaptureId: Map<string, EntrySignatureStatus>
  /**
   * Committed Exhibits of every other kind (ADR-0023, #1156), each carrying
   * its own already-resolved trusted-time and entry-signature state. They join
   * the capture rows below in one table and one set of counts: ADR-0023 makes
   * the Exhibit the unit this document describes, so a count that covered
   * captures only would describe part of the package as though it were all of
   * it. Absent or empty for a package of captures alone.
   */
  exhibits?: CertificationExhibitInput[]
}

/** One committed non-Capture Exhibit, as the certifier states it. */
export interface CertificationExhibitInput {
  id: string
  kind: string
  /** The recorded display name — never derived from the storage path (X35). */
  name: string
  exhibitNumber: number
  trustedTime: TrustedTimeResult
  entrySignature: EntrySignatureStatus
}

const NO_TRUSTED_TIME: TrustedTimeResult = { trustedTime: 'none' }

/**
 * One Exhibit's row. `title`/`url` carry a Capture's page title and URL; for
 * any other kind `title` is the recorded file name and `url` is empty, because
 * Birdbrain did not retrieve those bytes from anywhere and a blank URL column
 * would read as missing data rather than as a kind that has none.
 */
export interface CertificationExhibitRow {
  id: string
  kind: string
  title: string
  url: string
  trustedTime: TrustedTime
  tsaName?: string
  stampedAt?: string
  entrySignature: EntrySignatureStatus
}

export interface CertificationFields {
  toolName: string
  toolVersion: string
  hashAlgorithm: 'SHA-256'
  processDescription: string
  tsaIdentity: string
  certifier: {
    operatorName: string
    operatorRole: string
    operatorOrganization: string
    installationId: string
  }
  trustedTime: {
    stampedCount: number
    pendingCount: number
    noneCount: number
    allStamped: boolean
  }
  entrySignatures: {
    signedCount: number
    unsignedLegacyCount: number
    noEntryCount: number
    allSigned: boolean
  }
  /** Every Exhibit in this export, captures first, in the order given. */
  exhibits: CertificationExhibitRow[]
  exportTimestamp: string
  caseName: string
  caseNumber?: string
  isDemo: boolean
  purposeOrAuthority?: string
  manifestHead: { index: number; entryHash: string } | null
  signingKeyFingerprint: string
  contentsSummary: string
}

const LAWYER_TBD_MARKER = '[LEGAL WORDING TO BE SUPPLIED BY COUNSEL]'

// Resolve the real application version. The unit-test/vitest harness runs via
// ELECTRON_RUN_AS_NODE where the electron `app` module is unavailable, so guard
// the lookup and fall back to a sentinel rather than throwing.
export function resolveToolVersion(): string {
  if (typeof app?.getVersion === 'function') return app.getVersion()
  return process.env.npm_package_version ?? '0.0.0'
}

export function buildCertificationFields(
  data: CertificationInput,
  toolVersion: string
): CertificationFields {
  const captures: CertificationExhibitRow[] = data.captures.map((capture) => {
    const resolved = data.trustedTimeByCaptureId.get(capture.id) ?? NO_TRUSTED_TIME
    const entrySignature = data.entrySignatureByCaptureId.get(capture.id)
    // No default: the map is total over data.captures, so an absent key is a
    // broken invariant rather than a capture without an entry — which the map
    // already spells 'no-entry'. Refuse to certify instead of printing a count
    // that quietly understates how much of the package is unsigned.
    if (entrySignature === undefined) {
      throw new Error(`certification: no entry signature resolved for capture ${capture.id}`)
    }
    return {
      id: capture.id,
      kind: 'capture',
      title: capture.title,
      url: capture.url,
      trustedTime: resolved.trustedTime,
      tsaName: resolved.tsaName,
      stampedAt: resolved.stampedAt,
      entrySignature
    }
  })

  // Captures first, then every other kind in the order the export resolved
  // them (Exhibit Number). One list, because every count below is a claim about
  // the package and not about one kind within it.
  const exhibits: CertificationExhibitRow[] = [
    ...captures,
    ...(data.exhibits ?? []).map((exhibit) => ({
      id: exhibit.id,
      kind: exhibit.kind,
      title: exhibit.name,
      url: '',
      trustedTime: exhibit.trustedTime.trustedTime,
      tsaName: exhibit.trustedTime.tsaName,
      stampedAt: exhibit.trustedTime.stampedAt,
      entrySignature: exhibit.entrySignature
    }))
  ]

  const counts: Record<TrustedTime, number> = { rfc3161: 0, pending: 0, none: 0 }
  for (const row of exhibits) counts[row.trustedTime]++

  const signatureCounts: Record<EntrySignatureStatus, number> = {
    signed: 0,
    'unsigned-legacy': 0,
    'no-entry': 0
  }
  for (const row of exhibits) signatureCounts[row.entrySignature]++

  return {
    toolName: 'Birdbrain',
    toolVersion,
    hashAlgorithm: 'SHA-256',
    processDescription:
      'Each web page was captured as a self-contained MHTML archive. The captured bytes ' +
      'were hashed with SHA-256 and recorded in a hash-chained append-only manifest, so that ' +
      'any later alteration of a capture or of the manifest is detectable. Where enabled, the ' +
      'capture content hash was submitted to an RFC 3161 Time-Stamping Authority and the ' +
      'returned timestamp token was retained alongside the capture.',
    tsaIdentity: data.tsaUrl,
    certifier: {
      operatorName: data.operatorName,
      operatorRole: data.operatorRole,
      operatorOrganization: data.operatorOrganization,
      installationId: data.installationId
    },
    trustedTime: {
      stampedCount: counts.rfc3161,
      pendingCount: counts.pending,
      noneCount: counts.none,
      allStamped: exhibits.length > 0 && counts.pending + counts.none === 0
    },
    entrySignatures: {
      signedCount: signatureCounts.signed,
      unsignedLegacyCount: signatureCounts['unsigned-legacy'],
      noEntryCount: signatureCounts['no-entry'],
      allSigned:
        exhibits.length > 0 &&
        signatureCounts['unsigned-legacy'] + signatureCounts['no-entry'] === 0
    },
    exhibits,
    exportTimestamp: data.exportTimestamp,
    caseName: data.caseName,
    caseNumber: data.caseNumber,
    isDemo: data.isDemo,
    purposeOrAuthority: data.purposeOrAuthority,
    manifestHead: data.manifestHead,
    signingKeyFingerprint: data.signingKeyFingerprint,
    contentsSummary: buildContentsSummary(data.contents)
  }
}

// Always all three counts, zeros included: "0 operator notes" on a Court
// exhibit states the exclusion plainly rather than hiding it.
//
// Committed Exhibits of other kinds are appended per kind, and a kind the
// package does not hold is omitted rather than printed as a zero: the three
// counts above are fixed categories every package answers for, while the kind
// vocabulary is open (X43) and listing every kind this build knows about would
// turn an unremarkable absence into a finding.
function buildContentsSummary(contents: CertificationInput['contents']): string {
  const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`
  const byKind = Object.entries(contents.exhibitCountsByKind ?? {})
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => plural(count, kind))
  const derived = contents.derivedFileCount ?? 0
  const unanchored = contents.unanchoredDerivedFileCount ?? 0
  const unverifiable = contents.unverifiableDerivedFileCount ?? 0
  const missing = contents.missingDerivedFileCount ?? 0
  return [
    plural(contents.captureCount, 'capture'),
    ...byKind,
    plural(contents.screenshotCount, 'screenshot'),
    ...(derived > 0 ? [plural(derived, 'derived file')] : []),
    ...(unverifiable > 0
      ? [
          `${plural(unverifiable, 'derived file')} enclosed whose anchoring could not be ` +
            'established because the chain did not verify'
        ]
      : []),
    ...(missing > 0
      ? [
          `${plural(missing, 'anchored derived file')} whose stored bytes could not be read ` +
            'and are not enclosed'
        ]
      : []),
    ...(unanchored > 0
      ? [`${plural(unanchored, 'unanchored derived file')} recorded and not enclosed`]
      : []),
    plural(contents.noteCount, 'operator note')
  ].join(', ')
}

export function buildCertification(data: CertificationInput, toolVersion: string): string {
  const fields = buildCertificationFields(data, toolVersion)
  return renderCertificationHtml(fields)
}

/**
 * Rendered with the same stylesheet and class vocabulary as report.html
 * (REPORT_PAGE_CSS), so the two documents read as one package rather than two
 * unrelated files. Only the certificate-specific pieces are added below.
 *
 * As in report.html: paper geometry lives in @page, no page numbers are written
 * into the file, nothing encodes meaning in colour, and self-asserted fields are
 * labelled at every occurrence.
 */
function renderCertificationHtml(fields: CertificationFields): string {
  const { certifier, trustedTime, entrySignatures } = fields

  const stamped = fields.exhibits.filter((c) => c.trustedTime === 'rfc3161')
  const unstamped = fields.exhibits.filter((c) => c.trustedTime !== 'rfc3161')

  // Worded over exhibits, not captures: ADR-0023 makes the Exhibit the unit
  // this document describes, and "all 2 captures carry a timestamp" over a
  // package that also encloses an unstamped attachment invites exactly the
  // whole-package reading the count does not support.
  const trustedTimeProse = trustedTime.allStamped
    ? `<p>All ${stamped.length} exhibit${
        stamped.length === 1 ? '' : 's'
      } in this export carry an RFC 3161 trusted timestamp asserting the time at which the
      exhibit's content digest existed.</p>`
    : stamped.length > 0
      ? `<p>RFC 3161 trusted time is asserted <strong>only</strong> for the ${
          stamped.length
        } exhibit${stamped.length === 1 ? '' : 's'} listed as timestamped below. For the ${
          unstamped.length
        } remaining exhibit${unstamped.length === 1 ? '' : 's'} (${
          trustedTime.pendingCount
        } pending, ${trustedTime.noneCount} none), <strong>no trusted timestamp is
        asserted</strong>; the recorded time is the operator's local system clock
        only.</p>`
      : `<p><strong>No trusted timestamps are asserted</strong> for any of the ${
          unstamped.length
        } exhibit${unstamped.length === 1 ? '' : 's'} in this export (${
          trustedTime.pendingCount
        } pending, ${
          trustedTime.noneCount
        } none). The recorded time is the operator's local system clock only.</p>`

  const stampedRows = stamped
    .map((c) => {
      const who = c.tsaName ? esc(c.tsaName) : 'RFC 3161 TSA'
      const when = c.stampedAt ? isoUtc(c.stampedAt) : ''
      return `<tr>
        <td><span class="ex-title">${esc(c.title)}</span>
        <span class="ex-url mono">${esc(c.url || c.kind)}</span></td>
        <td class="mono break">${who}${when ? `<br>${when}` : ''}</td>
      </tr>`
    })
    .join('')

  const unstampedRows = unstamped
    .map(
      (c) => `<tr>
        <td><span class="ex-title">${esc(c.title)}</span>
        <span class="ex-url mono">${esc(c.url || c.kind)}</span></td>
        <td><span class="state-primary">${esc(
          c.trustedTime === 'pending' ? 'Token pending' : 'Local clock only'
        )}</span><span class="state-secondary">No trusted timestamp asserted</span></td>
      </tr>`
    )
    .join('')

  // Counted from the same rows report.html states per exhibit, so the summary
  // and the per-exhibit disclosure are one derivation (#611). The all-signed
  // branch states the all-clear and stops: a package with no legacy entries has
  // nothing to disclose, and a "0 unsigned" row reads as a finding rather than
  // as the unremarkable absence it is. An empty export gets its own branch for
  // the same reason — otherwise it falls through to the none-signed wording and
  // prints a bolded negative finding about a set with nothing in it.
  //
  // Counts only, by ruling on #1460: the document states how many entries carry a
  // signature and makes no claim about what else covers an unsigned capture or
  // whether a present signature verifies. Each such claim tried here was false
  // for some capture class, and none is in #611's criteria.
  const { signedCount, unsignedLegacyCount, noEntryCount } = entrySignatures
  const unsignedTotal = unsignedLegacyCount + noEntryCount
  const total = fields.exhibits.length
  const breakdown = `(${unsignedLegacyCount} with an unsigned entry, ${noEntryCount} with no manifest entry)`
  const perExhibit = 'report.html states the signature status of every exhibit individually.'

  const entrySignatureProse =
    total === 0
      ? `<p>This export contains no exhibits, so there is no manifest entry for this document to
        report a signature for.</p>`
      : entrySignatures.allSigned
        ? `<p>A signature is present on the manifest entry for every exhibit in this export
          (${signedCount} of ${total}). ${perExhibit}</p>`
        : signedCount > 0
          ? `<p>A signature is present on the manifest entry for ${signedCount} of the ${total}
            exhibits in this export. For the remaining ${unsignedTotal} exhibit${
              unsignedTotal === 1 ? '' : 's'
            } ${breakdown},
            <strong>no entry signature is asserted</strong>. ${perExhibit}</p>`
          : `<p><strong>No entry signature is asserted</strong> for any of the ${total} exhibit${
              total === 1 ? '' : 's'
            } in this export ${breakdown}. ${perExhibit}</p>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Certificate of authenticity — ${esc(fields.caseName)}</title>
<style>${REPORT_PAGE_CSS}</style>
</head>
<body>
<section class="sheet">
  <header class="wordmark">
    <span class="wordmark-name">${esc(fields.toolName)}</span>
    <span class="wordmark-kind">Supporting certification</span>
  </header>
  <div class="rule-heavy"></div>

  <p class="eyebrow">Case</p>
  <h1 class="case-name">Certificate of authenticity</h1>
  <p class="case-desc">${esc(fields.caseName)} — supporting certification offered under
  FRE 902(13)/(14) or the equivalent rule of the forum, subject to the wording notice below.</p>

  <!-- LAWYER-TBD: The sworn declaration / certification legal wording for the applicable
       jurisdiction and rule (e.g. FRE 902(13)/(14), 28 U.S.C. § 1746) has NOT been drafted.
       Counsel must supply the operative certifying language. Do not treat the placeholder
       banner below as finalized legal text. ${LAWYER_TBD_MARKER} -->
  <div class="tbd">
    <p class="tbd-title">${esc(LAWYER_TBD_MARKER)}</p>
    <p>The operative sworn declaration and certifying wording for the relevant jurisdiction and
    rule must be supplied by counsel. This document is scaffolding: it records the tool, the
    process and the certifier, and asserts nothing about the legal sufficiency of that record.</p>
  </div>
  ${
    fields.isDemo
      ? `<div class="alert">
    <p class="alert-title">Demonstration case</p>
    <p>This case is the demonstration case seeded by ${esc(fields.toolName)}. Its captures are
    <strong>fixture data</strong> supplied with the tool, not evidence collected by the operator.
    This export must not be presented as collected evidence.</p>
  </div>`
      : ''
  }

  <p class="eyebrow spaced">Package</p>
  <div class="field-grid rule-top">
    <div class="field"><div class="field-label">Case number (self-asserted)</div>
      <div class="field-value">${fields.caseNumber ? esc(fields.caseNumber) : 'not stated'}</div></div>
    <div class="field"><div class="field-label">Contents</div>
      <div class="field-value">${esc(fields.contentsSummary)}</div></div>
    <div class="field wide"><div class="field-label">Manifest head at export</div>
      <div class="field-value">${
        fields.manifestHead
          ? `<span class="mono break">entry #${fields.manifestHead.index} · ${esc(
              fields.manifestHead.entryHash
            )}</span>`
          : 'not available — the case manifest could not be read at export time'
      }</div></div>
    <div class="field wide"><div class="field-label">Signing key (SHA-256 of signing-public-key.pem)</div>
      <div class="field-value"><span class="mono break">${esc(
        fields.signingKeyFingerprint
      )}</span></div></div>
  </div>

  <p class="eyebrow spaced">Capturing tool</p>
  <div class="field-grid rule-top">
    <div class="field"><div class="field-label">Tool name</div>
      <div class="field-value">${esc(fields.toolName)}</div></div>
    <div class="field"><div class="field-label">Tool version</div>
      <div class="field-value">${esc(fields.toolVersion)}</div></div>
    <div class="field"><div class="field-label">Hash algorithm</div>
      <div class="field-value">${esc(fields.hashAlgorithm)}</div></div>
    <div class="field"><div class="field-label">Time-stamping authority (configured)</div>
      <div class="field-value"><span class="mono break">${
        fields.tsaIdentity ? esc(fields.tsaIdentity) : 'none configured'
      }</span></div></div>
  </div>

  <h2 style="margin-top:22pt">Process</h2>
  <div class="rule-medium"></div>
  <p>${esc(fields.processDescription)}</p>

  <h2 style="margin-top:22pt">Trusted time</h2>
  <div class="rule-medium"></div>
  ${trustedTimeProse}
  ${
    stampedRows
      ? `<p class="micro-heading">Timestamped exhibits</p>
  <table class="index"><thead><tr><th>Title or file name, and URL or kind</th>
  <th>Authority and asserted time (UTC)</th></tr></thead><tbody>${stampedRows}</tbody></table>`
      : ''
  }
  ${
    unstampedRows
      ? `<p class="micro-heading">Exhibits without trusted time</p>
  <table class="index"><thead><tr><th>Title or file name, and URL or kind</th>
  <th>Clock basis</th></tr></thead><tbody>${unstampedRows}</tbody></table>`
      : ''
  }

  <h2 style="margin-top:22pt">Entry signatures</h2>
  <div class="rule-medium"></div>
  ${entrySignatureProse}

  <h2 style="margin-top:22pt">Certifier</h2>
  <div class="rule-medium"></div>
  <div class="field-grid rule-top">
    <div class="field"><div class="field-label">Name (self-asserted)</div>
      <div class="field-value">${esc(certifier.operatorName)}</div></div>
    <div class="field"><div class="field-label">Role (self-asserted)</div>
      <div class="field-value">${
        certifier.operatorRole ? esc(certifier.operatorRole) : 'not stated'
      }</div></div>
    <div class="field"><div class="field-label">Organisation (self-asserted)</div>
      <div class="field-value">${
        certifier.operatorOrganization ? esc(certifier.operatorOrganization) : 'not stated'
      }</div></div>
    <div class="field"><div class="field-label">Installation identifier</div>
      <div class="field-value"><span class="mono break">${esc(
        certifier.installationId
      )}</span></div></div>
    <div class="field wide"><div class="field-label">Export generated</div>
      <div class="field-value"><span class="mono">${isoUtc(fields.exportTimestamp)}</span></div></div>
    <div class="field wide"><div class="field-label">Purpose or authority (self-asserted)</div>
      <div class="field-value">${
        fields.purposeOrAuthority ? esc(fields.purposeOrAuthority) : 'not stated'
      }</div></div>
  </div>

  <div class="alert">
    <p class="alert-title">Self-asserted identity</p>
    <p>The certifier identity above — name, role and organisation — is entered by the operator.
    It is <strong>not</strong> cryptographically authenticated by ${esc(fields.toolName)}, which
    does not verify the operator's real-world identity. Signed manifest entries bind to the
    installation identifier, not to any named person.</p>
  </div>

  <div class="sig-grid">
    <div class="sig-line">
      <span class="sig-caption">Signature of certifier</span>
      <span class="sig-name">${esc(certifierLine(certifier))}</span>
    </div>
    <div class="sig-line"><span class="sig-caption">Date</span></div>
  </div>
</section>

<footer class="running">
  <span>${esc(fields.toolName)} ${esc(fields.toolVersion)} · certification.html</span>
  <span class="mono">${esc(fields.caseName)} · ${isoUtc(fields.exportTimestamp)}</span>
</footer>
</body>
</html>`
}

function certifierLine(certifier: CertificationFields['certifier']): string {
  const tail = [certifier.operatorRole, certifier.operatorOrganization].filter(Boolean).join(', ')
  return tail ? `${certifier.operatorName} — ${tail}` : certifier.operatorName
}

/**
 * Returns HTML-safe output on both paths. Capture timestamps come from an
 * upload payload, so an unparseable value is attacker-controlled text that call
 * sites interpolate directly. Callers must therefore NOT wrap this in esc().
 */
function isoUtc(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return esc(iso)
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
