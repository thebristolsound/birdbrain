import { useMemo } from 'react'
import { renderToReactElement } from '@tiptap/static-renderer/pm/react'
import { noteExtensions } from '@shared/noteDoc'
import type { Note } from '@shared/types'
import { isMentionTargetType, maskMention } from '@renderer/components/notes/mention/mentionModel'
import type { MentionResolver } from '@renderer/components/notes/mention/useMentionSources'

interface NoteBodyProps {
  note: Pick<Note, 'body' | 'bodyDoc'>
  className?: string
  /**
   * Current labels for the note's Mentions. Optional: without it a Mention
   * reads with the label it was written against, which is right for a caller
   * that has no case in hand.
   */
  resolveMention?: MentionResolver
}

/**
 * Read-only rendering of a note body.
 *
 * Static rendering rather than a read-only editor: a list of notes would
 * otherwise mount one ProseMirror view per card, and none of them would ever
 * take a keystroke.
 *
 * Mentions are masked to prose here rather than drawn as chips. A list row is
 * a snippet, not a document — the chip is the editor's treatment, and a row of
 * coloured pills reads worse than the sentence the investigator wrote.
 */
export function NoteBody({ note, className = '', resolveMention }: NoteBodyProps) {
  const rendered = useMemo(() => {
    if (!note.bodyDoc) return null
    try {
      return renderToReactElement({
        content: JSON.parse(note.bodyDoc),
        extensions: noteExtensions(),
        options: {
          // Merged over the extension-derived map, so only `mention` is
          // overridden and every other node still renders as it did.
          nodeMapping: {
            mention: ({ node }) => {
              const { targetType, label } = node.attrs
              if (!isMentionTargetType(targetType)) return typeof label === 'string' ? label : ''
              const stored = typeof label === 'string' && label ? label : targetType
              const current = resolveMention?.(targetType, String(node.attrs.targetId ?? ''))
              return maskMention(targetType, current?.label ?? stored)
            }
          }
        }
      })
    } catch {
      // Fall back to the derived plain text, which is always present.
      return null
    }
  }, [note.bodyDoc, resolveMention])

  if (rendered !== null) {
    return <div className={`note-prose ${className}`}>{rendered}</div>
  }

  if (!note.body) return null

  return (
    <p className={`whitespace-pre-wrap text-sm text-text-secondary ${className}`}>{note.body}</p>
  )
}
