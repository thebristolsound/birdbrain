import { useState, useRef, useEffect } from 'react'
import { TagBadge } from '@renderer/components/tags/TagBadge'
import { useCaptureTagEditor } from './useCaptureTagEditor'

interface Props {
  captureId: string
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}

const COLOR_PRESETS = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b']

export function TagEditorPopover({ captureId, open, onClose, anchorRef }: Props) {
  const { tags, allTags, toggleTag, createTag } = useCaptureTagEditor(captureId)
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLOR_PRESETS[0])
  const [showColors, setShowColors] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open, onClose, anchorRef])

  if (!open) return null

  const available = allTags.filter((t) => !tags.some((ct) => ct.id === t.id))

  async function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) return
    await createTag(trimmed, color)
    setName('')
  }

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border-strong bg-card py-1 shadow-xl"
    >
      {tags.length > 0 && (
        <div className="border-b border-border px-3 py-2">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-faint">
            Applied
          </div>
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <TagBadge key={tag.id} tag={tag} onClick={() => toggleTag(tag.id)} removable />
            ))}
          </div>
        </div>
      )}

      <div className="max-h-40 overflow-y-auto py-1">
        {available.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-text-faint">No more tags to add.</div>
        )}
        {available.map((tag) => (
          <button
            key={tag.id}
            onClick={() => toggleTag(tag.id)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-elevated"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: tag.color || '#f59e0b' }}
            />
            {tag.name}
          </button>
        ))}
      </div>

      <div className="border-t border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowColors(!showColors)}
              className="flex h-4 w-4 items-center justify-center rounded-full ring-1 ring-border transition-transform hover:scale-110"
              style={{ backgroundColor: color }}
              title="Pick color"
            />
            {showColors && (
              <div className="absolute bottom-full left-0 mb-1 flex flex-col gap-1 rounded-lg border border-border-strong bg-card p-1.5 shadow-lg">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setColor(c)
                      setShowColors(false)
                    }}
                    className="h-4 w-4 rounded-full ring-1 ring-border hover:scale-110"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            )}
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleCreate()
              }
            }}
            placeholder="Create tag"
            className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-faint focus:outline-none"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={!name.trim()}
            className="rounded-md px-2 py-0.5 text-[11px] text-accent hover:bg-accent-subtle disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
