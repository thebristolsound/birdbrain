import type { FieldHit, FieldHitCheck } from '@shared/types'

// What the exact check of a search hit shows (docs/plans/2026-10-09-case-retrieval-first-
// slice.md, D7): the outcome, what it compared and where, and never what the page or
// message states.

/** Whether the record the check read is the one the hit shows. */
export function isHitRecord(hit: FieldHit, record: FieldHitCheck['record']): boolean {
  if (!record) return false
  const { locator } = record
  return (
    record.exhibitId === hit.exhibitId &&
    record.field === hit.field &&
    locator.source === hit.locator.source &&
    locator.part === hit.locator.part &&
    locator.startOffset === hit.locator.startOffset &&
    locator.endOffset === hit.locator.endOffset
  )
}

function place({ locator }: FieldHit): string {
  const characters = `characters ${locator.startOffset} to ${locator.endOffset}`
  return locator.source === 'html-part' ? `part ${locator.part}, ${characters}` : characters
}

const BASIS_NOTE = {
  'hash-verified': " The text file matches the digest in the capture's signed record.",
  unattested:
    ' No signed digest covers this text file, so the check cannot show that it is the text that was captured.'
} as const

export const CHECK_FAILED_TEXT = 'The check could not run.'

/** The sentence shown for a finished check of `hit`. */
export function checkAnswer(hit: FieldHit, { check, record }: FieldHitCheck): string {
  // With no record, the reason already says so.
  if (record && !isHitRecord(hit, record)) {
    return 'Cannot check. The search records changed after this search. Search again.'
  }
  if (check.text === 'cannot-check' || !record) return `Cannot check. ${check.reason ?? ''}`.trim()
  const compared = check.basis === 'decoded' ? 'The decoded page text' : 'The Extracted Text'
  const at = place(hit)
  const finding =
    check.text === 'present'
      ? `Present. ${compared} holds the text the search recorded at ${at}.`
      : `Absent. ${compared} does not hold the text the search recorded at ${at}.`
  const basis = check.basis === 'hash-verified' || check.basis === 'unattested' ? check.basis : null
  const first =
    hit.occurrences > 1
      ? ` The check read the first of the ${hit.occurrences} places this value is recorded.`
      : ''
  return `${finding}${basis ? BASIS_NOTE[basis] : ''}${first}`
}
