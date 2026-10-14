// The Case search field names (docs/plans/2026-10-09-case-retrieval-first-slice.md, D4
// and D6). Shared so the extractor records, and the search bar labels, the same list.

/** The headers recorded from a header block, each as `header.<name in lower case>`. */
export const HEADER_FIELDS = [
  'From',
  'Reply-To',
  'Sender',
  'Return-Path',
  'Message-ID',
  'In-Reply-To',
  'Organization',
  'Newsgroups',
  'NNTP-Posting-Host',
  'X-Originating-IP'
] as const

const LABELS = new Map<string, string>([
  ['link.href', 'Link target'],
  ['link.alt', 'Image alt text'],
  ...HEADER_FIELDS.map((name): [string, string] => [
    `header.${name.toLowerCase()}`,
    `${name} header`
  ])
])

/** A field's label in the search bar, such as `Link target` or `From header`. */
export function fieldLabel(field: string): string {
  return LABELS.get(field) ?? field
}
