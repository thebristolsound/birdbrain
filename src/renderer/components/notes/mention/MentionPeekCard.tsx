import type { MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, Pin } from 'lucide-react'
import type { MentionTargetType } from '@shared/noteDoc'
import { iconForKind } from '@renderer/components/notes/mention/MentionSuggestionList'

/** The card's width in the Mention Grammar exploration. */
export const PEEK_WIDTH = 264

/** Gap between the chip and the card, as in the mock. */
const PEEK_GAP = 8

/** Kept clear of the window edges so the card never sits flush. */
const EDGE_GUTTER = 8

/**
 * Room the card needs above the chip. Below this the card opens underneath
 * instead, so a Mention on a note's first line is not peeked off-screen.
 */
const PEEK_FLIP_HEIGHT = 96

export interface PeekAnchor {
  left: number
  top: number
  bottom: number
}

export interface PeekPosition {
  left: number
  top: number
  placement: 'above' | 'below'
}

/**
 * Where the card sits for a chip at `anchor`, in viewport coordinates.
 *
 * The card is portalled to the body and fixed, rather than absolutely placed
 * inside the chip as the mock does, because several note surfaces clip their
 * overflow and would cut the card off.
 */
export function peekPosition(anchor: PeekAnchor, viewportWidth: number): PeekPosition {
  const rightmost = viewportWidth - PEEK_WIDTH - EDGE_GUTTER
  const left = Math.max(EDGE_GUTTER, Math.min(Math.round(anchor.left), rightmost))
  if (anchor.top < PEEK_FLIP_HEIGHT) {
    return { left, top: Math.round(anchor.bottom + PEEK_GAP), placement: 'below' }
  }
  return { left, top: Math.round(anchor.top - PEEK_GAP), placement: 'above' }
}

export interface MentionPeekCardProps {
  id: string
  targetType: MentionTargetType
  title: string
  meta: string
  anchor: PeekAnchor
  pinned: boolean
  onOpen: () => void
  onTogglePin: () => void
  onPointerEnter: () => void
  onPointerLeave: () => void
}

/**
 * The hover card over a Mention: what the chip points at, without leaving the
 * note ("Peek means you rarely leave the note").
 *
 * Pin keeps the card open after the pointer leaves, so it can be read beside
 * the paragraph. It pins this preview only; it is not an Annotation Pin and
 * writes nothing.
 */
export function MentionPeekCard({
  id,
  targetType,
  title,
  meta,
  anchor,
  pinned,
  onOpen,
  onTogglePin,
  onPointerEnter,
  onPointerLeave
}: MentionPeekCardProps) {
  const Icon = iconForKind(targetType)
  const { left, top, placement } = peekPosition(anchor, window.innerWidth)

  // React events bubble through a portal to the chip, whose own click opens
  // the target, so every press inside the card stops here.
  function swallow(e: MouseEvent) {
    e.stopPropagation()
  }

  return createPortal(
    <div
      id={id}
      role="group"
      aria-label={`${targetType} preview`}
      data-testid="mention-peek"
      data-placement={placement}
      style={{
        left,
        top,
        width: PEEK_WIDTH,
        transform: placement === 'above' ? 'translateY(-100%)' : undefined
      }}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      onMouseDown={(e) => {
        // Keeps the editor's caret and selection where they were.
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={swallow}
      className="mention-popup-layer fixed flex gap-2.5 rounded-xl border border-border-strong bg-elevated p-2.5 shadow-[var(--shadow-overlay)]"
    >
      <span className="flex h-[42px] w-14 shrink-0 items-center justify-center rounded-lg border border-border bg-canvas text-text-faint">
        <Icon className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span
          data-testid="mention-peek-title"
          className="truncate text-[12px] font-medium text-text-primary"
        >
          {title}
        </span>
        <span data-testid="mention-peek-meta" className="font-mono text-[10px] text-text-faint">
          {meta}
        </span>
        <span className="mt-0.5 flex gap-2.5 text-[10.5px] text-accent">
          <button
            type="button"
            data-testid="mention-peek-open"
            onClick={(e) => {
              e.stopPropagation()
              onOpen()
            }}
            className="inline-flex items-center gap-1 hover:underline"
          >
            <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
            Open
          </button>
          <button
            type="button"
            data-testid="mention-peek-pin"
            aria-pressed={pinned}
            title={pinned ? 'Let this preview close' : 'Keep this preview open'}
            onClick={(e) => {
              e.stopPropagation()
              onTogglePin()
            }}
            className={`inline-flex items-center gap-1 hover:underline ${pinned ? 'font-semibold' : ''}`}
          >
            <Pin className="h-2.5 w-2.5" aria-hidden="true" />
            {pinned ? 'Pinned' : 'Pin'}
          </button>
        </span>
      </span>
    </div>,
    document.body
  )
}
