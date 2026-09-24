import { useRef } from 'react'
import { EditorContent, type Editor } from '@tiptap/react'
import { NoteToolbar } from './NoteToolbar'
import { useNoteSelection } from '@renderer/components/notes/selection/useNoteSelection'
import {
  NoteSelectionOverlay,
  type NoteSelectionContext
} from '@renderer/components/notes/selection/NoteSelectionOverlay'

interface NoteEditorProps {
  workspace?: boolean
  editor: Editor | null
  placeholder?: string
  /** Minimum height of the writing area, as a Tailwind class. */
  minHeightClass?: string
  showToolbar?: boolean
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  /**
   * Enables the selection-to-Selector/Tag action bar (#391). Omitted where the
   * editor has no case context to write into.
   */
  selectionActions?: NoteSelectionContext
}

export function NoteEditor({
  editor,
  workspace = false,
  placeholder = 'What did you observe?',
  minHeightClass = 'min-h-24',
  showToolbar = true,
  onBlur,
  onKeyDown,
  selectionActions
}: NoteEditorProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const { selection, onSelectionEnd, openConfirm, dismiss } = useNoteSelection(bodyRef)

  if (!editor) {
    return <div className={`rounded-lg border border-border bg-canvas ${minHeightClass}`} />
  }

  const isEmpty = editor.isEmpty

  return (
    <div
      className={
        workspace
          ? 'bg-canvas'
          : 'rounded-lg border border-border bg-canvas focus-within:border-accent'
      }
    >
      {showToolbar ? <NoteToolbar editor={editor} workspace={workspace} /> : null}

      <div
        ref={bodyRef}
        data-tour="noteeditor"
        className={workspace ? 'relative px-4 py-4' : 'relative'}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onMouseUp={selectionActions ? onSelectionEnd : undefined}
        onKeyUp={selectionActions ? onSelectionEnd : undefined}
      >
        {isEmpty ? (
          <p className="pointer-events-none absolute left-3 top-2 text-sm text-text-muted">
            {placeholder}
          </p>
        ) : null}
        <EditorContent
          editor={editor}
          className={`note-prose note-editor flex flex-col ${minHeightClass}`}
        />
        {selectionActions && selection ? (
          <NoteSelectionOverlay
            {...selectionActions}
            selection={selection}
            onChoose={openConfirm}
            onDismiss={dismiss}
          />
        ) : null}
      </div>
    </div>
  )
}
