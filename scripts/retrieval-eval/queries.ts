import type { TargetKey } from './targets'

export interface EvalQuery {
  id: string
  /** Typed into the search box as is. */
  text: string
  /** Target pages a correct answer returns. Empty means the correct answer is no result. */
  expected: TargetKey[]
  /** What the query tests, and how its wording differs from the indexed text. */
  tests: string
}

// The wording differs from the indexed text where the spec asks it to: an
// evaluation that repeats an indexed phrase measures nothing.
export const QUERIES: EvalQuery[] = [
  {
    id: 'image-link-host',
    text: 'northgate-ledger.example.com',
    expected: ['image-link'],
    tests: 'a host that appears only in an image link target'
  },
  {
    id: 'image-link-alt',
    text: 'payments desk Quillmere',
    expected: ['image-link'],
    tests: 'image alt text with its words reordered; the mail header page holds the same words'
  },
  {
    id: 'reply-to-host',
    text: 'tessellate-mail.example.net',
    expected: ['mail-header', 'address-variant'],
    tests: 'the host of a Reply-To address'
  },
  {
    id: 'reply-to-address',
    text: 'c.hale.payouts@tessellate-mail.example.net',
    expected: ['mail-header', 'address-variant'],
    tests: 'a whole address, punctuation included'
  },
  {
    id: 'address-capitals',
    text: 'C.HALE.PAYOUTS',
    expected: ['mail-header', 'address-variant'],
    tests: 'the local part of the address only, in capitals'
  },
  {
    id: 'rare-address',
    text: 'ada.penrose@larchfield.example.org',
    expected: ['rare-address'],
    tests: 'an address that appears in one Capture only'
  },
  {
    id: 'plain-word',
    text: 'Quillmere',
    expected: ['annotated-shop'],
    tests: "control: a plain word many pages hold, expecting the seller's own page"
  },
  {
    id: 'pooled-only',
    text: 'reconciliation 7781',
    expected: [],
    tests: 'words only the pooled file holds; Case search must return nothing'
  }
]
