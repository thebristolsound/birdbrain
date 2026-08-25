/**
 * Classify a selected passage into the kind of thing an investigator is most
 * likely to want watched, and derive the value a Selector or Tag should carry.
 *
 * Ported from the standalone design mock's `selKindOf` (2026-08-21 handoff,
 * template 15820-15832) so the app matches the pixels it was designed against.
 * It lives in `@shared` rather than under `components/notes/` because the
 * extension's own selection bar needs the same answers, and the extension
 * resolves `@shared` as a runtime value — a copy of the regexes in two places
 * is two classifiers that drift.
 *
 * One deliberate divergence from the mock: the mock annotates a Bitcoin
 * address with "Checksum valid - also watched on the chain feed." Neither
 * clause is true here — the test below is a shape regex, not a base58check
 * verification, and there is no chain feed — so the note is dropped rather
 * than shipped as a claim the app cannot back.
 */

export const SELECTION_KINDS = [
  'text',
  'domain',
  'email',
  'btc address',
  'ipv4',
  'hash',
  'handle',
  'filename'
] as const

export type SelectionKind = (typeof SELECTION_KINDS)[number]

export interface ClassifiedSelection {
  /** What a Selector should match on — the raw text, or a narrowed form of it. */
  value: string
  kind: SelectionKind
  /** Operator-facing explanation of a non-obvious transform. Empty when there is none. */
  note: string
}

/**
 * Below the minimum a selection is a stray double-click, above the maximum it
 * is a paragraph rather than an identifier. Exported so the extension bar
 * (#393) raises on exactly the same passages this one does.
 */
export const SELECTION_MIN_LENGTH = 3
export const SELECTION_MAX_LENGTH = 160

/** Beyond this a passage is described as an exact text match rather than a term. */
const LONG_TEXT_LENGTH = 42

/** Cap on a derived tag name, so a selected sentence cannot become the tag list. */
const TAG_NAME_MAX_LENGTH = 22

/**
 * Whitespace collapsing happens here as well as at the selection site: a
 * caller that hands over raw `Selection.toString()` gets the same answer as
 * one that pre-normalised it, which is what makes this safe to share.
 */
export function normalizeSelection(raw: string): string {
  return (raw || '').replace(/\s+/g, ' ').trim()
}

/** Whether a passage is worth offering an action bar for at all. */
export function isActionableSelection(raw: string): boolean {
  const text = normalizeSelection(raw)
  return text.length >= SELECTION_MIN_LENGTH && text.length <= SELECTION_MAX_LENGTH
}

export function classifySelection(raw: string): ClassifiedSelection {
  // Trailing sentence punctuation is part of the prose, never part of the
  // identifier — a domain selected mid-sentence would otherwise be watched
  // with a full stop on the end and match nothing.
  const text = normalizeSelection(raw).replace(/[.,;:]+$/, '')

  if (/^https?:\/\/\S+$/i.test(text)) {
    // Cut at the first of `/`, `?` or `#` rather than `/` alone: a URL with a
    // query and no path carries the query into the value otherwise, and a
    // tracking parameter is the one URL rather than the host. Userinfo is a
    // credential, so it goes too. The port stays — `host:8443` is a
    // different service, not the same host.
    const authority = text.replace(/^https?:\/\//i, '').split(/[/?#]/)[0]
    return {
      value: authority.slice(authority.lastIndexOf('@') + 1),
      kind: 'domain',
      // A Selector is a case-insensitive substring test over a capture's
      // extracted text (selectorRepo.selectorMatchesText), never over its URL,
      // so this cannot promise to match every URL on the host.
      note: 'Path stripped — watches for this host anywhere in a page.'
    }
  }
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(text)) return { value: text, kind: 'email', note: '' }
  if (/^(bc1[a-z0-9]{20,}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(text)) {
    return { value: text, kind: 'btc address', note: '' }
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return { value: text, kind: 'ipv4', note: '' }
  if (/^[a-f0-9]{32,64}$/i.test(text)) return { value: text, kind: 'hash', note: '' }
  if (/^@[\w.]{2,}$/.test(text)) return { value: text, kind: 'handle', note: '' }
  if (/^[\w.-]+\.(zip|rar|7z|php|js|html?|png|jpe?g|exe|txt|json)$/i.test(text)) {
    return { value: text, kind: 'filename', note: '' }
  }
  if (/^[\w-]+(\.[\w-]+)+$/.test(text)) return { value: text, kind: 'domain', note: '' }

  return {
    value: text,
    kind: 'text',
    note: text.length > LONG_TEXT_LENGTH ? 'Long string — stored as an exact text match.' : ''
  }
}

/**
 * The tag name a selection becomes (mock `selAsTag`). Slugified because a tag
 * is a label the operator will filter and type by, not a quotation; a
 * selection that slugifies to nothing falls back to `tagged` rather than
 * creating a nameless tag — `tags.name` is NOT NULL.
 */
export function selectionToTagName(raw: string): string {
  const { value } = classifySelection(raw)
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TAG_NAME_MAX_LENGTH)
    // A slice can land on the hyphen the slug was joined with.
    .replace(/-+$/, '')
  return slug || 'tagged'
}
