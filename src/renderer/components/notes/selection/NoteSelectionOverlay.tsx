import { useState } from 'react'
import { classifySelection, selectionToTagName } from '@shared/selectionKind'
import type { SelectorOrigin } from '@shared/types'
import { useSelectorsMutations } from '@renderer/lib/api/selectors'
import { useTagsMutations } from '@renderer/lib/api/tags'
import { notify } from '@renderer/lib/notify'
import {
  NOTE_TAG_HINT,
  NoteSelectionBar,
  NoteSelectionConfirm
} from '@renderer/components/notes/selection/NoteSelectionPopover'
import type {
  NoteSelectionMode,
  NoteSelectionState
} from '@renderer/components/notes/selection/useNoteSelection'

export interface NoteSelectionContext {
  caseId: string
  /**
   * The note a tag attaches to, persisting an unsaved draft on the way.
   *
   * Required, not optional: ruling R15 says the Tag action works in every
   * NoteEditor mount and never silently no-ops, and two of the four mounts
   * open on a note that does not exist yet. Making the mount supply this is
   * what turns that rule into something the type system holds rather than
   * something each call site remembers.
   */
  resolveNoteId: () => Promise<string>
  /** Invalidate/refresh after a write, where the mount owns the note list. */
  onApplied?: () => void
}

interface OverlayState {
  selection: NoteSelectionState
  onChoose: (mode: NoteSelectionMode) => void
  onDismiss: () => void
}

interface Props extends NoteSelectionContext, OverlayState {}

/** How one surface writes the tag its selection bar names. */
export interface SelectionTagWrite {
  /** Applies the tag by name and returns the success message. */
  apply: (name: string) => Promise<string>
  /** The confirm popover's statement of where the tag lands. */
  hint: string
}

export interface SelectionActionsOverlayProps extends OverlayState {
  caseId: string
  /** Recorded on a selector created here (#395). */
  origin: SelectorOrigin
  tag: SelectionTagWrite
  onApplied?: () => void
}

/**
 * The two-action bar and its confirm popover, for any surface whose selected
 * text can become a Selector or a Tag.
 *
 * The selector write is the same everywhere — `selectors:create` reaches
 * `selectorLifecycle`, so matches recompute asynchronously like any other
 * selector — and only its recorded origin differs. What a tag attaches to is
 * the surface's business, so it arrives as `tag`. Nothing here writes a match
 * or a tag row directly.
 */
export function SelectionActionsOverlay({
  caseId,
  origin,
  tag,
  onApplied,
  selection,
  onChoose,
  onDismiss
}: SelectionActionsOverlayProps) {
  // The mutation hook rather than the bare wrapper: its call sites elsewhere
  // refresh their own lists, but nothing here owns the Signals screen, and a
  // selector created from a selection has to be visible there without waiting
  // out the 30s staleTime.
  const { create: createSelector } = useSelectorsMutations(caseId)
  const [watch, setWatch] = useState(true)
  const [pending, setPending] = useState(false)

  async function handleConfirm() {
    if (pending) return
    setPending(true)
    try {
      if (selection.mode === 'selector') {
        const { value } = classifySelection(selection.text)
        await createSelector.mutateAsync({
          caseId,
          pattern: value,
          isRegex: false,
          label: value,
          // Server-side provenance is not available here: this IS the renderer
          // path, and the surface is what actually happened (#395).
          origin,
          enabled: watch
        })
        notify.success(`Selector created — ${value}`)
      } else {
        notify.success(await tag.apply(selectionToTagName(selection.text)))
      }
      onApplied?.()
      onDismiss()
    } catch (err) {
      notify.error(
        selection.mode === 'selector' ? "Couldn't create the selector" : "Couldn't apply the tag",
        { cause: err }
      )
    } finally {
      setPending(false)
    }
  }

  if (selection.step === 'bar') {
    return (
      <NoteSelectionBar
        x={selection.x}
        y={selection.y}
        onChoose={(mode) => {
          setWatch(true)
          onChoose(mode)
        }}
      />
    )
  }

  return (
    <NoteSelectionConfirm
      x={selection.x}
      y={selection.y}
      text={selection.text}
      mode={selection.mode}
      watch={watch}
      pending={pending}
      tagHint={tag.hint}
      onToggleWatch={() => setWatch((w) => !w)}
      onCancel={onDismiss}
      onConfirm={() => void handleConfirm()}
    />
  )
}

/**
 * Turns a selected passage in the note editor into a Selector or a Tag (#391).
 *
 * `tags:applyToNote` resolves create-or-reuse in main and reaches the note's
 * capture too, when it has one.
 */
export function NoteSelectionOverlay({ caseId, resolveNoteId, onApplied, ...overlay }: Props) {
  const { applyToNote } = useTagsMutations(caseId)

  const tag: SelectionTagWrite = {
    hint: NOTE_TAG_HINT,
    apply: async (name) => {
      const noteId = await resolveNoteId()
      const result = await applyToNote.mutateAsync({ noteId, name })
      return result.captureId
        ? `Tag applied — ${result.tag.name}, and to its capture`
        : `Tag applied — ${result.tag.name}`
    }
  }

  return (
    <SelectionActionsOverlay
      {...overlay}
      caseId={caseId}
      origin="note"
      tag={tag}
      onApplied={onApplied}
    />
  )
}
