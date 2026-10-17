import { createHash } from 'crypto'
import { defaultCaptureStore, type CaptureStore } from '@main/services/captureStore'
import { verifyCapture } from '@main/services/captureLifecycle'
import { getCapture } from '@main/services/db/captureRepo'
import { getExhibit } from '@main/services/db/exhibitRepo'
import { getFieldRecord, type FieldRecord } from '@main/services/db/searchFieldRepo'
import { CAPTURE_LINK_BUDGETS, type CaptureLinkBudgets } from '@main/services/htmlParts'
import { authorChainOf, readCaseChains, type CaptureChainEntry } from '@main/services/manifest'
import { listHtmlPartsInMhtml } from '@main/services/mhtmlDecoder'
import type { ClaimCheck } from '@shared/investigation'
import type { Capture, FieldHitCheck, HashVerification } from '@shared/types'

// The exact check of a Case search field record against the stored files
// (docs/plans/2026-10-09-case-retrieval-first-slice.md, D7). It reads, hashes and
// compares, and writes nothing: the outcome is shown, never stored (D7).
//
// `present` says that the record's text sits at its place in stored bytes that a signed
// capture entry covers. It says nothing about whether what the page states is true.

export interface ClaimCheckDeps {
  store?: CaptureStore
  /** Only the per-part ceiling applies: the check decodes one part. */
  budgets?: CaptureLinkBudgets
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function cannotCheck(reason: string): ClaimCheck {
  return { text: 'cannot-check', basis: null, reason }
}

// The file a verification reason is about. The reasons are captureLifecycle.ts's; a page
// failure carries none or names the page archive.
function failedFile(reason: string | undefined): string {
  if (reason?.startsWith('Screenshot')) return 'The screenshot'
  if (reason?.startsWith('Extracted text')) return 'The Extracted Text file'
  return 'The stored page'
}

// The verification's outcome in plain words, without its status name or raw error text.
function verificationReason(
  status: Exclude<HashVerification['status'], 'verified'>,
  reason: string | undefined
): string {
  switch (status) {
    case 'tampered':
      return `${failedFile(reason)} does not match the hash recorded for it, so the capture does not verify.`
    case 'missing':
      return reason === 'Capture not found'
        ? 'The capture is gone.'
        : `${failedFile(reason)} could not be read, so the capture cannot be verified.`
    case 'chain-broken':
      return "The Case's signed record does not verify for this capture."
    case 'legacy':
      return 'This capture was stored before page archives, and its verification does not hash its stored page.'
    case 'verifier-too-old':
      return "The Case's signed record holds entries this version of Birdbrain cannot read."
  }
}

// The signed capture entry the Capture's verification binds: the entry at its index in
// its author's chain, for the same Content Hash. A row with no index has none, and its
// verification compares the page with the database's hash alone.
function signedEntry(capture: Capture, store: CaptureStore): CaptureChainEntry | null {
  const { manifestIndex } = capture
  if (typeof manifestIndex !== 'number') return null
  const { chain } = authorChainOf(readCaseChains(store.caseDir(capture.caseId)), {
    authorInstallationId: getExhibit(capture.id)?.authorInstallationId ?? null,
    manifestIndex,
    contentHash: capture.hash
  })
  const entry = chain.valid ? chain.captureEntriesByIndex.get(manifestIndex) : undefined
  return entry && entry.contentHash === capture.hash ? entry : null
}

function compare(text: string, record: FieldRecord, basis: ClaimCheck['basis']): ClaimCheck {
  const { startOffset: start, endOffset: end, value } = record
  const whole = Number.isInteger(start) && Number.isInteger(end)
  const found = whole && start >= 0 && start <= end && end <= text.length
  return {
    text: found && text.slice(start, end) === value ? 'present' : 'absent',
    basis,
    reason: null
  }
}

function checkPagePart(
  record: FieldRecord,
  capture: Capture,
  store: CaptureStore,
  budgets: CaptureLinkBudgets
): ClaimCheck {
  const buffer = store.readArtifact(capture.caseId, capture.id, 'mhtml')
  if (!buffer) return cannotCheck('The stored page could not be read.')
  // The verification hashed the file the row's path names; this is the file sliced, so
  // its bytes are hashed again rather than assumed to be the same.
  if (sha256(buffer) !== record.builtContentHash) {
    return cannotCheck('The stored page read for the check does not hash to its Content Hash.')
  }
  const { part } = record
  const parts = listHtmlPartsInMhtml(buffer).parts
  const found = part === null ? undefined : parts[part]
  if (!found) {
    return cannotCheck(
      part === null ? 'The record names no part.' : `Part ${part} is not in the stored page.`
    )
  }
  if (found.encodedSize > budgets.maxPartBytes) {
    return cannotCheck(
      `Part ${part} is over the ${budgets.maxPartBytes}-byte limit for reading one part.`
    )
  }
  return compare(found.decode(), record, 'decoded')
}

function checkText(
  record: FieldRecord,
  capture: Capture,
  entry: CaptureChainEntry,
  store: CaptureStore
): ClaimCheck {
  // The text digest the signed entry holds, never the database's copy of it. An entry
  // from before text digests were signed holds none, and the answer says so.
  const { textHash } = entry
  const buffer = store.readArtifact(capture.caseId, capture.id, 'txt')
  if (!buffer) return cannotCheck('The Extracted Text file could not be read.')
  if (textHash && sha256(buffer) !== textHash) {
    return cannotCheck('The Extracted Text read for the check does not match its signed digest.')
  }
  return compare(buffer.toString('utf-8'), record, textHash ? 'hash-verified' : 'unattested')
}

/**
 * Checks one field record against the stored files, in D7's order: the Exhibit is the
 * one indexed, the Capture verifies against a signed capture entry, and the record's
 * span of the decoded part or the Extracted Text equals its value. Throws when the
 * database or a file read does.
 */
export async function checkFieldHit(
  fieldId: number,
  { store = defaultCaptureStore, budgets = CAPTURE_LINK_BUDGETS }: ClaimCheckDeps = {}
): Promise<FieldHitCheck> {
  const record = getFieldRecord(fieldId)
  if (!record) {
    return { check: cannotCheck('The search record is gone. Search again.'), record: null }
  }
  const { exhibitId, field, value, source, part, startOffset, endOffset, extractor } = record
  const read = {
    exhibitId,
    field,
    value,
    locator: { source, part, startOffset, endOffset, extractor }
  }
  const answer = (check: ClaimCheck): FieldHitCheck => ({ check, record: read })

  if (record.exhibitContentHash !== record.builtContentHash) {
    return answer(cannotCheck('The Exhibit changed after it was indexed.'))
  }
  const verification = await verifyCapture(exhibitId, store, { record: false })
  if (verification.status !== 'verified') {
    return answer(cannotCheck(verificationReason(verification.status, verification.reason)))
  }
  // A verified capture's page hashes to `captures.hash`; the Content Hash the search
  // recorded must be that hash.
  if (verification.computedHash !== record.builtContentHash) {
    return answer(cannotCheck('The Content Hash the search recorded is not the verified one.'))
  }
  // Only a signed entry makes the verified hash more than the database's own value.
  const capture = getCapture(exhibitId)
  const entry = capture ? signedEntry(capture, store) : null
  if (!capture || !entry) {
    return answer(cannotCheck('No signed capture record covers this capture.'))
  }
  if (source === 'html-part') return answer(checkPagePart(record, capture, store, budgets))
  return answer(checkText(record, capture, entry, store))
}
