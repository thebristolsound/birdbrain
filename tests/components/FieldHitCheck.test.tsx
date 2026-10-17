// @vitest-environment jsdom
//
// The exact check beside an opened search hit (docs/plans/2026-10-09-case-retrieval-
// first-slice.md, D7): the text of every answer, and that an answer belongs to its hit.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { FieldHit, FieldHitCheck as Result } from '@shared/types'
import type { ClaimCheck } from '@shared/investigation'
import { FieldHitCheck } from '@renderer/components/captures/FieldHitCheck'
import { fakeBridge } from '../renderer/fakeBridge'

function hit(overrides: Partial<FieldHit> = {}): FieldHit {
  return {
    fieldId: 7,
    caseId: 'case1',
    exhibitId: 'cap1',
    exhibitNumber: 3,
    exhibitCitation: '3',
    contentHash: 'c'.repeat(64),
    title: 'Notice',
    field: 'link.href',
    preview: 'https://tollgate-ledger.example.com/pay',
    norm: 'https://tollgate-ledger.example.com/pay',
    occurrences: 1,
    locator: {
      source: 'html-part',
      part: 1,
      startOffset: 40,
      endOffset: 79,
      extractor: 'fields/1'
    },
    ...overrides
  }
}

const TEXT_HIT = hit({
  field: 'header.from',
  locator: { source: 'text', part: null, startOffset: 20, endOffset: 62, extractor: 'fields/1' }
})

function answerFor(target: FieldHit, check: ClaimCheck): Result {
  const { exhibitId, field, locator } = target
  return { check, record: { exhibitId, field, locator } }
}

function stub(...answers: Array<Result | Error>) {
  const checkFieldHit = vi.fn()
  for (const answer of answers) {
    if (answer instanceof Error) checkFieldHit.mockRejectedValueOnce(answer)
    else checkFieldHit.mockResolvedValueOnce(answer)
  }
  fakeBridge({ cases: { checkFieldHit } })
  return checkFieldHit
}

async function press(): Promise<string> {
  fireEvent.click(screen.getByRole('button', { name: 'Check against the stored file' }))
  return (await screen.findByTestId('field-hit-check-answer')).textContent ?? ''
}

afterEach(() => cleanup())

describe('FieldHitCheck answers', () => {
  it.each([
    [
      'present in the decoded page',
      hit(),
      { text: 'present', basis: 'decoded', reason: null },
      'Present. The decoded page text holds the text the search recorded at part 1, characters 40 to 79.'
    ],
    [
      'present in Extracted Text with a signed digest',
      TEXT_HIT,
      { text: 'present', basis: 'hash-verified', reason: null },
      "Present. The Extracted Text holds the text the search recorded at characters 20 to 62. The text file matches the digest in the capture's signed record."
    ],
    [
      'present in Extracted Text with no signed digest',
      TEXT_HIT,
      { text: 'present', basis: 'unattested', reason: null },
      'Present. The Extracted Text holds the text the search recorded at characters 20 to 62. No signed digest covers this text file, so the check cannot show that it is the text that was captured.'
    ],
    [
      'absent from the decoded page',
      hit(),
      { text: 'absent', basis: 'decoded', reason: null },
      'Absent. The decoded page text does not hold the text the search recorded at part 1, characters 40 to 79.'
    ],
    [
      'absent from Extracted Text',
      TEXT_HIT,
      { text: 'absent', basis: 'hash-verified', reason: null },
      "Absent. The Extracted Text does not hold the text the search recorded at characters 20 to 62. The text file matches the digest in the capture's signed record."
    ],
    [
      'cannot check, with the reason',
      hit(),
      { text: 'cannot-check', basis: null, reason: 'The Exhibit changed after it was indexed.' },
      'Cannot check. The Exhibit changed after it was indexed.'
    ],
    [
      'the first of several places',
      hit({ occurrences: 3 }),
      { text: 'present', basis: 'decoded', reason: null },
      'Present. The decoded page text holds the text the search recorded at part 1, characters 40 to 79. The check read the first of the 3 places this value is recorded.'
    ]
  ] as const)('%s', async (_name, target, check, expected) => {
    stub(answerFor(target, check))
    render(<FieldHitCheck hit={target} />)
    expect(await press()).toBe(expected)
  })

  it('says the record is gone when the check found none', async () => {
    stub({
      check: {
        text: 'cannot-check',
        basis: null,
        reason: 'The search record is gone. Search again.'
      },
      record: null
    })
    render(<FieldHitCheck hit={hit()} />)
    expect(await press()).toBe('Cannot check. The search record is gone. Search again.')
  })

  it.each([
    ['another place', { startOffset: 41 }],
    ['another part', { part: 0 }]
  ])('never shows the outcome of a record at %s', async (_name, moved) => {
    const target = hit()
    const other = answerFor(target, { text: 'present', basis: 'decoded', reason: null })
    stub({ ...other, record: { ...other.record!, locator: { ...target.locator, ...moved } } })
    render(<FieldHitCheck hit={target} />)
    expect(await press()).toBe(
      'Cannot check. The search records changed after this search. Search again.'
    )
  })

  it('never shows the outcome of another field or Exhibit', async () => {
    const target = hit()
    const other = answerFor(target, { text: 'cannot-check', basis: null, reason: 'Part 7 gone.' })
    stub({ ...other, record: { ...other.record!, field: 'link.alt', exhibitId: 'cap2' } })
    render(<FieldHitCheck hit={target} />)
    expect(await press()).toBe(
      'Cannot check. The search records changed after this search. Search again.'
    )
  })

  it('reads a failed call as a check that could not run, not as an outcome', async () => {
    stub(new Error('The check could not run'))
    render(<FieldHitCheck hit={hit()} />)
    expect(await press()).toBe('The check could not run.')
  })
})

describe('FieldHitCheck keeps nothing', () => {
  it('asks the main process again on every press', async () => {
    const target = hit()
    const checkFieldHit = stub(
      answerFor(target, { text: 'present', basis: 'decoded', reason: null }),
      answerFor(target, { text: 'absent', basis: 'decoded', reason: null })
    )
    render(<FieldHitCheck hit={target} />)
    expect(await press()).toMatch(/^Present\./)
    fireEvent.click(screen.getByRole('button', { name: 'Check against the stored file' }))
    expect(await screen.findByText(/^Absent\./)).toBeDefined()
    expect(checkFieldHit).toHaveBeenCalledTimes(2)
    expect(checkFieldHit).toHaveBeenNthCalledWith(2, 7)
  })

  it('shows that a check is running and drops an answer for a hit no longer open', async () => {
    let settle: (value: Result) => void = () => {}
    const checkFieldHit = vi.fn(
      () =>
        new Promise<Result>((resolve) => {
          settle = resolve
        })
    )
    fakeBridge({ cases: { checkFieldHit } })
    const first = hit()
    const { rerender } = render(<FieldHitCheck hit={first} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check against the stored file' }))
    expect(screen.getByRole('button', { name: 'Checking…' })).toHaveProperty('disabled', true)

    rerender(<FieldHitCheck hit={hit({ fieldId: 8 })} />)
    settle(answerFor(first, { text: 'present', basis: 'decoded', reason: null }))
    await Promise.resolve()
    expect(screen.queryByTestId('field-hit-check-answer')).toBeNull()
    expect(screen.getByRole('button', { name: 'Check against the stored file' })).toBeDefined()
  })

  it('removes the answer when another hit opens', async () => {
    const target = hit()
    stub(answerFor(target, { text: 'present', basis: 'decoded', reason: null }))
    const { rerender } = render(<FieldHitCheck hit={target} />)
    await press()
    rerender(<FieldHitCheck hit={hit({ fieldId: 8 })} />)
    expect(screen.queryByTestId('field-hit-check-answer')).toBeNull()
  })
})
