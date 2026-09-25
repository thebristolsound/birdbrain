import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Camera, Crosshair, Plus, StickyNote, Tag, type LucideIcon } from 'lucide-react'
import type { MentionTargetType } from '@shared/noteDoc'
import {
  MENTION_SCOPE_LABEL,
  mentionDisplayText,
  type MentionCandidate,
  type MentionSigil
} from '@renderer/components/notes/mention/mentionModel'

const ICONS: Record<MentionTargetType, LucideIcon> = {
  capture: Camera,
  note: StickyNote,
  selector: Crosshair,
  tag: Tag
}

// Same discipline as isMentionTargetType: never index a per-kind record with a
// key that could have come off a paste, because `in` and a bare lookup both
// walk the prototype chain and would render `Object.prototype.toString` as a
// component. `note`'s icon is the fallback the chip already uses for a kind it
// cannot name.
export function iconForKind(targetType: MentionTargetType): LucideIcon {
  return Object.hasOwn(ICONS, targetType) ? ICONS[targetType] : StickyNote
}

export interface MentionSuggestionListProps {
  sigil: MentionSigil
  query: string
  items: MentionCandidate[]
  onPick: (item: MentionCandidate) => void
}

/** What the suggestion plugin calls when the editor sees a key while we are open. */
export interface MentionSuggestionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

/**
 * The caret-anchored autocomplete popup.
 *
 * Placement is the plugin's job, not ours — it anchors this element to the
 * cursor rect and flips it above the caret near the viewport's bottom edge
 * through Floating UI. The mock's literal 290px flip threshold is a constant
 * of its own hand-rolled positioning and is not portable; the behaviour it
 * describes is what ships.
 *
 * Escape is likewise not handled here. The plugin dismisses on Escape and
 * reports the key as handled, which is what keeps a dismissal from also
 * reverting the draft or closing the surrounding dialog.
 */
export const MentionSuggestionList = forwardRef<
  MentionSuggestionListHandle,
  MentionSuggestionListProps
>(function MentionSuggestionList({ sigil, query, items, onPick }, ref) {
  const [rawIndex, setRawIndex] = useState(0)

  // A new query is a new list; start at the top of it.
  useEffect(() => {
    setRawIndex(0)
  }, [query])

  // Clamp on read rather than on write: the list can shrink underneath a
  // selection that was legal when it was made (a capture deleted in another
  // window), and a stale index would insert the wrong entity.
  const selected = items.length === 0 ? 0 : Math.min(rawIndex, items.length - 1)

  // Mirrored so two keystrokes arriving before React re-renders still compose
  // — the state value the handler closed over would be one press behind.
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false
      const move = (delta: number) => {
        const next = (selectedRef.current + delta + items.length) % items.length
        selectedRef.current = next
        setRawIndex(next)
        return true
      }
      if (event.key === 'ArrowDown') return move(1)
      if (event.key === 'ArrowUp') return move(-1)
      if (event.key === 'Enter' || event.key === 'Tab') {
        onPick(items[selectedRef.current])
        return true
      }
      return false
    }
  }))

  // No matches means no popup. The design has no empty state here, and
  // showing one would put a dead panel over the text being typed.
  if (items.length === 0) return null

  return (
    <div
      data-testid="mention-popup"
      role="listbox"
      aria-label="Mention suggestions"
      className="w-80 overflow-hidden rounded-lg border border-border-strong bg-card text-left shadow-[var(--shadow-overlay)]"
    >
      <div className="flex items-center gap-[7px] border-b border-border bg-surface px-[11px] py-1.5">
        <span className="font-mono text-[11px] font-bold text-accent">{sigil}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-muted">
          {query || 'start typing…'}
        </span>
        <span className="text-[10px] text-text-faint">{MENTION_SCOPE_LABEL[sigil]}</span>
      </div>

      <div className="max-h-[210px] overflow-y-auto p-1">
        {items.map((item, i) => {
          const Icon = item.create ? Plus : iconForKind(item.targetType)
          return (
            <button
              key={
                item.create ? `create:${item.targetType}` : `${item.targetType}:${item.targetId}`
              }
              type="button"
              role="option"
              aria-selected={i === selected}
              data-testid={
                item.create
                  ? 'mention-option-create'
                  : `mention-option-${item.targetType}-${item.targetId}`
              }
              // Taking focus would collapse the selection the insert replaces.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setRawIndex(i)}
              onClick={() => onPick(item)}
              className={`flex w-full items-center gap-[9px] rounded-md px-2 py-1.5 text-left ${
                i === selected ? 'bg-accent-subtle' : 'hover:bg-elevated'
              }`}
            >
              <Icon
                className="h-[13px] w-[13px] shrink-0"
                strokeWidth={2}
                style={{ color: item.color }}
                aria-hidden="true"
              />
              <span
                className={`min-w-0 flex-1 truncate text-[12px] ${
                  item.create ? 'text-accent' : 'text-text-secondary'
                }`}
              >
                {item.create
                  ? `Create "${item.label}" as ${item.targetType}`
                  : mentionDisplayText(item)}
              </span>
              <span className="shrink-0 text-[10px] text-text-faint">{item.meta}</span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between border-t border-border bg-surface px-[11px] py-1.5 text-[10px] text-text-faint">
        <span>↑↓ to move · ⏎ to insert</span>
        <span>esc to dismiss</span>
      </div>
    </div>
  )
})
