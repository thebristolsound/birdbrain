import { useState } from 'react'
import { classifySelection, selectionToTagName } from '@shared/selectionKind'
import { createSelector } from '@renderer/lib/api/selectors'
import { useTagsMutations } from '@renderer/lib/api/tags'
import { notify } from '@renderer/lib/notify'
import {
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

interface Props extends NoteSelectionContext {
  selection: NoteSelectionState
  onChoose: (mode: NoteSelectionMode) => void
  onDismiss: () => void
}

/**
 * Turns a selected passage in the note editor into a Selector or a Tag (#391).
 *
 * Both writes go through the ordinary paths — `selectors:create` reaches
 * `selectorLifecycle`, so matches recompute asynchronously like any other
 * selector, and `tags:applyToNote` resolves create-or-reuse in main. Nothing
 * here writes a match or a tag row directly.
 */
export function NoteSelectionOverlay({
  caseId,
  resolveNoteId,
  onApplied,
  selection,
  onChoose,
  onDismiss
}: Props) {
  const { applyToNote } = useTagsMutations(caseId)
  const [watch, setWatch] = useState(true)
  const [pending, setPending] = useState(false)

  async function handleConfirm() {
    if (pending) return
    setPending(true)
    try {
      if (selection.mode === 'selector') {
        const { value } = classifySelection(selection.text)
        await createSelector({
          caseId,
          pattern: value,
          isRegex: false,
          label: value,
          // Server-side provenance is not available here: this IS the renderer
          // path, and 'note' is what actually happened (#395).
          origin: 'note',
          enabled: watch
        })
        notify.success(`Selector created — ${value}`)
      } else {
        const noteId = await resolveNoteId()
        const name = selectionToTagName(selection.text)
        const result = await applyToNote.mutateAsync({ noteId, name })
        notify.success(
          result.captureId
            ? `Tag applied — ${result.tag.name}, and to its capture`
            : `Tag applied — ${result.tag.name}`
        )
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
      onToggleWatch={() => setWatch((w) => !w)}
      onCancel={onDismiss}
      onConfirm={() => void handleConfirm()}
    />
  )
}
