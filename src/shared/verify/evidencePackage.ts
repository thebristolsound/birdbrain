import { createHash } from 'crypto'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'fs'
import { join, resolve, sep } from 'path'
import {
  EvidencePackageSchema,
  ManifestEntrySchema,
  WORKING_COPY_MARKER_FILENAME,
  WorkingCopyMarkerSchema
} from '@shared/schemas'
import type { ManifestEntry } from '@shared/schemas'
import { parseTimestampToken } from '@shared/verify/timestampToken'
import { describeUnsupportedEntry, verifyManifestChainText } from '@shared/verify/manifestChain'
import { canonicalStringify } from '@shared/verify/canonicalJson'
import { packageHash } from '@shared/verify/packageHash'
import { verifyEntrySignature } from '@shared/verify/signature'

// The standalone package verifier (#122 §7). This is the ONLY fs-touching
// module under src/shared/verify and is deliberately kept OFF the `index.ts`
// barrel so no renderer/browser bundle that wants the pure functions ever pulls
// in `fs`. The CLI and main process import it via this subpath.
//
// Trust model (§3.4, §7): the signed `manifest.jsonl` is the sole source of
// truth. The verifier establishes the chain, derives the active-capture set from
// it, binds package files to the chain, cross-checks the head, and finally
// reconciles the UNSIGNED `evidence.json` index against that verified truth.
// A selection-scoped package (#398, ADR-0009) additionally ships
// `export-entry.json` — its own export entry's signed manifest line — whose
// captureIds become the trusted selection ONLY after the entry's signature,
// chain linkage and recomputed hash are established against the bundled key
// and chain head. `evidence.json` is never that source: it is unsigned, and a
// tamperer could pad an unsigned list to explain away a removed capture (#580).
// A PASS is an integrity + internal-consistency result — NOT an authenticity
// claim. Timestamp checks here are STRUCTURAL ONLY (imprint + byte-binding);
// canonical TSA authenticity is the runbook's `openssl ts -verify` (VERIFY.md),
// so binary-PASS != runbook-PASS.

export type CheckStatus = 'pass' | 'fail' | 'skip'

export interface PackageCheck {
  name: string
  status: CheckStatus
  reason?: string
}

export interface PackageVerifyResult {
  // True iff no check has status 'fail' ('skip' is allowed). The verifier runs
  // EVERY check and collects ALL failures rather than short-circuiting on the
  // first — with the two exceptions below (`notVerifiable`, `unsupported`),
  // which end verification before the checks they would poison can run and are
  // reported as outcomes of their own. Both return `pass: false` with no failed
  // check: false because nothing was verified, not because something failed.
  pass: boolean
  checks: PackageCheck[]
  /**
   * Third outcome (#399, ADR-0010): the directory is a self-identified Working
   * Copy — a non-evidentiary export with no manifest to verify — so the honest
   * report is "not a verifiable object", not FAIL. `pass` stays false: this
   * outcome confers no integrity claim whatsoever. Only ever set when
   * manifest.jsonl is ABSENT — a present manifest is always verified, so a
   * planted marker can never silence a chain.
   */
  notVerifiable?: { reason: string }
  /**
   * Fourth outcome (ADR-0023, X25): the manifest holds an entry from a newer
   * schema than this verifier was built for, so this build cannot say whether
   * the chain is intact. `pass` stays false — no integrity claim is made — but
   * this is NOT a tamper verdict, and a caller must not render it as one. The
   * remedy is a newer verifier, and the reason names the version needed.
   * Verify-core sets it only once the entries preceding the unreadable one
   * have verified and that entry's own linkage, hash and signature under the
   * package signing key hold — nothing at or after it is read — so this
   * outcome cannot be bought by editing a manifest.
   */
  unsupported?: { reason: string }
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// Joins package-relative segments (which originate from the UNTRUSTED
// evidence.json) under `base`, returning undefined if the result escapes the
// package directory. `path.join` normalizes but does not prevent `..` escape.
function safeJoin(base: string, ...segments: string[]): string | undefined {
  const resolved = join(base, ...segments)
  const realBase = realpathSync.native(base)
  const normalized = resolve(resolved)
  return normalized.startsWith(realBase + sep) || normalized === realBase ? resolved : undefined
}

function parseManifestEntries(jsonl: string): ManifestEntry[] {
  const out: ManifestEntry[] = []
  for (const line of jsonl.split('\n')) {
    if (line.trim().length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      break
    }
    const result = ManifestEntrySchema.safeParse(parsed)
    if (!result.success) break
    out.push(result.data)
  }
  return out
}

type ExportEntry = Extract<ManifestEntry, { type: 'export' }>

// Establishes trust in export-entry.json (#398) from primitives, in the same
// way the chain walk trusts a manifest line: schema shape, recomputed
// entryHash over the canonical body (excluding entryHash + signature, exactly
// as manifestChain.ts does), prevHash/index continuing the bundled chain head,
// and a valid signature over the entryHash by the bundled public key. Nothing
// from the file is used until every one of these holds — its captureIds are
// what scopes §7.3/§7.5, so an unproven entry must confer no scope.
function validateExportEntry(
  raw: string,
  chainEntries: ManifestEntry[],
  publicKeyPem: string
): { entry: ExportEntry } | { reason: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { reason: 'export-entry.json is not valid JSON' }
  }
  const result = ManifestEntrySchema.safeParse(parsed)
  if (!result.success) {
    return { reason: 'export-entry.json is not a valid manifest entry' }
  }
  if (result.data.type !== 'export') {
    return { reason: `export-entry.json is a '${result.data.type}' entry, not an export entry` }
  }
  const entry = result.data
  const { entryHash, signature, ...body } = entry
  const recomputed = createHash('sha256').update(canonicalStringify(body)).digest('hex')
  if (recomputed !== entryHash) {
    return { reason: 'export-entry.json entry hash mismatch' }
  }
  const head = chainEntries.at(-1)
  if (entry.prevHash !== (head?.entryHash ?? '')) {
    return { reason: 'export-entry.json prevHash does not match the bundled manifest head' }
  }
  if (entry.index !== (head ? head.index + 1 : 0)) {
    return { reason: 'export-entry.json index does not continue the bundled manifest' }
  }
  if (!signature || !verifyEntrySignature(entryHash, signature, publicKeyPem)) {
    return { reason: 'export-entry.json signature invalid' }
  }
  // The writer sets scope and captureIds together or not at all; an entry
  // claiming one without the other is no writer of ours and confers no scope.
  if ((entry.scope === 'selection') !== (entry.captureIds !== undefined)) {
    return { reason: 'export-entry.json scope and captureIds are inconsistent' }
  }
  // A Working Copy is non-evidentiary by its own signed statement (#399,
  // ADR-0010), so its entry cannot stand as an evidence package's scope proof
  // — otherwise a genuine signed working-copy entry from the same case, which
  // continues the same chain head, would satisfy every check above and let the
  // package pass (#851). Historical working-copy entries INSIDE the bundled
  // manifest stay valid: this rejects the role, not the record.
  if (entry.exportClass === 'working-copy') {
    return { reason: 'export-entry.json declares a working-copy export, not an evidence package' }
  }
  return { entry }
}

/**
 * Verifies the structural integrity of an evidence package.
 *
 * Validates the manifest chain as the cryptographic root of trust, binds capture
 * content and timestamps to the verified manifest, and reconciles the evidence.json
 * index against verified entries. All checks are performed regardless of failures.
 *
 * @param dir - Path to the evidence package directory
 * @returns A `PackageVerifyResult` with an overall pass status and individual check results
 */
export function verifyEvidencePackage(dir: string): PackageVerifyResult {
  const checks: PackageCheck[] = []
  const add = (name: string, status: CheckStatus, reason?: string): void => {
    checks.push(reason ? { name, status, reason } : { name, status })
  }

  const manifestPath = join(dir, 'manifest.jsonl')
  const publicKeyPath = join(dir, 'signing-public-key.pem')

  if (!existsSync(manifestPath)) {
    // Working Copy detection (#399), gated on the manifest's ABSENCE: the
    // marker is unsigned and confers nothing, so when a manifest exists it is
    // verified regardless of any marker — a tamperer cannot downgrade a
    // failing package to "not verifiable" without also removing the manifest,
    // which the marker-less branch below still reports as FAIL.
    const markerPath = join(dir, WORKING_COPY_MARKER_FILENAME)
    if (existsSync(markerPath)) {
      let marker: unknown
      try {
        marker = JSON.parse(readFileSync(markerPath, 'utf-8'))
      } catch {
        marker = undefined
      }
      if (WorkingCopyMarkerSchema.safeParse(marker).success) {
        return {
          pass: false,
          checks,
          notVerifiable: {
            reason:
              `${WORKING_COPY_MARKER_FILENAME} identifies this as a Birdbrain Working Copy — ` +
              'a non-evidentiary export with no manifest, no signing key and no ' +
              'certification. There is nothing to verify.'
          }
        }
      }
      // An unreadable or wrong-class marker is no marker of ours: fall through
      // to the missing-manifest FAIL rather than inventing a verdict from it.
    }
    add('manifest present', 'fail', 'manifest.jsonl missing from package')
    return { pass: false, checks }
  }
  if (!existsSync(publicKeyPath)) {
    add('signing key present', 'fail', 'signing-public-key.pem missing from package')
    return { pass: false, checks }
  }

  const manifestJsonl = readFileSync(manifestPath, 'utf-8')
  const publicKeyPem = readFileSync(publicKeyPath, 'utf-8')

  // §7.1 chain verification (root of trust).
  const chain = verifyManifestChainText(manifestJsonl, { publicKeyPem })
  // An entry from a newer schema stops verification here, before any further
  // check runs. Continuing would derive the active-capture set from the entries
  // preceding the unreadable one and then report every capture recorded at or
  // after it as missing from the package and absent from the manifest — a page
  // of tamper-shaped FAILs produced by this verifier's age, which is the false
  // accusation X25 exists to prevent.
  if (chain.unsupported) {
    const reason = describeUnsupportedEntry(chain.unsupported)
    add('manifest chain', 'skip', reason)
    return { pass: false, checks, unsupported: { reason } }
  }
  if (chain.valid) {
    add('manifest chain', 'pass')
  } else {
    add(
      'manifest chain',
      'fail',
      chain.brokenAt !== undefined ? `${chain.reason} (at index ${chain.brokenAt})` : chain.reason
    )
  }

  // Operate on the schema-valid entries parsed up to the first break — no entry
  // past `brokenAt` can be trusted. When the chain is valid this is every entry.
  const entries = parseManifestEntries(manifestJsonl)

  // §7.2 active-capture set: every `capture` entry whose captureId has no later
  // `deletion` entry. Deleted captures are expected absent — not required to
  // have files.
  const deletedIds = new Set<string>()
  for (const e of entries) {
    if (e.type === 'deletion') deletedIds.add(e.captureId)
  }
  const activeCaptures = entries.filter(
    (e): e is Extract<ManifestEntry, { type: 'capture' }> =>
      e.type === 'capture' && !deletedIds.has(e.captureId)
  )

  const timestampEntries = entries.filter(
    (e): e is Extract<ManifestEntry, { type: 'timestamp' }> => e.type === 'timestamp'
  )

  // §7.2b export-entry.json (#398): the package's signed statement of its own
  // scope — the exact export-entry line appended to the live manifest when
  // this package was sealed, which the bundled manifest.jsonl (snapshotted
  // before that append) cannot contain. When the file is absent the package is
  // pre-scope (or its scope proof was stripped) and verification proceeds
  // unscoped — so a selection package with the file removed FAILs §7.3 for
  // every unselected capture rather than passing with its absences
  // unexplained.
  let selectionIds: Set<string> | undefined
  // The signed statement of what the package contained when it was sealed.
  let signedPackageHash: string | undefined
  const exportEntryPath = join(dir, 'export-entry.json')
  if (existsSync(exportEntryPath)) {
    // existsSync also passes for a directory or a file this process cannot
    // read; a throwing read must fail this check, not abort verification.
    let rawEntry: string | undefined
    try {
      rawEntry = readFileSync(exportEntryPath, 'utf-8')
    } catch (err) {
      add('export entry', 'fail', `export-entry.json unreadable: ${(err as Error).message}`)
    }
    if (rawEntry !== undefined) {
      const validated = validateExportEntry(rawEntry, entries, publicKeyPem)
      if ('reason' in validated) {
        add('export entry', 'fail', validated.reason)
      } else {
        add('export entry', 'pass')
        const { scope, captureIds } = validated.entry
        signedPackageHash = validated.entry.packageHash
        if (scope === 'selection' && captureIds !== undefined) {
          selectionIds = new Set(captureIds)
        }
      }
    }
  }

  // The trusted selection must itself reconcile against the chain: a selection
  // id with no active capture entry is a claim the chain cannot bind bytes to,
  // and an unverifiable claimed member fails closed.
  if (selectionIds) {
    const chainActiveIds = new Set(activeCaptures.map((c) => c.captureId))
    let scopeOk = true
    for (const id of selectionIds) {
      if (!chainActiveIds.has(id)) {
        scopeOk = false
        add(
          'export scope',
          'fail',
          `selection names capture ${id} with no active capture entry in the verified manifest`
        )
      }
    }
    if (scopeOk) add('export scope', 'pass')
  }

  // Untrusted index: parsed for structure, used ONLY to detect index edits and
  // to help LOCATE timestamp files (§7.3). Never used to decide what to check.
  let evidence: ReturnType<typeof EvidencePackageSchema.parse> | undefined
  const evidencePath = join(dir, 'evidence.json')
  if (!existsSync(evidencePath)) {
    add('evidence.json present', 'fail', 'evidence.json missing from package')
  } else {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(evidencePath, 'utf-8'))
    } catch (err) {
      add('evidence.json valid', 'fail', `evidence.json invalid: ${(err as Error).message}`)
    }
    if (raw !== undefined) {
      const result = EvidencePackageSchema.safeParse(raw)
      if (result.success) {
        evidence = result.data
        add('evidence.json valid', 'pass')
      } else {
        add('evidence.json valid', 'fail', `evidence.json invalid: ${result.error.issues[0]?.message}`)
      }
    }
  }

  // §7.3 per-active-capture binding (chain -> files).
  for (const cap of activeCaptures) {
    // Scoped verification (#398): a chain capture outside the signed selection
    // is absent by design — the verified export entry records its exclusion —
    // so its absence is not evidence loss. One SKIP keeps the exclusion
    // visible; captures inside the selection keep the full strict checks.
    if (selectionIds && !selectionIds.has(cap.captureId)) {
      add(
        `capture ${cap.captureId}`,
        'skip',
        'outside the signed export selection — not packaged'
      )
      continue
    }
    const mhtmlPath = join(dir, 'pages', `${cap.captureId}.mhtml`)
    const name = `capture ${cap.captureId} content`
    if (!existsSync(mhtmlPath)) {
      add(name, 'fail', `capture ${cap.captureId}: content file missing from package`)
    } else if (sha256File(mhtmlPath) !== cap.contentHash) {
      add(name, 'fail', `capture ${cap.captureId}: content hash does not match manifest`)
    } else {
      add(name, 'pass')
    }

    // Screenshot — content-addressed by its own sha256, which equals the signed
    // `screenshotHash`. Absent hash => grandfathered SKIP; present hash with a
    // missing file => FAIL.
    const shotName = `capture ${cap.captureId} screenshot`
    if (cap.screenshotHash === undefined) {
      add(shotName, 'skip')
    } else {
      const shotPath = join(dir, 'screenshots', `${cap.screenshotHash}.png`)
      if (!existsSync(shotPath)) {
        add(shotName, 'fail', `capture ${cap.captureId}: screenshot file missing`)
      } else if (sha256File(shotPath) !== cap.screenshotHash) {
        add(shotName, 'fail', `capture ${cap.captureId}: screenshot hash does not match manifest`)
      } else {
        add(shotName, 'pass')
      }
    }

    // Timestamp — STRUCTURAL only: locate the .tst (untrusted name), byte-bind
    // it to the SIGNED `tsaToken`, and check the token's imprint == contentHash.
    // Canonical TSA verification is the runbook's `openssl ts -verify`.
    // The trusted-time axis (rfc3161/pending/none) is resolved by verify-core
    // from the same verified entries (#161) and surfaced in the check reason.
    const tsName = `capture ${cap.captureId} timestamp`
    const axis = chain.trustedTimes.get(cap.contentHash)
    const tsEntry = timestampEntries.find(
      (t) => t.captureContentHash === cap.contentHash && typeof t.tsaToken === 'string'
    )
    if (!tsEntry || typeof tsEntry.tsaToken !== 'string') {
      // No token to byte-bind. Report the axis: an eligible v2 capture is
      // 'pending'; a legacy/grandfathered one is 'none'. Either way not a FAIL.
      add(tsName, 'skip', `${axis?.trustedTime ?? 'none'} — no timestamp token in the manifest`)
    } else {
      const signedToken = Buffer.from(tsEntry.tsaToken, 'base64')
      const tstPath = locateTimestampFile(dir, cap.captureId, evidence, signedToken)
      if (!tstPath) {
        add(tsName, 'fail', `capture ${cap.captureId}: timestamp token file missing`)
      } else {
        const fileBytes = readFileSync(tstPath)
        if (!fileBytes.equals(signedToken)) {
          add(
            tsName,
            'fail',
            `capture ${cap.captureId}: timestamp token does not match the signed manifest (swapped token)`
          )
        } else {
          let imprint: string | undefined
          try {
            imprint = parseTimestampToken(signedToken).messageImprintHex
          } catch {
            imprint = undefined
          }
          if (imprint !== cap.contentHash) {
            add(
              tsName,
              'fail',
              `capture ${cap.captureId}: timestamp imprint does not bind this capture`
            )
          } else {
            const who = axis?.tsaName ? ` per ${axis.tsaName}` : ''
            add(
              tsName,
              'pass',
              `${axis?.trustedTime ?? 'none'}${who} — structural (imprint + bytes); ` +
                'run `openssl ts -verify` for TSA authenticity'
            )
          }
        }
      }
    }
  }

  // §7.3b Exhibit entries (ADR-0023). This build READS `exhibit` and
  // `derivation` entries — that is what schema 3 bought — but binds no bytes to
  // them: the exporter that ships Exhibit files and lists them, and the
  // verification that hashes them against these entries, are `803e` (#1156).
  // Saying nothing would let a PASS from this build read as "everything the
  // chain anchors was verified" over a package whose Exhibits it never looked
  // at, which is X44's dishonest third option. A SKIP and not a FAIL: the
  // package is not at fault for being newer than the verifier, and a tamper
  // verdict on that ground is the false accusation X25 forbids. `entries` is
  // PARSE-scoped, not brokenAt-scoped: parseManifestEntries stops at the first
  // line it cannot read, so a chain that FAILs on a signature, hash or linkage
  // with every line parseable still lists its Exhibit entries here and emits
  // their SKIPs inside a FAIL report. Rows for entries nothing verified, not a
  // claim about them — `pass` is false regardless. The scoping itself, and the
  // comment at the `entries` declaration that still says otherwise, are #691.
  for (const entry of entries) {
    if (entry.type === 'exhibit') {
      add(
        `exhibit ${entry.exhibitId}`,
        'skip',
        `Exhibit ${entry.exhibitNumber} (${entry.kind}) at ${entry.path}: this verifier does not ` +
          'bind Exhibit bytes to the chain — 803e (#1156) adds it'
      )
    } else if (entry.type === 'derivation') {
      add(
        `derivation ${entry.derivation} of ${entry.parentExhibitId}`,
        'skip',
        'this verifier does not bind Derived File bytes to the chain — 803e (#1156) adds it'
      )
    }
  }

  // §7.4 head cross-check (index integrity).
  if (evidence) {
    const head = entries.at(-1)
    const expectedIndex = head?.index ?? null
    const expectedHash = head?.entryHash ?? null
    const { manifestHeadIndex, manifestHeadHash } = evidence.verificationMaterials
    if (manifestHeadIndex !== expectedIndex || manifestHeadHash !== expectedHash) {
      add(
        'evidence.json head',
        'fail',
        'evidence.json head does not match the verified manifest (index edited)'
      )
    } else {
      add('evidence.json head', 'pass')
    }
  }

  // §7.5 evidence.json reconciliation (secondary). Scoped packages reconcile
  // the index against the signed selection (#398): the chain captures expected
  // in the index are those inside the selection, and an index row outside the
  // selection is as much a chain/index disagreement as one outside the chain.
  if (evidence) {
    const activeIds = new Set(activeCaptures.map((c) => c.captureId))
    const indexIds = new Set(evidence.captures.map((c) => c.id))
    const expectedIds = selectionIds
      ? new Set([...activeIds].filter((id) => selectionIds.has(id)))
      : activeIds
    let coverageOk = true
    for (const id of expectedIds) {
      if (!indexIds.has(id)) {
        coverageOk = false
        add('evidence.json coverage', 'fail', `evidence.json omits verified capture ${id}`)
      }
    }
    for (const id of indexIds) {
      if (activeIds.has(id) && selectionIds && !selectionIds.has(id)) {
        coverageOk = false
        add(
          'evidence.json coverage',
          'fail',
          `evidence.json lists capture ${id} outside the signed export selection`
        )
      }
      if (!activeIds.has(id)) {
        coverageOk = false
        // Still a FAIL, and still the same check (#622 ruling): the package's
        // index and its signed manifest disagree about what the case contains,
        // and softening that to a warning would change an evidentiary verdict.
        //
        // The deletion entry adds one fact and no more: the chain records this
        // id as deleted. It deliberately does NOT name a cause. Two different
        // inputs reach this branch with byte-identical evidence — an export
        // taken during the #622 crash window, and an evidence.json edited to
        // re-add a capture the chain legitimately deleted — and nothing else
        // in this module separates them. `evidence.json head` compares only the
        // head index and hash, so a captures-array edit does not trip it, and
        // the artifact sweep walks evidence.json's own list, so it does not
        // either. This check is the only one that fires on that tamper. Naming
        // an interrupted delete here would hand the tamperer a benign
        // explanation, and would infer a fact about the exporting database from
        // evidence.json, which line 129 declares untrusted.
        add(
          'evidence.json coverage',
          'fail',
          deletedIds.has(id)
            ? `evidence.json lists capture ${id} absent from the verified manifest: the chain ` +
                'records it as deleted'
            : `evidence.json lists capture ${id} absent from the verified manifest`
        )
      }
    }
    if (coverageOk) add('evidence.json coverage', 'pass')

    let sweepOk = true
    for (const artifact of evidence.artifacts) {
      const filePath = safeJoin(dir, artifact.path)
      if (!filePath) {
        sweepOk = false
        add(
          'evidence.json artifact sweep',
          'fail',
          `artifact ${artifact.path}: path escapes package`
        )
      } else if (!existsSync(filePath)) {
        sweepOk = false
        add('evidence.json artifact sweep', 'fail', `artifact ${artifact.path}: file missing`)
      } else if (sha256File(filePath) !== artifact.sha256) {
        sweepOk = false
        add(
          'evidence.json artifact sweep',
          'fail',
          `artifact ${artifact.path}: sha256 does not match evidence.json`
        )
      }
    }
    if (sweepOk) add('evidence.json artifact sweep', 'pass')

    // Binds the artifact index to the package's signed statement of itself
    // (#836). The sweep above proves each listed file matches its row; this
    // proves the ROW SET is the one that was sealed. Without it a tamperer can
    // edit or drop a packaged file AND its row in the unsigned evidence.json
    // and both checks stay silent — the gap that left notes.md (#399), which
    // has no manifest entry of its own, anchored only by a hash nothing
    // recomputed. Runs only when the package ships a validated export entry:
    // pre-scope packages (#398) carry no such statement, and their absence is
    // already handled unscoped above, so they are unaffected.
    if (signedPackageHash !== undefined) {
      const recomputed = packageHash(evidence.artifacts)
      if (recomputed === signedPackageHash) {
        add('package hash', 'pass')
      } else {
        add(
          'package hash',
          'fail',
          "evidence.json's artifact index does not match the packageHash in the signed export entry"
        )
      }
    }
  }

  const pass = !checks.some((c) => c.status === 'fail')
  return { pass, checks }
}

// Locates a capture's `.tst` file. The file NAME carries no security weight —
// buildEvidenceZip dedupes token files by content hash and names each after the
// FIRST capture sharing that hash, so a capture is not guaranteed a
// `timestamps/{ownId}.tst`. The byte-binding to the signed `tsaToken` is the
// real check, so trusting the untrusted index/scan only to FIND the file is
// sound. Resolution order: the conventional own-id path, then the index's
// `timestampTokenPaths`, then any `timestamps/` file whose bytes match the
// signed token.
function locateTimestampFile(
  dir: string,
  captureId: string,
  evidence: ReturnType<typeof EvidencePackageSchema.parse> | undefined,
  signedToken: Buffer
): string | undefined {
  const ownPath = join(dir, 'timestamps', `${captureId}.tst`)
  if (existsSync(ownPath)) return ownPath

  const indexed = evidence?.captures.find((c) => c.id === captureId)?.timestampTokenPaths ?? []
  for (const rel of indexed) {
    const p = safeJoin(dir, rel)
    if (p && existsSync(p)) return p
  }

  const tsDir = join(dir, 'timestamps')
  if (!existsSync(tsDir)) return undefined
  for (const file of readdirSync(tsDir)) {
    const p = join(tsDir, file)
    try {
      if (readFileSync(p).equals(signedToken)) return p
    } catch {
      // ignore unreadable entries
    }
  }
  return undefined
}
