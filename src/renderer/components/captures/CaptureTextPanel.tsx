import { useRef } from 'react'
import { useTagsMutations } from '@renderer/lib/api/tags'
import { useNoteSelection } from '@renderer/components/notes/selection/useNoteSelection'
import {
  SelectionActionsOverlay,
  type SelectionTagWrite
} from '@renderer/components/notes/selection/NoteSelectionOverlay'

interface CaptureTextPanelProps {
  caseId: string
  captureId: string
  heading: string
  content: string
}

export const CAPTURE_TAG_HINT =
  'Applies to this capture. A tag with this name is reused if one already exists.'

/**
 * The Text tab's extracted text, with the note editor's Selector and Tag bar
 * over a selection in it, so the gesture is the same here as in a note.
 *
 * The text is laid out as prose. Blank lines become paragraph breaks and
 * trailing whitespace at each paragraph's end is dropped; every other
 * character, single line breaks included, renders as extracted.
 *
 * The Page tab has no bar. Its document renders in a guest with scripts off
 * and navigation blocked, and reading a selection out of it would mean
 * putting something into the captured page.
 */
export function CaptureTextPanel({ caseId, captureId, heading, content }: CaptureTextPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const { selection, onSelectionEnd, openConfirm, dismiss } = useNoteSelection(hostRef)
  const { findOrCreate, addToCapture } = useTagsMutations(caseId)

  const tag: SelectionTagWrite = {
    hint: CAPTURE_TAG_HINT,
    apply: async (name) => {
      const found = await findOrCreate.mutateAsync({ name })
      await addToCapture.mutateAsync({ captureId, tagId: found.id })
      return `Tag applied — ${found.name}`
    }
  }

  const paragraphs = content
    .split(/\n[^\S\n]*\n/)
    .map((p) => p.replace(/^\n+/, '').trimEnd())
    .filter((p) => p.trim() !== '')

  return (
    <div
      ref={hostRef}
      data-testid="capture-text"
      className="relative h-full overflow-y-auto px-7 pb-7 pt-6"
      onMouseUp={onSelectionEnd}
      onKeyUp={onSelectionEnd}
    >
      <div className="max-w-[660px]">
        <h2 className="font-display text-[17px] font-bold tracking-[-0.025em] text-text-primary">
          {heading}
        </h2>
        {paragraphs.map((p, i) => (
          <p
            key={i}
            className="mt-3.5 whitespace-pre-wrap text-[13px] leading-[1.8] text-text-secondary"
          >
            {p}
          </p>
        ))}
      </div>
      {selection ? (
        <SelectionActionsOverlay
          caseId={caseId}
          origin="capture"
          tag={tag}
          selection={selection}
          onChoose={openConfirm}
          onDismiss={dismiss}
        />
      ) : null}
    </div>
  )
}
