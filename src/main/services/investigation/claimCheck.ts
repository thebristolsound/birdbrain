import { createHash } from 'crypto'
import { defaultCaptureStore, type CaptureStore } from '@main/services/captureStore'
import { verifyCapture } from '@main/services/captureLifecycle'
import { getCapture } from '@main/services/db/captureRepo'
import { getExhibit } from '@main/services/db/exhibitRepo'
import { getFieldRecord, type FieldRecord } from '@main/services/db/searchFieldRepo'
import { CAPTURE_LINK_BUDGETS, type CaptureLinkBudgets } from '@main/services/htmlParts'
import { authorChainOf, readCaseChains } from '@main/services/manifest'
import { listHtmlPartsInMhtml } from '@main/services/mhtmlDecoder'
import type { ClaimCheck } from '@shared/investigation'
import type { FieldHitCheck } from '@shared/types'

// The exact check of a Case search field record against the stored files
// (docs/plans/2026-10-09-case-retrieval-first-slice.md, D7). It reads, hashes and
// compares, and writes nothing: the outcome is shown, never stored (D7).
//
// `present` says that the record's text sits at its place in the stored bytes. It says
// nothing about whether what the page states is true.

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
  contentHash: string,
  store: CaptureStore,
  budgets: CaptureLinkBudgets
): ClaimCheck {
  const buffer = store.readArtifact(record.caseId, record.exhibitId, 'mhtml')
  if (!buffer) return cannotCheck('The stored page could not be read.')
  // The verification hashed the file the row's path names; this is the file sliced, so
  // its bytes are hashed again rather than assumed to be the same.
  if (sha256(buffer) !== contentHash) {
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
  capture: { caseId: string; hash: string; manifestIndex?: number },
  store: CaptureStore
): ClaimCheck {
  // The digest the Capture's own verification binds the text to: the signed entry in
  // its author's chain, never the database's copy of it.
  const { manifestIndex } = capture
  let textHash: string | undefined
  if (typeof manifestIndex === 'number') {
    const { chain } = authorChainOf(readCaseChains(store.caseDir(capture.caseId)), {
      authorInstallationId: getExhibit(record.exhibitId)?.authorInstallationId ?? null,
      manifestIndex,
      contentHash: capture.hash
    })
    const entry = chain.valid ? chain.captureEntriesByIndex.get(manifestIndex) : undefined
    if (!entry || entry.contentHash !== capture.hash) {
      return cannotCheck('The signed capture record for this capture could not be read.')
    }
    textHash = entry.textHash
  }
  const buffer = store.readArtifact(record.caseId, record.exhibitId, 'txt')
  if (!buffer) return cannotCheck('The Extracted Text file could not be read.')
  if (textHash && sha256(buffer) !== textHash) {
    return cannotCheck('The Extracted Text read for the check does not match its signed digest.')
  }
  return compare(buffer.toString('utf-8'), record, textHash ? 'hash-verified' : 'unattested')
}

/**
 * Checks one field record against the stored files, in D7's order: the Exhibit is the
 * one indexed, the Capture verifies, and the record's span of the decoded part or the
 * Extracted Text equals its value. Throws when the database or a file read does.
 */
export async function checkFieldHit(
  fieldId: number,
  { store = defaultCaptureStore, budgets = CAPTURE_LINK_BUDGETS }: ClaimCheckDeps = {}
): Promise<FieldHitCheck> {
  const record = getFieldRecord(fieldId)
  if (!record) {
    return { check: cannotCheck('The search record is gone. Search again.'), record: null }
  }
  const { exhibitId, field, source, part, startOffset, endOffset, extractor } = record
  const found = { exhibitId, field, locator: { source, part, startOffset, endOffset, extractor } }
  const answer = (check: ClaimCheck): FieldHitCheck => ({ check, record: found })

  if (record.exhibitContentHash !== record.builtContentHash) {
    return answer(cannotCheck('The Exhibit changed after it was indexed.'))
  }
  const verification = await verifyCapture(exhibitId, store, { record: false })
  if (verification.status !== 'verified') {
    const detail = verification.reason ? ` (${verification.reason})` : ''
    return answer(
      cannotCheck(`The capture's verification result is ${verification.status}${detail}.`)
    )
  }
  // A verified capture's file hashes to the hash its signed entry anchors; the Content
  // Hash the search recorded must be that hash.
  if (verification.computedHash !== record.builtContentHash) {
    return answer(cannotCheck('The Content Hash the search recorded is not the verified one.'))
  }
  if (source === 'html-part') {
    return answer(checkPagePart(record, record.builtContentHash, store, budgets))
  }
  const capture = getCapture(exhibitId)
  if (!capture) return answer(cannotCheck('The capture is gone.'))
  return answer(checkText(record, capture, store))
}
