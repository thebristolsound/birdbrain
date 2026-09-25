import { useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Quote,
  Link,
  Image,
  Camera,
  Undo2,
  Redo2
} from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input
} from '@renderer/components/ui'
import { isNoteImageSource } from '@shared/noteDoc'

const groups = [
  [
    {
      label: 'Bold',
      icon: Bold,
      active: (e: Editor) => e.isActive('bold'),
      run: (e: Editor) => e.chain().focus().toggleBold().run()
    },
    {
      label: 'Italic',
      icon: Italic,
      active: (e: Editor) => e.isActive('italic'),
      run: (e: Editor) => e.chain().focus().toggleItalic().run()
    },
    {
      label: 'Strikethrough',
      icon: Strikethrough,
      active: (e: Editor) => e.isActive('strike'),
      run: (e: Editor) => e.chain().focus().toggleStrike().run()
    },
    {
      label: 'Inline code',
      icon: Code,
      active: (e: Editor) => e.isActive('code'),
      run: (e: Editor) => e.chain().focus().toggleCode().run()
    }
  ],
  [
    {
      label: 'Heading 1',
      icon: Heading1,
      active: (e: Editor) => e.isActive('heading', { level: 1 }),
      run: (e: Editor) => e.chain().focus().toggleHeading({ level: 1 }).run()
    },
    {
      label: 'Heading 2',
      icon: Heading2,
      active: (e: Editor) => e.isActive('heading', { level: 2 }),
      run: (e: Editor) => e.chain().focus().toggleHeading({ level: 2 }).run()
    }
  ],
  [
    {
      label: 'Bullet list',
      icon: List,
      active: (e: Editor) => e.isActive('bulletList'),
      run: (e: Editor) => e.chain().focus().toggleBulletList().run()
    },
    {
      label: 'Numbered list',
      icon: ListOrdered,
      active: (e: Editor) => e.isActive('orderedList'),
      run: (e: Editor) => e.chain().focus().toggleOrderedList().run()
    },
    {
      label: 'Quote',
      icon: Quote,
      active: (e: Editor) => e.isActive('blockquote'),
      run: (e: Editor) => e.chain().focus().toggleBlockquote().run()
    }
  ]
]
const buttonClass =
  'flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-text-muted hover:bg-elevated disabled:opacity-40'

export function NoteToolbar({ editor, workspace }: { editor: Editor; workspace: boolean }) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const selection = useRef({ from: 1, to: 1 })

  function insertLink() {
    if (!/^https?:\/\//i.test(url.trim())) {
      setError('Enter an http or https URL.')
      return
    }
    editor
      .chain()
      .focus()
      .setTextSelection(selection.current)
      .extendMarkRange('link')
      .setLink({ href: url.trim() })
      .run()
    if (selection.current.from === selection.current.to)
      editor.chain().focus().insertContent(url.trim()).unsetLink().run()
    setLinkOpen(false)
    setError('')
  }
  async function insertImage(file?: File) {
    if (!file) return
    if (file.size > 2_000_000 || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      setError('Choose a PNG, JPEG, GIF or WebP image under 2 MB.')
      return
    }
    try {
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Could not read image'))
        reader.readAsDataURL(file)
      })
      if (!isNoteImageSource(src)) throw new Error('Invalid image')
      if (editor.isDestroyed) return
      editor
        .chain()
        .focus()
        .setTextSelection(selection.current)
        .insertContent({ type: 'image', attrs: { src, alt: file.name } })
        .run()
      setError('')
    } catch {
      setError('Could not read the image. Try another file.')
    }
  }
  return (
    <>
      <div
        role="toolbar"
        aria-label="Note formatting"
        className={`flex flex-wrap items-center gap-0.5 border-b border-border py-2 ${workspace ? 'px-7' : 'px-1.5'}`}
      >
        <select
          aria-label="Text style"
          title="Text style"
          value={
            editor.isActive('heading', { level: 1 })
              ? '1'
              : editor.isActive('heading', { level: 2 })
                ? '2'
                : editor.isActive('heading', { level: 3 })
                  ? '3'
                  : 'paragraph'
          }
          onChange={(e) =>
            e.target.value === 'paragraph'
              ? editor.chain().focus().setParagraph().run()
              : editor
                  .chain()
                  .focus()
                  .setHeading({ level: Number(e.target.value) as 1 | 2 | 3 })
                  .run()
          }
          className="h-7 max-w-28 rounded bg-transparent text-xs text-text-muted"
        >
          <option value="paragraph">Paragraph</option>
          <option value="1">Heading 1</option>
          <option value="2">Heading 2</option>
          <option value="3">Heading 3</option>
        </select>
        {groups.map((group, i) => (
          <div key={i} className="flex items-center border-l border-border pl-1">
            {group.map((action) => (
              <button
                key={action.label}
                title={action.label}
                aria-label={action.label}
                aria-pressed={action.active(editor)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => action.run(editor)}
                className={`${buttonClass} ${action.active(editor) ? 'bg-elevated text-accent' : ''}`}
              >
                <action.icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        ))}
        <div className="flex items-center border-l border-border pl-1">
          <button
            title="Insert link"
            aria-label="Insert link"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              selection.current = {
                from: editor.state.selection.from,
                to: editor.state.selection.to
              }
              setUrl(String(editor.getAttributes('link').href ?? ''))
              setError('')
              setLinkOpen(true)
            }}
            className={buttonClass}
          >
            <Link className="h-3.5 w-3.5" />
          </button>
          <button
            title="Insert image"
            aria-label="Insert image"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              selection.current = {
                from: editor.state.selection.from,
                to: editor.state.selection.to
              }
              fileRef.current?.click()
            }}
            className={buttonClass}
          >
            <Image className="h-3.5 w-3.5" />
          </button>
          <input
            ref={fileRef}
            type="file"
            aria-label="Choose note image"
            className="hidden"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(e) => {
              void insertImage(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <button
            title="Link a capture"
            aria-label="Link a capture"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().insertContent('@').run()}
            className={buttonClass}
          >
            <Camera className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center border-l border-border pl-1">
          <button
            title="Undo"
            aria-label="Undo"
            disabled={!editor.can().undo()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().undo().run()}
            className={buttonClass}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            title="Redo"
            aria-label="Redo"
            disabled={!editor.can().redo()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().redo().run()}
            className={buttonClass}
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {!linkOpen && error ? (
        <p role="alert" className="px-3 py-1 text-xs text-red-400">
          {error}
        </p>
      ) : null}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent onClose={() => setLinkOpen(false)}>
          <DialogHeader>
            <DialogTitle>Insert link</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              insertLink()
            }}
            className="space-y-3"
          >
            <Input
              aria-label="Link URL"
              placeholder="https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            {error ? (
              <p role="alert" className="text-xs text-red-400">
                {error}
              </p>
            ) : null}
            <Button type="submit">Insert</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
