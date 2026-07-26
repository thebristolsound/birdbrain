/**
 * Note anchors: what a note points at, and how a text anchor is located again.
 *
 * The matching here is pure — it takes the stored text as a string and returns
 * where the passage sits in it. Reading that text off disk, and deciding
 * whether the bytes can be trusted at all, is the main process's job. Keeping
 * the two apart is what lets the resolution ladder be tested exhaustively
 * without a filesystem, which is where its edge cases actually live.
 */

export type NoteAnchorKind = 'capture' | 'region' | 'text' | 'finding'

/** The whole capture. The honest fallback when nothing finer can be pointed at. */
export interface CaptureAnchor {
  kind: 'capture'
  captureId: string
}

/**
 * A rectangle on the capture's screenshot, in the image's own pixel space.
 *
 * `imageWidth` / `imageHeight` travel with the rectangle because the numbers
 * are meaningless without them — the same coordinates against a differently
 * sized rendering point at a different part of the page. This is the coordinate
 * space `CaptureAnnotations` already uses, so a note region and an annotation
 * shape mean the same thing geometrically.
 */
export interface RegionAnchor {
  kind: 'region'
  captureId: string
  x: number
  y: number
  w: number
  h: number
  imageWidth: number
  imageHeight: number
}

/**
 * A selector match or an extracted datum.
 *
 * Extracted data is addressed by its natural key, never by `extracted_data.id`:
 * re-extraction deletes every row for a capture and re-inserts, so each
 * surrogate id churns while `(capture_id, category, subcategory, value)` — the
 * tuple `idx_extracted_data_unique` enforces — survives unchanged. Selector
 * matches already have a composite primary key and need no surrogate.
 */
export type FindingAnchor =
  | {
      kind: 'finding'
      finding: 'extractedData'
      captureId: string
      category: string
      subcategory: string
      value: string
    }
  | {
      kind: 'finding'
      finding: 'selectorMatch'
      captureId: string
      selectorId: string
    }

/** A passage in a capture's stored text, with the context needed to find it again. */
export interface TextAnchor {
  kind: 'text'
  captureId: string
  /** The passage as recorded. Rendered verbatim even when it cannot be located. */
  quote: string
  prefix: string
  suffix: string
  /** Where the quote sat when the note was written. A hint, not a guarantee. */
  textOffset: number
}

export type NoteAnchor = CaptureAnchor | RegionAnchor | TextAnchor | FindingAnchor

function str(raw: Record<string, unknown>, field: string): string {
  const value = raw[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Note anchor is missing ${field}`)
  }
  return value
}

function num(raw: Record<string, unknown>, field: string): number {
  const value = raw[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Note anchor is missing ${field}`)
  }
  return value
}

/** A pixel extent. Zero is not a rectangle and a negative one is not a shape. */
function positive(raw: Record<string, unknown>, field: string): number {
  const value = num(raw, field)
  if (value <= 0) throw new Error(`Note anchor has a non-positive ${field}`)
  return value
}

/** A pixel coordinate. May sit on the edge, never off it. */
function nonNegative(raw: Record<string, unknown>, field: string): number {
  const value = num(raw, field)
  if (value < 0) throw new Error(`Note anchor has a negative ${field}`)
  return value
}

/**
 * A string index, which is what `textOffset` is used as.
 *
 * A fractional offset is not merely odd: `String.prototype.startsWith` coerces
 * the position it is given, so 1.5 would match at index 1 and then be reported
 * back as 1.5 — an offset naming a position the quote was not found at.
 */
function index(raw: Record<string, unknown>, field: string): number {
  const value = num(raw, field)
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Note anchor has a non-integer or negative ${field}`)
  }
  return value
}

/**
 * Parse and validate an anchor arriving from the renderer or an archive.
 *
 * Every field is copied out by name rather than the input being spread, so an
 * anchor can only ever hold what this function names. That is what keeps an
 * `extracted_data.id` out of storage even when a caller sends one: there is no
 * path by which an unlisted field reaches the database.
 *
 * Throws rather than coercing, for the same reason `parseNoteDoc` does — an
 * anchor is what a report will later cite, and a silently repaired one would
 * cite something nobody chose.
 */
export function parseNoteAnchor(json: string): NoteAnchor {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Note anchor is not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Note anchor is not an object')
  }
  const raw = parsed as Record<string, unknown>
  const captureId = str(raw, 'captureId')

  switch (raw.kind) {
    case 'capture':
      return { kind: 'capture', captureId }
    case 'region': {
      // The rectangle must be a rectangle, and it must fit the image it
      // declares. A region reaching outside its own coordinate space cannot be
      // normalised against the screenshot, so it would render as a crop of
      // somewhere the investigator never selected.
      const imageWidth = positive(raw, 'imageWidth')
      const imageHeight = positive(raw, 'imageHeight')
      const x = nonNegative(raw, 'x')
      const y = nonNegative(raw, 'y')
      const w = positive(raw, 'w')
      const h = positive(raw, 'h')
      if (x + w > imageWidth || y + h > imageHeight) {
        throw new Error('Note anchor region falls outside the image it declares')
      }
      return { kind: 'region', captureId, x, y, w, h, imageWidth, imageHeight }
    }
    case 'text':
      return {
        kind: 'text',
        captureId,
        quote: str(raw, 'quote'),
        // Context may legitimately be empty at the start or end of a document.
        prefix: typeof raw.prefix === 'string' ? raw.prefix : '',
        suffix: typeof raw.suffix === 'string' ? raw.suffix : '',
        textOffset: index(raw, 'textOffset')
      }
    case 'finding':
      if (raw.finding === 'selectorMatch') {
        return {
          kind: 'finding',
          finding: 'selectorMatch',
          captureId,
          selectorId: str(raw, 'selectorId')
        }
      }
      if (raw.finding === 'extractedData') {
        return {
          kind: 'finding',
          finding: 'extractedData',
          captureId,
          category: str(raw, 'category'),
          subcategory: str(raw, 'subcategory'),
          value: str(raw, 'value')
        }
      }
      throw new Error(`Unknown finding anchor target: ${String(raw.finding)}`)
    default:
      throw new Error(`Unknown note anchor kind: ${String(raw.kind)}`)
  }
}

/**
 * Rewrite the row ids an anchor embeds, for the archive import's collision remap.
 *
 * An imported note's `capture_id` column is remapped, so the anchor's own
 * `captureId` must move with it. Leaving it behind is worse than a dangling
 * reference: when the old id already exists in the destination installation,
 * the anchor silently resolves against *that* capture, and the note cites
 * evidence it was never written about.
 *
 * The switch is exhaustive on purpose. A future anchor kind carrying an id
 * fails to compile here rather than importing subtly wrong.
 *
 * Spreading is safe here and not in `parseNoteAnchor` because the input is
 * already a validated `NoteAnchor` — there is no unlisted field to carry over.
 */
export function remapAnchorIds(anchor: NoteAnchor, mapId: (id: string) => string): NoteAnchor {
  const captureId = mapId(anchor.captureId)
  switch (anchor.kind) {
    case 'capture':
    case 'region':
    case 'text':
      return { ...anchor, captureId }
    case 'finding':
      return anchor.finding === 'selectorMatch'
        ? { ...anchor, captureId, selectorId: mapId(anchor.selectorId) }
        : { ...anchor, captureId }
  }
}

/**
 * Where a text anchor landed, and which rung of the ladder found it.
 *
 * `via` is kept rather than reduced to a boolean because the rungs do not mean
 * the same thing: an offset hit says the text is unchanged, while a context hit
 * says the passage moved and was re-identified by its surroundings. A reader
 * deciding how much weight to put on a citation wants to know which happened.
 */
export type TextAnchorMatch =
  | { status: 'resolved'; via: 'offset' | 'quote' | 'context'; offset: number }
  | { status: 'unresolved' }

/**
 * Locate a text anchor in the capture's stored text.
 *
 * The ladder is ordered so the strongest evidence wins: the stored offset is
 * tried before any search, so text that has not changed resolves to exactly
 * where the note was written rather than to some other identical passage.
 *
 * Ambiguity is never broken by picking the first candidate. A quote that
 * appears twice with no distinguishing context is unresolved, because guessing
 * between them would produce a citation that looks located but points at a
 * passage the investigator may never have read.
 */
export function matchTextAnchor(text: string, anchor: TextAnchor): TextAnchorMatch {
  const { quote, prefix, suffix, textOffset } = anchor
  if (!quote) return { status: 'unresolved' }

  if (textOffset >= 0 && text.startsWith(quote, textOffset)) {
    return { status: 'resolved', via: 'offset', offset: textOffset }
  }

  const first = text.indexOf(quote)
  if (first !== -1 && text.indexOf(quote, first + 1) === -1) {
    return { status: 'resolved', via: 'quote', offset: first }
  }

  const context = prefix + quote + suffix
  const contextFirst = text.indexOf(context)
  if (contextFirst !== -1 && text.indexOf(context, contextFirst + 1) === -1) {
    return { status: 'resolved', via: 'context', offset: contextFirst + prefix.length }
  }

  return { status: 'unresolved' }
}
