import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MANIFEST_FILENAME } from '@shared/constants'
import type {
  UnreconciledDeletionFinding,
  UnreconciledDeletionReport,
  UnscannedCase
} from '@shared/types'
import * as caseRepo from '@main/services/db/caseRepo'
import * as captureRepo from '@main/services/db/captureRepo'
import { defaultCaptureStore, type CaptureStore } from '@main/services/captureStore'
import { readManifestSnapshot, verifyManifestChainText } from '@main/services/manifest'
import { getPublicKeyPem } from '@main/services/signingKey'

// #622. A capture delete is write-ahead: the signed `deletion` entry is
// appended and fsynced BEFORE the files are unlinked and the row removed. Die
// in that window and the manifest holds a valid, fully-formed trailing deletion
// entry while `captures` still has the row. verifyManifestChain reports valid —
// correctly, nothing about the chain is wrong — so no integrity check can see
// the disagreement. This scan is the one that can.
//
// It is read-only on the evidence path: lenient snapshot read plus chain
// verification, no write to manifest.jsonl and no SQL of its own (hence no
// getDb import and no lint fence to cross). It cannot repair anything either —
// the manifest holds the claim, not the data, and truncating the entry would be
// a lie if the files are in fact already gone. Recovery is re-running the
// delete, which appends a clean entry over the pre-existing seam.
//
// Not part of the 2s-polled diagnostics snapshot: establishing "chain valid"
// honestly means verifying every signature in every case manifest, and a check
// that stalls the main process is the very fault the panel exists to report.

export interface DeletionReconciliationDeps {
  store?: CaptureStore
  now?: () => Date
}

function isDeletionEntry(
  entry: Record<string, unknown>
): entry is { type: 'deletion'; captureId: string; index: number } & Record<string, unknown> {
  return (
    entry.type === 'deletion' &&
    typeof entry.captureId === 'string' &&
    typeof entry.index === 'number'
  )
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Scans every live case for deletion entries the database has not caught up
 * with: a manifest `deletion` entry whose capture still has a row in that same
 * case.
 *
 * Read-only. Reports nothing about a case whose chain does not verify — the
 * finding's claim is "the chain is valid AND the row is still there", and half
 * of that cannot be asserted over an unverified chain.
 *
 * @returns A report that distinguishes "scanned, none found" from "could not scan"
 */
export function scanUnreconciledDeletions(
  deps: DeletionReconciliationDeps = {}
): UnreconciledDeletionReport {
  const store = deps.store ?? defaultCaptureStore
  const generatedAt = (deps.now?.() ?? new Date()).toISOString()

  let cases: ReturnType<typeof caseRepo.listCases>
  let publicKeyPem: string
  try {
    cases = caseRepo.listCases()
    publicKeyPem = getPublicKeyPem()
  } catch {
    // Database, storage root or signing key not initialised. An empty findings
    // list would read as "clean"; `available: false` says no scan ran.
    return { generatedAt, available: false, casesScanned: 0, findings: [], unscanned: [] }
  }

  const findings: UnreconciledDeletionFinding[] = []
  const unscanned: UnscannedCase[] = []
  let casesScanned = 0

  for (const { id: caseId, name: caseName } of cases) {
    let entries: Record<string, unknown>[]
    let chainValid: boolean
    let chainReason: string | undefined
    try {
      // ONE read, then verify those exact bytes. verifyManifestChain(caseDir)
      // would re-read the file, and the timestamp worker can append between the
      // two reads — leaving the entries reported on and the text actually
      // verified as different manifests.
      // Checked before the read, not after: readManifestSnapshot returns an
      // empty buffer for a missing file rather than throwing, and an empty
      // chain verifies, so the case would otherwise count as verified and feed
      // the panel's "every deletion is reconciled" line. A check whose whole
      // purpose is reconciling manifests against the database must not report a
      // missing manifest as clean. Emptiness alone is not the test — initManifest
      // creates an empty file, so a case that has never written an entry is
      // legitimately empty and genuinely has nothing to reconcile.
      const caseDir = store.caseDir(caseId)
      if (!existsSync(join(caseDir, MANIFEST_FILENAME))) {
        unscanned.push({
          caseId,
          caseName,
          reason: 'manifest is missing — nothing to reconcile against'
        })
        continue
      }
      const snapshot = readManifestSnapshot(caseDir)
      entries = snapshot.entries
      const chain = verifyManifestChainText(snapshot.jsonl.toString('utf-8'), { publicKeyPem })
      chainValid = chain.valid
      chainReason = chain.reason
    } catch (err) {
      unscanned.push({ caseId, caseName, reason: `manifest unreadable — ${messageOf(err)}` })
      continue
    }

    if (!chainValid) {
      unscanned.push({
        caseId,
        caseName,
        reason: chainReason ?? 'manifest chain did not verify'
      })
      continue
    }
    casesScanned += 1

    const deletions = entries.filter(isDeletionEntry)
    if (deletions.length === 0) continue

    // Scoped to THIS case's database id, never the entry's embedded `caseId`:
    // an imported chain carries the source installation's case id, and archive
    // import remaps colliding ids, so matching on the entry field could alias a
    // finding onto an unrelated case's capture.
    const liveIds = new Set(
      captureRepo
        .getCapturesByIds([...new Set(deletions.map((entry) => entry.captureId))])
        .filter((capture) => capture.caseId === caseId)
        .map((capture) => capture.id)
    )

    for (const entry of deletions) {
      if (!liveIds.has(entry.captureId)) continue
      findings.push({
        caseId,
        caseName,
        captureId: entry.captureId,
        manifestIndex: entry.index,
        entryTimestamp: typeof entry.timestamp === 'string' ? entry.timestamp : '',
        operatorName: typeof entry.operatorName === 'string' ? entry.operatorName : '',
        ...(typeof entry.reason === 'string' ? { reason: entry.reason } : {})
      })
    }
  }

  return { generatedAt, available: true, casesScanned, findings, unscanned }
}
