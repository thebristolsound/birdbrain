import { useEffect, useRef } from 'react'
import { useTagsMutations } from '@renderer/lib/api/tags'
import { useNoteSelection } from '@renderer/components/notes/selection/useNoteSelection'
import {
  SelectionActionsOverlay,
  type SelectionTagWrite
} from '@renderer/components/notes/selection/NoteSelectionOverlay'

/** A span of the text to mark, and the start of what it held when it was indexed. */
export interface TextHighlight {
  start: number
  end: number
  preview: string
}

interface CaptureTextPanelProps {
  caseId: string
  captureId: string
  heading: string
  content: string
  highlight?: TextHighlight
}

interface Paragraph {
  text: string
  /** Where the paragraph starts in the content. */
  start: number
}

// The paragraphs the panel's comment describes, each with where it starts in the
// content, so a span of the content can be found in its paragraph.
function paragraphsOf(content: string): Paragraph[] {
  const paragraphs: Paragraph[] = []
  const take = (start: number, end: number) => {
    const raw = content.slice(start, end)
    const lead = raw.length - raw.replace(/^\n+/, '').length
    const text = raw.slice(lead).trimEnd()
    if (text.trim() !== '') paragraphs.push({ text, start: start + lead })
  }
  const breaks = /\n[^\S\n]*\n/g
  let start = 0
  for (let match = breaks.exec(content); match; match = breaks.exec(content)) {
    take(start, match.index)
    start = match.index + match[0].length
  }
  take(start, content.length)
  return paragraphs
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
export function CaptureTextPanel({
  caseId,
  captureId,
  heading,
  content,
  highlight
}: CaptureTextPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const markRef = useRef<HTMLElement | null>(null)
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

  const paragraphs = paragraphsOf(content)
  // Marked only where the text still holds what was indexed there. A `.txt` file
  // changed since then would put the mark on other words.
  const mark =
    highlight &&
    highlight.end <= content.length &&
    content.slice(highlight.start, highlight.start + highlight.preview.length) === highlight.preview
      ? highlight
      : null

  useEffect(() => {
    // jsdom has no layout, so it has no scrollIntoView either.
    markRef.current?.scrollIntoView?.({ block: 'center' })
  }, [mark?.start, mark?.end])

  const withMark = ({ text, start }: Paragraph) => {
    const end = start + text.length
    if (!mark || mark.end <= start || mark.start >= end) return text
    const from = Math.max(mark.start, start) - start
    const to = Math.min(mark.end, end) - start
    return (
      <>
        {text.slice(0, from)}
        <mark
          ref={from === mark.start - start ? markRef : undefined}
          data-testid="capture-text-hit"
          className="rounded-sm bg-warning-surface px-0.5 text-warning-fg"
        >
          {text.slice(from, to)}
        </mark>
        {text.slice(to)}
      </>
    )
  }

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
        {highlight && !mark ? (
          <p data-testid="capture-text-hit-moved" className="mt-2 text-[11px] text-text-muted">
            The search hit is not at its recorded place in this text, so nothing is marked.
          </p>
        ) : null}
        {paragraphs.map((p, i) => (
          <p
            key={i}
            className="mt-3.5 whitespace-pre-wrap text-[13px] leading-[1.8] text-text-secondary"
          >
            {withMark(p)}
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
