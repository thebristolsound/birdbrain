import { EditorContent, type Editor } from '@tiptap/react'
import {
  Bold,
  Italic,
  Strikethrough,
  Heading2,
  List,
  ListOrdered,
  Quote,
  type LucideIcon
} from 'lucide-react'

interface ToolbarAction {
  label: string
  icon: LucideIcon
  isActive: (editor: Editor) => boolean
  run: (editor: Editor) => void
}

const ACTIONS: ToolbarAction[] = [
  {
    label: 'Bold',
    icon: Bold,
    isActive: (e) => e.isActive('bold'),
    run: (e) => e.chain().focus().toggleBold().run()
  },
  {
    label: 'Italic',
    icon: Italic,
    isActive: (e) => e.isActive('italic'),
    run: (e) => e.chain().focus().toggleItalic().run()
  },
  {
    label: 'Strikethrough',
    icon: Strikethrough,
    isActive: (e) => e.isActive('strike'),
    run: (e) => e.chain().focus().toggleStrike().run()
  },
  {
    label: 'Heading',
    icon: Heading2,
    isActive: (e) => e.isActive('heading', { level: 2 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run()
  },
  {
    label: 'Bullet list',
    icon: List,
    isActive: (e) => e.isActive('bulletList'),
    run: (e) => e.chain().focus().toggleBulletList().run()
  },
  {
    label: 'Numbered list',
    icon: ListOrdered,
    isActive: (e) => e.isActive('orderedList'),
    run: (e) => e.chain().focus().toggleOrderedList().run()
  },
  {
    label: 'Quote',
    icon: Quote,
    isActive: (e) => e.isActive('blockquote'),
    run: (e) => e.chain().focus().toggleBlockquote().run()
  }
]

interface NoteEditorProps {
  editor: Editor | null
  placeholder?: string
  /** Minimum height of the writing area, as a Tailwind class. */
  minHeightClass?: string
  showToolbar?: boolean
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent) => void
}

export function NoteEditor({
  editor,
  placeholder = 'What did you observe?',
  minHeightClass = 'min-h-24',
  showToolbar = true,
  onBlur,
  onKeyDown
}: NoteEditorProps) {
  if (!editor) {
    return <div className={`rounded-lg border border-border bg-canvas ${minHeightClass}`} />
  }

  const isEmpty = editor.isEmpty

  return (
    <div className="rounded-lg border border-border bg-canvas focus-within:border-accent">
      {showToolbar ? (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1">
          {ACTIONS.map((action) => {
            const Icon = action.icon
            const active = action.isActive(editor)
            return (
              <button
                key={action.label}
                type="button"
                title={action.label}
                aria-label={action.label}
                aria-pressed={active}
                // Buttons steal focus from the editor on mousedown, which
                // collapses the selection they are meant to act on.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => action.run(editor)}
                className={`rounded p-1.5 hover:bg-elevated ${
                  active ? 'bg-elevated text-accent' : 'text-text-muted'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="relative" onBlur={onBlur} onKeyDown={onKeyDown}>
        {isEmpty ? (
          <p className="pointer-events-none absolute left-3 top-2 text-sm text-text-muted">
            {placeholder}
          </p>
        ) : null}
        <EditorContent editor={editor} className={`note-prose px-3 py-2 ${minHeightClass}`} />
      </div>
    </div>
  )
}
