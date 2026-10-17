import * as cheerio from 'cheerio'
import type { CaptureLinks } from '@shared/types'
import { HEADER_FIELDS } from '@shared/searchFields'
import {
  EXTRACTION_RULES,
  type ExtractedDatum,
  type ExtractionRule
} from '@main/services/dataExtractor'
import { extractIocs } from '@main/services/extraction/iocAdapter'
import { isValidEmail } from '@main/services/extraction/validators'
import {
  CAPTURE_LINK_BUDGETS,
  documentBase,
  readHtmlParts,
  resolveUrl,
  type CaptureLinkBudgets,
  type HtmlPartInput,
  type HtmlPartsRead
} from '@main/services/htmlParts'

// The Case search fields Extracted Text leaves out. `fields/1` (docs/plans/2026-10-09-
// case-retrieval-first-slice.md, D3 and D4) records link targets and image link alt text
// from the stored page, and identity-bearing mail headers from the Extracted Text file.
// `fields/2` (docs/plans/2026-10-10-case-investigation-engine.md, E11) adds four headers,
// image addresses, tracking codes and cryptocurrency addresses from the stored page, and
// email and web addresses from the Extracted Text. Pure: the caller reads the files, and
// nothing here touches the database.
//
// Every field keeps the span it came from, so a hit can be opened and checked against
// the stored bytes. `value` is that span exactly as stored; `norm` is the search form.
// Offsets are UTF-16 code units: into the decoded part for an `html-part` field, and
// into the `.txt` file read as UTF-8 for a `text` field, the coordinate a Note text
// anchor uses.

/** Stored on each build row. A change to what is extracted, or how, takes a new version. */
export const FIELD_EXTRACTOR_VERSION = 'fields/2'

// A run of header lines is a header block only when one of these names is in it, so
// a few `Label: value` lines in ordinary page text are not read as mail headers.
const BLOCK_MARKERS = new Set(['from', 'reply-to', 'sender', 'message-id', 'path', 'received'])
const ADDRESS_HEADERS = new Set(['from', 'reply-to', 'sender', 'return-path', 'to', 'cc'])
const RECORDED_HEADERS = new Set(HEADER_FIELDS.map((name) => name.toLowerCase()))

// The rules extractData() runs for tracking codes, imported so both find the same codes;
// dataExtractor.ts itself is left as it is (E11).
const TRACKING_RULES = EXTRACTION_RULES.filter((rule) => rule.category === 'Tracking Code')

export interface ExtractedField {
  field: string
  value: string
  norm: string
  source: 'html-part' | 'text'
  /** The text/html part in file order; 0 for a legacy `.html` Capture's file; null for text. */
  part: number | null
  startOffset: number
  endOffset: number
}

export interface FieldSources {
  captureUrl: string
  /** The stored MHTML, or null when the Capture has none. */
  mhtml: Buffer | null
  /** A legacy `.html` Capture's one document, read only when there is no MHTML. */
  html: Buffer | null
  /** The Extracted Text file, read as UTF-8. */
  text: string | null
}

export interface FieldExtraction {
  fields: ExtractedField[]
  skippedParts: CaptureLinks['skippedParts']
  mainDocumentSkipped: boolean
  /** The row ceiling was reached, and fields past it were not extracted. */
  truncated: boolean
}

export function extractFields(
  sources: FieldSources,
  budgets: CaptureLinkBudgets = CAPTURE_LINK_BUDGETS
): FieldExtraction {
  const { parts, skippedParts, mainDocumentSkipped } = htmlInputs(sources, budgets)
  const fields: ExtractedField[] = []
  let truncated = false
  // False at the first field past the ceiling, which stops reading, as the Links tab does.
  const add = (field: ExtractedField): boolean => {
    if (fields.length >= budgets.maxRows) {
      truncated = true
      return false
    }
    fields.push(field)
    return true
  }
  // Every source below is lazy, so reading stops at the ceiling instead of building
  // records that would be dropped.
  const addAll = (found: Iterable<ExtractedField>): void => {
    for (const field of found) if (!add(field)) return
  }
  // Headers come first, in block order, the four `fields/2` adds among them; then the
  // links; then the kinds `fields/2` adds from the page and the text. A Capture that
  // reaches the row ceiling loses those later kinds first, and keeps its `fields/1`
  // records unless its headers alone reach the ceiling.
  if (sources.text !== null) addAll(headerFields(sources.text))
  const images: ExtractedField[][] = []
  let held = 0
  for (const part of parts) {
    if (truncated) break
    // One past the room left after the part's links, so a dropped image still marks
    // the extraction truncated.
    const found = addLinkFields(
      part,
      add,
      () => Math.max(budgets.maxRows - fields.length - held, 0) + 1
    )
    held += found.length
    images.push(found)
  }
  for (const [index, part] of parts.entries()) {
    if (truncated) break
    addAll(images[index] ?? [])
    if (!truncated) addAll(partIdentifiers(part))
  }
  if (!truncated && sources.text !== null) addAll(textIdentifiers(sources.text))
  return { fields, skippedParts, mainDocumentSkipped, truncated }
}

function htmlInputs(
  { captureUrl, mhtml, html }: FieldSources,
  budgets: CaptureLinkBudgets
): HtmlPartsRead {
  if (mhtml) return readHtmlParts(mhtml, captureUrl, budgets)
  const skippedParts = { tooLarge: 0, overPartCount: 0, overTotalSize: 0 }
  if (html === null) return { parts: [], skippedParts, mainDocumentSkipped: false }
  // Checked before decoding, as an MHTML part's encoded size is.
  const size = html.byteLength
  if (budgets.maxParts < 1 || size > budgets.maxPartBytes || size > budgets.maxTotalBytes) {
    return { parts: [], skippedParts, mainDocumentSkipped: true }
  }
  return {
    parts: [{ html: html.toString('utf8'), documentUrl: captureUrl, frame: 'main', part: 0 }],
    skippedParts,
    mainDocumentSkipped: false
  }
}

interface Span {
  start: number
  end: number
}

// parse5 records each attribute's span from its name to the end of its value;
// domhandler's types leave the `attrs` map out.
interface ParsedLocation {
  attrs?: Record<string, { startOffset: number; endOffset: number }>
}

// The span of an attribute's value inside the attribute, quotes excluded. An
// attribute written with no value has an empty span at its end. With no location
// the field could not be checked, so that is an error, not a field left out.
function attributeValueSpan(html: string, element: unknown, name: string): Span {
  const location = (element as { sourceCodeLocation?: ParsedLocation | null }).sourceCodeLocation
  const attr = location?.attrs?.[name]
  if (!attr) throw new Error(`The HTML parser gave no location for a ${name} attribute`)
  const raw = html.slice(attr.startOffset, attr.endOffset)
  const equals = raw.indexOf('=', name.length)
  if (equals === -1) return { start: attr.endOffset, end: attr.endOffset }
  let at = equals + 1
  while (at < raw.length && /[\t\n\f\r ]/.test(raw[at])) at += 1
  const quote = raw[at]
  if ((quote === '"' || quote === "'") && raw.length - 1 > at && raw.endsWith(quote)) {
    return { start: attr.startOffset + at + 1, end: attr.endOffset - 1 }
  }
  return { start: attr.startOffset + at, end: attr.endOffset }
}

// One field per occurrence, since each has its own span. Anchor text is not
// recorded: Extracted Text already holds it. Returns as many of the part's image
// addresses as `imageRoom()` allows once the links are in, read from the same parse and
// recorded after every part's links; none once the ceiling stopped the links.
function addLinkFields(
  { html, documentUrl, part }: HtmlPartInput,
  add: (field: ExtractedField) => boolean,
  imageRoom: () => number
): ExtractedField[] {
  const $ = cheerio.load(html, { sourceCodeLocationInfo: true })
  const base = documentBase($, documentUrl)
  const at = (field: string, element: unknown, attr: string, norm: string): ExtractedField => {
    const span = attributeValueSpan(html, element, attr)
    return {
      field,
      value: html.slice(span.start, span.end),
      norm,
      source: 'html-part',
      part,
      startOffset: span.start,
      endOffset: span.end
    }
  }
  let stopped = false
  $('a[href], area[href]').each((_, element) => {
    const node = $(element)
    const href = (node.attr('href') ?? '').trim()
    if (!add(at('link.href', element, 'href', resolveUrl(href, base) ?? href))) {
      stopped = true
      return false
    }
    const images = node.is('area') ? [element] : node.find('img[alt]').toArray()
    for (const image of images) {
      const alt = ($(image).attr('alt') ?? '').replace(/\s+/g, ' ').trim()
      if (alt && !add(at('link.alt', image, 'alt', alt))) {
        stopped = true
        return false
      }
    }
  })
  const images: ExtractedField[] = []
  if (stopped) return images
  const room = imageRoom()
  for (const image of $('img[src]').toArray()) {
    if (images.length >= room) break
    const src = ($(image).attr('src') ?? '').trim()
    // A `data:` source carries the image itself, with no host or target to record.
    if (src && !/^data:/i.test(src)) {
      images.push(at('image.src', image, 'src', resolveUrl(src, base) ?? src))
    }
  }
  return images
}

// Each scan below takes time in proportion to its input and yields as it goes, so the
// row ceiling stops it within a few records of the last one kept. The one read of a
// whole input is extractIocs(), once for each part and once for the text.

const code = (text: string, at: number): number => text.charCodeAt(at)
const isDigit = (c: number): boolean => c >= 48 && c <= 57
const isLetter = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
const isLabelChar = (c: number): boolean => isDigit(c) || isLetter(c) || c === 45 // -
// Letters, digits, `_` and `-`: a run of them is one token, and a value found inside a
// longer run is not that value.
const isTokenChar = (c: number): boolean => isLabelChar(c) || c === 95 // _
const LOCAL_PART_SIGNS = new Set(['.', '_', '%', '+', '-'])
const isLocalChar = (c: number): boolean =>
  isDigit(c) || isLetter(c) || LOCAL_PART_SIGNS.has(String.fromCharCode(c))

// Every address-shaped run in the text, whole: from each `@`, the local part as far left
// as it goes (never past the previous `@`), and the domain as far right as its labels
// go, without a trailing `.` or `-`. A shorter address is never cut from a longer one,
// so `bob@harrow.example.net` is not found inside `bob@harrow.example.net.au`.
function* addressSpans(text: string): Generator<Span> {
  let floor = 0
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    let start = at
    while (start > floor && isLocalChar(code(text, start - 1))) start -= 1
    let end = at + 1
    while (end < text.length && (isLabelChar(code(text, end)) || text[end] === '.')) end += 1
    while (end > at + 1 && (text[end - 1] === '.' || text[end - 1] === '-')) end -= 1
    floor = at + 1
    if (start < at && end > at + 1) yield { start, end }
  }
}

// Every place one of `values` stands as a whole token, or as the end of one after a `-`
// or `_`, such as the `pub-...` in `ca-pub-...`. extractIocs() returns values without
// places, so they are found again here, each run of token characters checked once,
// longest form first. A value it rewrote while refanging is not in the text as returned
// and has no place.
function* tokenSpans(text: string, values: ReadonlySet<string>): Generator<Span> {
  if (values.size === 0) return
  const lengths = [...values].map((value) => value.length)
  const shortest = Math.min(...lengths)
  const longest = Math.max(...lengths)
  let start = 0
  while (start < text.length) {
    if (!isTokenChar(code(text, start))) {
      start += 1
      continue
    }
    let end = start
    while (end < text.length && isTokenChar(code(text, end))) end += 1
    for (let at = Math.max(start, end - longest); at <= end - shortest; at += 1) {
      const whole = at === start
      if (
        (whole || text[at - 1] === '-' || text[at - 1] === '_') &&
        values.has(text.slice(at, end))
      ) {
        yield { start: at, end }
        break
      }
    }
    start = end
  }
}

// Where a rule's normalized value sits in its match. A value cut from a quoted string,
// as the Facebook Pixel rule's digits are, is taken from inside its quotes.
function valueOffset(match: string, value: string): number {
  for (const quote of ['"', "'"]) {
    const at = match.indexOf(`${quote}${value}${quote}`)
    if (at !== -1) return at + 1
  }
  return match.indexOf(value)
}

// The longest match a rule may make here. The Facebook Pixel rule's `[^)]*?` would
// otherwise read on to the next `)` from every `fbq` in the part. A call such as
// `fbq('init', '204871365920471')` ends at its 30th character.
const RULE_WINDOW = 128

// The matches extractData()'s rule finds, up to RULE_WINDOW long, read with a sticky
// copy of its pattern at each place a match can start: where the pattern's leading
// literal (`GTM-`, `fbq`) is written. The shared pattern, whose `lastIndex` runRules()
// resets before each use, is never run here. As with a global pattern, a match resumes
// the search at its end.
function* ruleSpans(
  text: string,
  pattern: RegExp,
  normalize: ExtractionRule['normalize']
): Generator<Span> {
  const lead = /^[A-Za-z0-9-]*/.exec(pattern.source)?.[0] ?? ''
  const sticky = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}y`)
  let from = 0
  for (let at = text.indexOf(lead); at !== -1 && at < text.length; at = text.indexOf(lead, from)) {
    from = at + 1
    sticky.lastIndex = 0
    const match = sticky.exec(text.slice(at, at + RULE_WINDOW))
    if (!match) continue
    from = at + Math.max(match[0].length, 1)
    const [raw] = match
    const value = (normalize ? normalize(raw) : raw)?.trim()
    const offset = value ? valueOffset(raw, value) : -1
    if (value && offset !== -1) {
      yield { start: at + offset, end: at + offset + value.length }
    }
  }
}

// Several position-ordered span streams as one, in order, each distinct span once.
function* mergeSpans(streams: Iterable<Span>[]): Generator<Span> {
  const iterators = streams.map((stream) => stream[Symbol.iterator]())
  const next = (index: number): Span | undefined => {
    const result = iterators[index].next()
    return result.done ? undefined : result.value
  }
  const heads = iterators.map((_, index) => next(index))
  let last: Span | undefined
  for (;;) {
    let first = -1
    heads.forEach((head, index) => {
      if (!head) return
      const best = heads[first]
      const order = best ? head.start - best.start || head.end - best.end : -1
      if (order < 0) first = index
    })
    const span = heads[first]
    if (!span) return
    heads[first] = next(first)
    if (last?.start === span.start && last.end === span.end) continue
    last = span
    yield span
  }
}

function valuesOf(iocs: ExtractedDatum[], keep: (datum: ExtractedDatum) => boolean): Set<string> {
  return new Set(iocs.filter(keep).map(({ value }) => value))
}

// Tracking codes and cryptocurrency addresses anywhere in the decoded part, scripts
// included. extractIocs() reads the whole part once, when this kind's turn comes.
function* partIdentifiers({ html, part }: HtmlPartInput): Generator<ExtractedField> {
  const record = (field: string, { start, end }: Span): ExtractedField => {
    const value = html.slice(start, end)
    return {
      field,
      value,
      norm: value,
      source: 'html-part',
      part,
      startOffset: start,
      endOffset: end
    }
  }
  const iocs = extractIocs(html)
  const tracking = mergeSpans([
    ...TRACKING_RULES.flatMap(({ patterns, normalize }) =>
      patterns.map((pattern) => ruleSpans(html, pattern, normalize))
    ),
    tokenSpans(
      html,
      valuesOf(iocs, ({ category }) => category === 'Tracking Code')
    )
  ])
  for (const span of tracking) yield record('id.tracking', span)
  const wallets = valuesOf(iocs, ({ category }) => category === 'Cryptocurrency')
  for (const span of tokenSpans(html, wallets)) yield record('id.crypto', span)
}

// A web address in page text runs to the next space, quote or angle bracket. The
// punctuation that ends a sentence is left off, and a closing bracket the address
// did not open.
const WEB_ADDRESS = /\bhttps?:\/\/[^\s<>"'`]+/gi
const SENTENCE_END = new Set(['.', ',', ';', ':', '!', '?'])
const OPENS = new Map([
  [')', '('],
  [']', '['],
  ['}', '{']
])

// One count of the brackets, then one walk back from the end.
function webAddressLength(found: string): number {
  const counts = new Map<string, number>()
  for (const char of found) {
    if (OPENS.has(char) || '([{'.includes(char)) counts.set(char, (counts.get(char) ?? 0) + 1)
  }
  let end = found.length
  while (end > 0) {
    const last = found[end - 1]
    const opener = OPENS.get(last)
    const unopened = opener !== undefined && (counts.get(opener) ?? 0) < (counts.get(last) ?? 0)
    if (!SENTENCE_END.has(last) && !unopened) break
    if (unopened) counts.set(last, (counts.get(last) ?? 0) - 1)
    end -= 1
  }
  return end
}

function* webAddressSpans(text: string): Generator<Span> {
  for (const match of text.matchAll(WEB_ADDRESS)) {
    const length = webAddressLength(match[0])
    // Something past the scheme, or there is no address.
    if (length > match[0].indexOf('//') + 2) {
      yield { start: match.index, end: match.index + length }
    }
  }
}

function* textIdentifiers(text: string): Generator<ExtractedField> {
  const record = (field: string, { start, end }: Span, norm: string): ExtractedField => ({
    field,
    value: text.slice(start, end),
    norm,
    source: 'text',
    part: null,
    startOffset: start,
    endOffset: end
  })
  // The addresses extractData() keeps: those extractIocs() finds that isValidEmail()
  // accepts, checked once each as they are met.
  const addresses = valuesOf(
    extractIocs(text),
    ({ subcategory }) => subcategory === 'Email Address'
  )
  const valid = new Map<string, boolean>()
  for (const span of addressSpans(text)) {
    const value = text.slice(span.start, span.end)
    if (!addresses.has(value)) continue
    if (!valid.has(value)) valid.set(value, isValidEmail(value))
    if (valid.get(value)) yield record('text.address', span, value.toLowerCase())
  }
  // An absolute address resolved against itself is the parser's form of it: scheme and
  // host in lower case, a default port dropped, the fragment kept.
  for (const span of webAddressSpans(text)) {
    const value = text.slice(span.start, span.end)
    yield record('text.url', span, resolveUrl(value, value) ?? value)
  }
}

interface Line {
  text: string
  start: number
}

function* linesOf(text: string): Generator<Line> {
  const breaks = /\r\n|\n|\r/g
  let start = 0
  for (let match = breaks.exec(text); match; match = breaks.exec(text)) {
    yield { text: text.slice(start, match.index), start }
    start = match.index + match[0].length
  }
  yield { text: text.slice(start), start }
}

// A header name is any printable ASCII character but a space or a colon, so a name such
// as `X-Spam_score` does not end its block.
const HEADER_LINE = /^([!-9;-~]+):(?=[ \t]|$)/
const CONTINUATION_LINE = /^[ \t]+\S/

interface HeaderField {
  name: string
  /** The value's span in the text, from the colon to the last non-blank, folds included. */
  start: number
  end: number
}

// Header blocks: two or more consecutive header lines, each with its folded
// continuation lines, holding at least one of BLOCK_MARKERS. Lazy, so the row ceiling
// stops the scan rather than trimming a list built from the whole text.
function* headerBlocks(text: string): Generator<HeaderField[]> {
  let block: HeaderField[] = []
  const isBlock = (): boolean =>
    block.length >= 2 && block.some((field) => BLOCK_MARKERS.has(field.name))
  for (const line of linesOf(text)) {
    const header = HEADER_LINE.exec(line.text)
    if (header) {
      const [label, name] = header
      block.push({
        name: name.toLowerCase(),
        start: line.start + label.length,
        end: line.start + line.text.trimEnd().length
      })
    } else if (block.length > 0 && CONTINUATION_LINE.test(line.text)) {
      block[block.length - 1].end = line.start + line.text.trimEnd().length
    } else {
      if (isBlock()) yield block
      block = []
    }
  }
  if (isBlock()) yield block
}

// The span with its leading and trailing whitespace, line breaks included, left out.
function trimmed(text: string, start: number, end: number): Span {
  const piece = text.slice(start, end)
  return {
    start: start + (piece.length - piece.trimStart().length),
    end: start + piece.trimEnd().length
  }
}

// Splits an address list at the commas outside quotes, angle brackets and comments,
// and returns each mailbox's span, trimmed.
function mailboxSpans(value: string): Span[] {
  const spans: Span[] = []
  let quoted = false
  let angle = 0
  let comment = 0
  let from = 0
  const push = (to: number): void => {
    const span = trimmed(value, from, to)
    if (span.end > span.start) spans.push(span)
  }
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]
    if (char === '\\') i += 1
    else if (char === '"' && comment === 0) quoted = !quoted
    else if (quoted) continue
    else if (char === '(') comment += 1
    else if (char === ')' && comment > 0) comment -= 1
    else if (comment > 0) continue
    else if (char === '<') angle += 1
    else if (char === '>' && angle > 0) angle -= 1
    else if (char === ',' && angle === 0) {
      push(i)
      from = i + 1
    }
  }
  push(value.length)
  return spans
}

// The address in a mailbox, in lower case, without its display name, angle brackets,
// comments or folding whitespace. A quoted local part keeps its spaces and loses only
// its line breaks. A mailbox with no address keeps its text, in lower case with its
// whitespace collapsed.
function addressNorm(mailbox: string): string {
  const bracketed = /<([^<>]*)>[^<>]*$/.exec(mailbox)
  const address = bracketed ? bracketed[1] : mailbox.replace(/\([^()]*\)/g, '')
  if (!bracketed && !address.includes('@')) return mailbox.replace(/\s+/g, ' ').toLowerCase()
  return address
    .replace(/("(?:[^"\\]|\\.)*")|\s+/g, (_, quoted?: string) =>
      quoted ? quoted.replace(/\r\n|\n|\r/g, '') : ''
    )
    .toLowerCase()
}

// Each message identifier in a References value, so each compares with a Message-ID
// on its own.
function identifierSpans(value: string): Span[] {
  return [...value.matchAll(/<[^<>]*>/g)]
    .filter(([identifier]) => identifier.length > 2)
    .map((match) => ({ start: match.index, end: match.index + match[0].length }))
}

// A Usenet Path lists the sites an article passed through, then a tail entry that names
// none, by convention `not-for-mail` (RFC 5536, section 3.1.5). Each site is a record.
// An empty entry, as `!!` leaves, gives none, and a diagnostic entry such as
// `.POSTED.host` gives the site after its keyword, if it names one.
function pathSpans(value: string): Span[] {
  const entries: Span[] = []
  let from = 0
  for (let at = value.indexOf('!'); at !== -1; at = value.indexOf('!', from)) {
    entries.push({ start: from, end: at })
    from = at + 1
  }
  const spans: Span[] = []
  for (const entry of entries) {
    const { start, end } = trimmed(value, entry.start, entry.end)
    const diagnostic = /^\.[A-Za-z]+\.?/.exec(value.slice(start, end))
    const site = start + (diagnostic ? diagnostic[0].length : 0)
    if (end > site) spans.push({ start: site, end })
  }
  return spans
}

export function headerFieldsFromText(text: string): ExtractedField[] {
  return [...headerFields(text)]
}

function* headerFields(text: string): Generator<ExtractedField> {
  const fieldAt = (name: string, start: number, end: number, norm: string): ExtractedField => ({
    field: `header.${name}`,
    value: text.slice(start, end),
    norm,
    source: 'text',
    part: null,
    startOffset: start,
    endOffset: end
  })
  for (const block of headerBlocks(text)) {
    for (const field of block) {
      if (!RECORDED_HEADERS.has(field.name)) continue
      const { start, end } = trimmed(text, field.start, field.end)
      if (end <= start) continue
      const value = text.slice(start, end)
      if (ADDRESS_HEADERS.has(field.name)) {
        for (const span of mailboxSpans(value)) {
          const norm = addressNorm(value.slice(span.start, span.end))
          if (norm) yield fieldAt(field.name, start + span.start, start + span.end, norm)
        }
      } else if (field.name === 'references' || field.name === 'path') {
        const spans = field.name === 'path' ? pathSpans(value) : identifierSpans(value)
        for (const span of spans) {
          const item = value.slice(span.start, span.end)
          const norm = field.name === 'path' ? item.toLowerCase() : item.replace(/\s+/g, ' ')
          yield fieldAt(field.name, start + span.start, start + span.end, norm)
        }
      } else {
        yield fieldAt(field.name, start, end, value.replace(/\s+/g, ' '))
      }
    }
  }
}
