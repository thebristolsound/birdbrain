import { Camera, Pencil, Puzzle, StickyNote, type LucideIcon } from 'lucide-react'
import type { SelectorOrigin } from '@shared/types'

// The copy and the icons are fixed by the design (2026-08-21 standalone mock,
// Signals detail rail). They live here rather than beside the one component
// that renders them today because the surface moves — the strings are the
// stable part. There is no entry for an absent origin on purpose: a Selector
// with none renders nothing at all, since a legacy row has no provenance to
// state and inventing one would be a false claim.
export const ORIGIN_LABEL: Record<SelectorOrigin, string> = {
  extension: 'Added from the extension',
  capture: 'Added from a capture',
  note: 'Added from a note',
  manual: 'Added by hand'
}

export const ORIGIN_ICON: Record<SelectorOrigin, LucideIcon> = {
  extension: Puzzle,
  capture: Camera,
  note: StickyNote,
  manual: Pencil
}
