/**
 * Pure Mention presentation logic — no React, no DOM, no editor state.
 *
 * The chip, the autocomplete popup and the masked list-row snippet all read
 * from here so the three surfaces cannot drift: a rename that changes what a
 * chip says has to change what the snippet says by construction.
 *
 * The sigil map is re-exported from `@shared/noteDoc` rather than declared
 * again here. Main derives indexed and exported note text from that module, so
 * a second copy is a second answer to "what prefix does a selector read with".
 *
 * The design source splits them `@` = captures + notes, `#` = selectors +
 * tags, which is not the split the issue body describes. The mock states it
 * four independent times (the placeholder, both footers and the popup's own
 * scope label) and is the later artefact, so it wins.
 */
import { MENTION_SIGIL, MENTION_SIGILS, type MentionSigil } from '@shared/noteDoc'
import { classifySelection } from '@shared/selectionKind'
import type { MentionTargetType } from '@shared/noteDoc'
import type { Capture, Note, Selector, Tag } from '@shared/types'

export { MENTION_SIGIL, MENTION_SIGILS, type MentionSigil }

/**
 * Guard for an attribute read off a node.
 *
 * A Mention pasted as HTML from outside the app arrives with whatever the
 * markup carried, which may be nothing at all — the chip has to render that
 * legibly rather than throw inside the editor.
 *
 * `Object.hasOwn`, never `in`. `in` walks the prototype chain, so eight
 * `Object.prototype` names — `constructor`, `__proto__`, `toString`,
 * `valueOf`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`,
 * `toLocaleString` — passed this guard. A pasted
 * `data-target-type="constructor"` then indexed every per-kind record here to
 * a function rather than to a value, `resolveMention` fell off its switch and
 * returned undefined, and reading `.status` off that threw inside the node
 * view: the error boundary unmounted the route body and the draft went with
 * it. That is the "note cannot be saved" failure this work exists to remove.
 */
export function isMentionTargetType(value: unknown): value is MentionTargetType {
  return typeof value === 'string' && Object.hasOwn(MENTION_SIGIL, value)
}

/** The kinds a sigil offers, primary kind first. */
export const MENTION_KINDS: Record<MentionSigil, readonly MentionTargetType[]> = {
  '@': ['capture', 'note'],
  '#': ['selector', 'tag']
}

/** The popup header's right-hand hint. */
export const MENTION_SCOPE_LABEL: Record<MentionSigil, string> = {
  '@': 'captures · notes',
  '#': 'selectors · tags'
}

/** Longest label a chip or a snippet shows before it is elided. */
export const MAX_MENTION_LABEL = 30

/** Rows the popup will show at once, however many candidates matched. */
export const MAX_MENTION_ROWS = 6

// Entity colours. Capture, note and selector map onto palette tokens; a tag
// carries its own colour and falls back to the design's pink. Every value is a
// token reference rather than a hex so the chip honours the house rule on raw
// colour values — see the --color-violet-500 / --color-pink-500 additions in
// globals.css.
const CAPTURE_COLOR = 'var(--color-amber-500)'
const NOTE_COLOR = 'var(--color-accent)'
const SELECTOR_COLOR = 'var(--color-violet-500)'
const TAG_FALLBACK_COLOR = 'var(--color-pink-500)'

/**
 * A Mention whose target no longer exists.
 *
 * The design does not draw this state — see the PR — so it is derived: the
 * destructive foreground token, and the chip keeps its geometry so deleting a
 * target cannot reflow the paragraph around it.
 */
export const MENTION_BROKEN_COLOR = 'var(--color-danger-fg)'

export function mentionColor(targetType: MentionTargetType, tagColor?: string | null): string {
  switch (targetType) {
    case 'capture':
      return CAPTURE_COLOR
    case 'note':
      return NOTE_COLOR
    case 'selector':
      return SELECTOR_COLOR
    case 'tag':
      return tagColor || TAG_FALLBACK_COLOR
    // Reachable only from a kind the type system never sanctioned — a pasted
    // attribute. It has no entity colour because it is not an entity, and the
    // chip that carries it is broken.
    default:
      return MENTION_BROKEN_COLOR
  }
}

export function truncateMentionLabel(label: string): string {
  if (label.length <= MAX_MENTION_LABEL) return label
  return `${label.slice(0, MAX_MENTION_LABEL - 1)}…`
}

/**
 * How a Mention reads as plain text: sigil plus label. Never the stored node,
 * and never a bracketed token the app does not produce.
 *
 * This is what the clipboard gets, untruncated — eliding exists so a chip
 * cannot blow out a line of prose, which is meaningless once the text has left
 * the app.
 */
export function mentionPlainText(targetType: MentionTargetType, label: string): string {
  // A kind outside the model has no trigger key, so it contributes nothing
  // rather than whatever the prototype chain would have handed back.
  const sigil = Object.hasOwn(MENTION_SIGIL, targetType) ? MENTION_SIGIL[targetType] : ''
  return sigil + label
}

/** The same, elided, for the chip and for note list-row snippets. */
export function maskMention(targetType: MentionTargetType, label: string): string {
  return mentionPlainText(targetType, truncateMentionLabel(label))
}

const CLICK_HINT: Record<MentionTargetType, string> = {
  capture: 'click to open',
  note: 'click to open',
  selector: 'click to open',
  tag: 'click to open'
}

/** The chip's title attribute. Broken targets say so instead of inviting a click. */
export function mentionTooltip(
  targetType: MentionTargetType,
  label: string,
  broken = false
): string {
  // A kind with no hint is a kind with no screen behind it, which reads to the
  // operator exactly as a deleted target does: nothing will happen on click.
  const known = !broken && Object.hasOwn(CLICK_HINT, targetType)
  const hint = known ? CLICK_HINT[targetType] : 'target deleted'
  return `${targetType} · ${label} — ${hint}`
}

/**
 * Where a chip click goes.
 *
 * One function on purpose. #400 replaced the Selectors and Tags screens with a
 * single Signals screen, so both of those kinds land there.
 *
 * The route alone does not open the right row. Signals falls back to
 * `allSignals[0]` when nothing names a target, so every kind here also needs a
 * selection handed over before the navigate, which is what `mentionSelection`
 * below is for.
 */
export const MENTION_ROUTES = {
  capture: '/cases/$caseId/captures',
  note: '/cases/$caseId/notes',
  selector: '/cases/$caseId/signals',
  tag: '/cases/$caseId/signals'
} as const satisfies Record<MentionTargetType, string>

export type MentionRoute = (typeof MENTION_ROUTES)[MentionTargetType]

export function mentionRoute(targetType: MentionTargetType): MentionRoute {
  // Same discipline as the guard: a kind off a pasted attribute must not index
  // this record through the prototype chain and hand `navigate` a function.
  // `note` is the fallback the chip already substitutes for a Mention whose
  // identity attributes did not survive the paste — see MentionChip.
  if (!Object.hasOwn(MENTION_ROUTES, targetType)) return MENTION_ROUTES.note
  return MENTION_ROUTES[targetType]
}

/**
 * Which selection a chip click has to write before it navigates.
 *
 * Every destination screen opens on whichever row is already selected, so the
 * route on its own lands the operator on the right screen looking at the wrong
 * thing. Captures reads `selectedCaptureId`, Notes reads `selectedNoteId`, and
 * Signals reads `selectedSignalId` and falls back to `allSignals[0]` when that
 * is empty, which is how a chip naming one rule opens another.
 *
 * Kept beside MENTION_ROUTES rather than in the chip so that adding a kind is
 * still an edit to this file alone.
 */
export const MENTION_SELECTIONS = {
  capture: 'capture',
  note: 'note',
  selector: 'signal',
  tag: 'signal'
} as const satisfies Record<MentionTargetType, string>

export type MentionSelection = (typeof MENTION_SELECTIONS)[MentionTargetType]

export function mentionSelection(targetType: MentionTargetType): MentionSelection {
  // Same discipline as mentionRoute: never index this record with a key that
  // could have come off a pasted attribute.
  if (!Object.hasOwn(MENTION_SELECTIONS, targetType)) return MENTION_SELECTIONS.note
  return MENTION_SELECTIONS[targetType]
}

/** One row of the autocomplete popup. */
export interface MentionCandidate {
  targetType: MentionTargetType
  targetId: string
  label: string
  /** Right-aligned hint: the kind, or a selector's live match count. */
  meta: string
  color: string
  /**
   * Set on the row that creates its target rather than naming one that
   * exists. `label` is then the typed query, and `targetId` stays empty until
   * the entity has been written.
   */
  create?: boolean
}

/** Everything the popup ranks over, read from the already-cached list queries. */
export interface MentionSources {
  captures: Pick<Capture, 'id' | 'title' | 'url' | 'exhibitCitation'>[]
  notes: Pick<Note, 'id' | 'title'>[]
  selectors: Pick<Selector, 'id' | 'label' | 'pattern'>[]
  tags: Tag[]
  /** tagId -> how many captures in this case carry it. Narrows and orders the `#` popup. */
  tagUsage: Record<string, number>
  /** selectorId -> match count, the mock's `N hits` column. */
  selectorMatchCounts: Record<string, number>
}

export const EMPTY_MENTION_SOURCES: MentionSources = {
  captures: [],
  notes: [],
  selectors: [],
  tags: [],
  tagUsage: {},
  selectorMatchCounts: {}
}

/**
 * A capture with no title still has to be pickable; its URL identifies it. The
 * Exhibit citation leads when the row carries one (#1510), so a mention reads
 * as the citation a report would print: `NK-12 · Example page`.
 */
function captureLabel(capture: Pick<Capture, 'title' | 'url' | 'exhibitCitation'>): string {
  const name = capture.title || capture.url
  return capture.exhibitCitation ? `${capture.exhibitCitation} · ${name}` : name
}

/** Mirrors the references index, which coalesces an empty label to the pattern. */
function selectorLabel(selector: Pick<Selector, 'label' | 'pattern'>): string {
  return selector.label || selector.pattern
}

function candidatesForKind(
  targetType: MentionTargetType,
  sources: MentionSources
): MentionCandidate[] {
  const { captures, notes, selectors, tags, tagUsage, selectorMatchCounts } = sources
  switch (targetType) {
    case 'capture':
      return captures.map((c) => ({
        targetType,
        targetId: c.id,
        label: captureLabel(c),
        meta: 'capture',
        color: mentionColor('capture')
      }))
    case 'note':
      return notes.map((n) => ({
        targetType,
        targetId: n.id,
        label: n.title || '(Untitled note)',
        meta: 'note',
        color: mentionColor('note')
      }))
    case 'selector':
      return selectors.map((s) => ({
        targetType,
        targetId: s.id,
        label: selectorLabel(s),
        meta: `${selectorMatchCounts[s.id] ?? 0} hits`,
        color: mentionColor('selector')
      }))
    case 'tag':
      // Tags are installation-wide, so the list query returns every case's.
      // Only a tag some capture in this case carries is offered: one that
      // exists only in another case is noise here, and the @ sigil already
      // offers nothing from another case.
      return tags
        .filter((t) => (tagUsage[t.id] ?? 0) > 0)
        .sort((a, b) => {
          const used = (tagUsage[b.id] ?? 0) - (tagUsage[a.id] ?? 0)
          return used !== 0 ? used : a.name.localeCompare(b.name)
        })
        .map((t) => ({
          targetType,
          targetId: t.id,
          label: t.name,
          meta: 'tag',
          color: mentionColor('tag', t.color)
        }))
  }
}

/**
 * What a chip currently knows about its target.
 *
 * `loading` exists so a chip cannot flash broken while the list query that
 * would have resolved it is still in flight — the difference between "this
 * capture was deleted" and "the app has not looked yet" is the whole point of
 * the state.
 */
export interface MentionResolution {
  status: 'loading' | 'resolved' | 'missing'
  /** The target's current name. Null unless it resolved. */
  label: string | null
  /** A tag's own colour, when the target is a tag that still exists. */
  color: string | null
}

/** Which kinds' list queries have arrived. */
export type MentionSourcesLoaded = Record<MentionTargetType, boolean>

/**
 * Resolve a Mention against the cached lists.
 *
 * Identity is (targetType, targetId); the label stored on the node is only the
 * cache taken at insertion time, so a rename shows up here without anything
 * having rewritten the note.
 */
export function resolveMention(
  targetType: MentionTargetType,
  targetId: string,
  sources: MentionSources,
  loaded: MentionSourcesLoaded
): MentionResolution {
  // Typed, but not trusted: this arrives as a node attribute off a paste. An
  // unrecognised kind would index `loaded` through the prototype chain to a
  // truthy non-boolean and then fall off the switch below, so it is settled
  // here — a target the model cannot name is missing, never loading.
  if (!isMentionTargetType(targetType)) return MISSING
  if (!loaded[targetType]) return { status: 'loading', label: null, color: null }
  const resolved = (label: string, color: string | null = null): MentionResolution => ({
    status: 'resolved',
    label,
    color
  })
  switch (targetType) {
    case 'capture': {
      const hit = sources.captures.find((c) => c.id === targetId)
      return hit ? resolved(captureLabel(hit)) : MISSING
    }
    case 'note': {
      const hit = sources.notes.find((n) => n.id === targetId)
      return hit ? resolved(hit.title || '(Untitled note)') : MISSING
    }
    case 'selector': {
      const hit = sources.selectors.find((s) => s.id === targetId)
      return hit ? resolved(selectorLabel(hit)) : MISSING
    }
    case 'tag': {
      const hit = sources.tags.find((t) => t.id === targetId)
      return hit ? resolved(hit.name, hit.color ?? null) : MISSING
    }
    // Belt and braces behind the guard above: falling off this switch returned
    // undefined, and every caller reads `.status` off the result.
    default:
      return MISSING
  }
}

const MISSING: MentionResolution = { status: 'missing', label: null, color: null }

export interface RankMentionCandidatesArgs {
  sigil: MentionSigil
  query: string
  sources: MentionSources
  /** The note being written. A note cannot usefully mention itself. */
  excludeNoteId?: string
  /** Whether the popup can offer to create the target it did not find. */
  allowCreate?: boolean
}

/** A query shorter than this is still being typed, so it offers no create row. */
export const MIN_CREATE_QUERY_LENGTH = 2

/** What a create row makes: the mock's split, a note behind `@` and a selector behind `#`. */
export const MENTION_CREATE_KIND = {
  '@': 'note',
  '#': 'selector'
} as const satisfies Record<MentionSigil, MentionTargetType>

function createCandidate(sigil: MentionSigil, query: string): MentionCandidate {
  return {
    targetType: MENTION_CREATE_KIND[sigil],
    targetId: '',
    label: query,
    meta: 'new',
    color: 'var(--color-accent)',
    create: true
  }
}

/**
 * The popup's rows for a query.
 *
 * Filter, order primary kind first, then cap. The design source caps the
 * primary kind *before* filtering, which hides a matching capture behind eight
 * that do not match — a fixture artefact of its four-row seed data that would
 * be a real defect against a real case. See the PR.
 */
export function rankMentionCandidates({
  sigil,
  query,
  sources,
  excludeNoteId,
  allowCreate = false
}: RankMentionCandidatesArgs): MentionCandidate[] {
  const typed = query.trim()
  const needle = typed.toLowerCase()
  const rows = MENTION_KINDS[sigil].flatMap((kind) => candidatesForKind(kind, sources))
  const matches = rows
    .filter((row) => !(row.targetType === 'note' && row.targetId === excludeNoteId))
    .filter((row) => !needle || row.label.toLowerCase().includes(needle))
  const shown = matches.slice(0, MAX_MENTION_ROWS)
  // Checked against every match, not only the rows shown: an exact hit below
  // the cap is still an existing entity, and creating it again is a duplicate.
  const exists = matches.some((row) => row.label.toLowerCase() === needle)
  // Measured on what the write will save: a selector drops trailing
  // punctuation, so `#..` would otherwise save an empty pattern.
  const saved = MENTION_CREATE_KIND[sigil] === 'selector' ? classifySelection(typed).value : typed
  if (!allowCreate || saved.length < MIN_CREATE_QUERY_LENGTH || exists) return shown
  return [...shown, createCandidate(sigil, typed)]
}

/**
 * The peek card's mono line: the kind, then the one fact the cached lists
 * hold about the target.
 */
export function mentionPeekMeta(
  targetType: MentionTargetType,
  targetId: string,
  sources: MentionSources
): string {
  switch (targetType) {
    case 'capture': {
      const hit = sources.captures.find((c) => c.id === targetId)
      const host = hit ? hostnameOf(hit.url) : ''
      return host ? `capture · ${host}` : 'capture'
    }
    case 'selector':
      return `selector · ${sources.selectorMatchCounts[targetId] ?? 0} hits`
    case 'tag': {
      const used = sources.tagUsage[targetId] ?? 0
      return `tag · ${used} ${used === 1 ? 'capture' : 'captures'}`
    }
    default:
      return 'note'
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}
