import { createHash } from 'crypto'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'fs'
import { join, resolve, sep } from 'path'
import { EvidencePackageSchema, ManifestEntrySchema } from '@shared/schemas'
import type { ManifestEntry } from '@shared/schemas'
import { parseTimestampToken } from './timestampToken'
import { verifyManifestChainText } from './manifestChain'

// The standalone package verifier (#122 §7). This is the ONLY fs-touching
// module under src/shared/verify and is deliberately kept OFF the `index.ts`
// barrel so no renderer/browser bundle that wants the pure functions ever pulls
// in `fs`. The CLI and main process import it via this subpath.
//
// Trust model (§3.4, §7): the signed `manifest.jsonl` is the sole source of
// truth. The verifier establishes the chain, derives the active-capture set from
// it, binds package files to the chain, cross-checks the head, and finally
// reconciles the UNSIGNED `evidence.json` index against that verified truth.
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
  // EVERY check and collects ALL failures — it never short-circuits.
  pass: boolean
  checks: PackageCheck[]
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

export function verifyEvidencePackage(dir: string): PackageVerifyResult {
  const checks: PackageCheck[] = []
  const add = (name: string, status: CheckStatus, reason?: string): void => {
    checks.push(reason ? { name, status, reason } : { name, status })
  }

  const manifestPath = join(dir, 'manifest.jsonl')
  const publicKeyPath = join(dir, 'signing-public-key.pem')

  if (!existsSync(manifestPath)) {
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
    const tsName = `capture ${cap.captureId} timestamp`
    const tsEntry = timestampEntries.find(
      (t) => t.captureContentHash === cap.contentHash && typeof t.tsaToken === 'string'
    )
    if (!tsEntry || typeof tsEntry.tsaToken !== 'string') {
      add(tsName, 'skip')
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
            add(tsName, 'pass', 'structural (imprint + bytes) — run `openssl ts -verify` for TSA authenticity')
          }
        }
      }
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

  // §7.5 evidence.json reconciliation (secondary).
  if (evidence) {
    const activeIds = new Set(activeCaptures.map((c) => c.captureId))
    const indexIds = new Set(evidence.captures.map((c) => c.id))
    let coverageOk = true
    for (const id of activeIds) {
      if (!indexIds.has(id)) {
        coverageOk = false
        add('evidence.json coverage', 'fail', `evidence.json omits verified capture ${id}`)
      }
    }
    for (const id of indexIds) {
      if (!activeIds.has(id)) {
        coverageOk = false
        add(
          'evidence.json coverage',
          'fail',
          `evidence.json lists capture ${id} absent from the verified manifest`
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
