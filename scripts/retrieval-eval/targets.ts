/**
 * The synthetic evaluation Case's target pages and its one pooled file
 * (docs/plans/2026-10-09-case-retrieval-first-slice.md, D10).
 *
 * Every page, person, address and host is invented. Hosts are subdomains of
 * example.com, example.net and example.org, which RFC 2606 reserves, and IP
 * addresses sit in the documentation ranges (RFC 5737). Each page carries a
 * visible notice saying so. Nothing here comes from a real investigation.
 *
 * Not `.invalid`, which the demo fixture uses: the extractor rejects reserved
 * top-level domains (`validators.ts`), so an `.invalid` address never reaches
 * the extracted-data search and the baseline would understate that path.
 */

import type { UnreviewedGroup } from '@shared/types'

export type TargetKey =
  'image-link' | 'mail-header' | 'rare-address' | 'address-variant' | 'annotated-shop'

export interface TargetPage {
  key: TargetKey
  file: string
  url: string
  /** Gets a Note naming it, so the unreviewed count leaves it out. */
  annotated: boolean
  /** What the page is there to test. */
  tests: string
}

export const TARGET_PAGES: TargetPage[] = [
  {
    key: 'image-link',
    file: 'image-link.html',
    url: 'https://brindle-forum.example.org/thread/88',
    annotated: false,
    tests: 'a host and a phrase present only in an image link target and its alt text'
  },
  {
    key: 'mail-header',
    file: 'mail-header.html',
    url: 'https://webmail.ostrander.example.net/msg/4471/original',
    annotated: false,
    tests: 'an unannotated mail header whose Reply-To address and host no query names'
  },
  {
    key: 'rare-address',
    file: 'rare-address.html',
    url: 'https://harrow-gazette.example.org/notices/week-11',
    annotated: false,
    tests: 'an address that appears in one Capture only'
  },
  {
    key: 'address-variant',
    file: 'address-variant.html',
    url: 'https://brindle-forum.example.org/thread/91',
    annotated: false,
    tests: 'the queried address in other capitalization and punctuation'
  },
  {
    key: 'annotated-shop',
    file: 'annotated-shop.html',
    url: 'https://quillmere-supplies.example.com/',
    annotated: true,
    tests: "the seller's own page, which a Note already names"
  }
]

/**
 * Committed to the Staging Pool, never to the Case: Case search must not
 * return it (ADR-0024).
 */
export const POOLED_FILE = {
  name: 'statement-7781.txt',
  text:
    'Ledger reconciliation 7781, prepared for the payments desk.\n' +
    'Balance forwarded to c.hale.payouts@tessellate-mail.example.net on 12 March 2026.\n'
}

/** Strings only the target pages or the pooled file hold; filler pages must never contain them. */
export const TARGET_ONLY_STRINGS = [
  'northgate-ledger',
  'QM-5521',
  'tessellate',
  'corvane',
  'larchfield',
  'reconciliation',
  '7781'
]

/** Where the unreviewed view must list a target page (D10's table). */
export interface ExpectedPlacement {
  target: TargetKey
  group: UnreviewedGroup
  key: string
}

// The mail header's sender and reply address, which no query names, and the address only
// one Capture holds. Each key is the form the view groups by: the address in lower case.
export const EXPECTED_PLACEMENTS: ExpectedPlacement[] = [
  { target: 'mail-header', group: 'from', key: 'orders@quillmere-supplies.example.com' },
  { target: 'mail-header', group: 'reply-to', key: 'l.marsh.remit@corvane-post.example.net' },
  { target: 'rare-address', group: 'rare', key: 'ada.penrose@larchfield.example.org' }
]
