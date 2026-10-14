import * as cheerio from 'cheerio'
import type { CaptureLinks } from '@shared/types'
import { HEADER_FIELDS } from '@shared/searchFields'
import {
  CAPTURE_LINK_BUDGETS,
  documentBase,
  readHtmlParts,
  resolveUrl,
  type CaptureLinkBudgets,
  type HtmlPartInput,
  type HtmlPartsRead
} from '@main/services/htmlParts'

// The Case search fields Extracted Text leaves out (docs/plans/2026-10-09-case-
// retrieval-first-slice.md, D3 and D4): link targets and image link alt text from the
// stored page, and identity-bearing mail headers from the Extracted Text file. Pure:
// the caller reads the files, and nothing here touches the database.
//
// Every field keeps the span it came from, so a hit can be opened and checked against
// the stored bytes. `value` is that span exactly as stored; `norm` is the search form.
// Offsets are UTF-16 code units: into the decoded part for an `html-part` field, and
// into the `.txt` file read as UTF-8 for a `text` field, the coordinate a Note text
// anchor uses.

/** Stored on each build row. A change to what is extracted, or how, takes a new version. */
export const FIELD_EXTRACTOR_VERSION = 'fields/1'

// A run of header lines is a header block only when one of these names is in it, so
// a few `Label: value` lines in ordinary page text are not read as mail headers.
const BLOCK_MARKERS = new Set(['from', 'reply-to', 'sender', 'message-id', 'path', 'received'])
const ADDRESS_HEADERS = new Set(['from', 'reply-to', 'sender', 'return-path'])
const RECORDED_HEADERS = new Set(HEADER_FIELDS.map((name) => name.toLowerCase()))

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
  for (const field of sources.text === null ? [] : headerFields(sources.text)) {
    if (!add(field)) break
  }
  for (const part of parts) {
    if (truncated) break
    addLinkFields(part, add)
  }
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
// recorded: Extracted Text already holds it.
function addLinkFields(
  { html, documentUrl, part }: HtmlPartInput,
  add: (field: ExtractedField) => boolean
): void {
  const $ = cheerio.load(html, { sourceCodeLocationInfo: true })
  const base = documentBase($, documentUrl)
  const record = (field: string, element: unknown, attr: string, norm: string): boolean => {
    const span = attributeValueSpan(html, element, attr)
    return add({
      field,
      value: html.slice(span.start, span.end),
      norm,
      source: 'html-part',
      part,
      startOffset: span.start,
      endOffset: span.end
    })
  }
  $('a[href], area[href]').each((_, element) => {
    const node = $(element)
    const href = (node.attr('href') ?? '').trim()
    if (!record('link.href', element, 'href', resolveUrl(href, base) ?? href)) return false
    const images = node.is('area') ? [element] : node.find('img[alt]').toArray()
    for (const image of images) {
      const alt = ($(image).attr('alt') ?? '').replace(/\s+/g, ' ').trim()
      if (alt && !record('link.alt', image, 'alt', alt)) return false
    }
  })
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

const HEADER_LINE = /^([A-Za-z][A-Za-z0-9-]*):(?=[ \t]|$)/
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
      } else {
        yield fieldAt(field.name, start, end, value.replace(/\s+/g, ' '))
      }
    }
  }
}
