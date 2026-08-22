/**
 * Pure Mention presentation logic — no React, no Tiptap, no DOM.
 *
 * The chip, the autocomplete popup and the masked list-row snippet all read
 * from here so the three surfaces cannot drift: a rename that changes what a
 * chip says has to change what the snippet says by construction.
 *
 * Import `MentionTargetType` as a type only. This module is pulled in by the
 * note list rows, which must not drag the editor's extension graph with them.
 */
import type { MentionTargetType } from '@shared/noteDoc'
import type { Capture, Note, Selector, Tag } from '@shared/types'

export const MENTION_SIGILS = ['@', '#'] as const
export type MentionSigil = (typeof MENTION_SIGILS)[number]

/**
 * Which key opens the popup that offers each kind.
 *
 * The design source splits them `@` = captures + notes, `#` = selectors +
 * tags, which is not the split the issue body describes. The mock states it
 * four independent times (the placeholder, both footers and the popup's own
 * scope label) and is the later artefact, so it wins.
 */
export const MENTION_SIGIL: Record<MentionTargetType, MentionSigil> = {
  capture: '@',
  note: '@',
  selector: '#',
  tag: '#'
}

/**
 * Guard for an attribute read off a node.
 *
 * A Mention pasted as HTML from outside the app arrives with whatever the
 * markup carried, which may be nothing at all — the chip has to render that
 * legibly rather than throw inside the editor.
 */
export function isMentionTargetType(value: unknown): value is MentionTargetType {
  return typeof value === 'string' && value in MENTION_SIGIL
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
  return MENTION_SIGIL[targetType] + label
}

/** The same, elided, for the chip and for note list-row snippets. */
export function maskMention(targetType: MentionTargetType, label: string): string {
  return mentionPlainText(targetType, truncateMentionLabel(label))
}

const CLICK_HINT: Record<MentionTargetType, string> = {
  capture: 'click to open',
  note: 'click to open',
  selector: 'click to edit the rule',
  tag: 'click to view'
}

/** The chip's title attribute. Broken targets say so instead of inviting a click. */
export function mentionTooltip(
  targetType: MentionTargetType,
  label: string,
  broken = false
): string {
  const hint = broken ? 'target deleted' : CLICK_HINT[targetType]
  return `${targetType} · ${label} — ${hint}`
}

/**
 * Where a chip click goes.
 *
 * One function on purpose. #400 replaced the Selectors and Tags screens with a
 * single Signals screen, so both chip kinds land there.
 */
export const MENTION_ROUTES = {
  capture: '/cases/$caseId/captures',
  note: '/cases/$caseId/notes',
  selector: '/cases/$caseId/signals',
  tag: '/cases/$caseId/signals'
} as const satisfies Record<MentionTargetType, string>

export type MentionRoute = (typeof MENTION_ROUTES)[MentionTargetType]

export function mentionRoute(targetType: MentionTargetType): MentionRoute {
  return MENTION_ROUTES[targetType]
}

/** One row of the autocomplete popup. */
export interface MentionCandidate {
  targetType: MentionTargetType
  targetId: string
  label: string
  /** Right-aligned hint: the kind, or a selector's live match count. */
  meta: string
  color: string
}

/** Everything the popup ranks over, read from the already-cached list queries. */
export interface MentionSources {
  captures: Pick<Capture, 'id' | 'title' | 'url'>[]
  notes: Pick<Note, 'id' | 'title'>[]
  selectors: Pick<Selector, 'id' | 'label' | 'pattern'>[]
  tags: Tag[]
  /** tagId -> how many captures in this case carry it. Orders the `#` popup. */
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

/** A capture with no title still has to be pickable; its URL identifies it. */
function captureLabel(capture: Pick<Capture, 'title' | 'url'>): string {
  return capture.title || capture.url
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
      // Tags are global by design — the backend deliberately accepts any tag
      // id — so this popup is the only narrowing there is. Rank the ones this
      // case already uses first rather than pretending the rest do not exist.
      return [...tags]
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
  }
}

const MISSING: MentionResolution = { status: 'missing', label: null, color: null }

export interface RankMentionCandidatesArgs {
  sigil: MentionSigil
  query: string
  sources: MentionSources
  /** The note being written. A note cannot usefully mention itself. */
  excludeNoteId?: string
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
  excludeNoteId
}: RankMentionCandidatesArgs): MentionCandidate[] {
  const needle = query.trim().toLowerCase()
  const rows = MENTION_KINDS[sigil].flatMap((kind) => candidatesForKind(kind, sources))
  return rows
    .filter((row) => !(row.targetType === 'note' && row.targetId === excludeNoteId))
    .filter((row) => !needle || row.label.toLowerCase().includes(needle))
    .slice(0, MAX_MENTION_ROWS)
}
