import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { tagsQueryOptions, useTagsMutations } from '@renderer/lib/queries'
import { Dialog, DialogContent, Button, Input } from '@renderer/components/ui'

const TAG_COLORS = [
  '#f59e0b',
  '#ef4444',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
  '#14b8a6',
  '#f97316'
]

interface TagManagerProps {
  onClose?: () => void
}

export function TagManager({ onClose }: TagManagerProps) {
  const { data: tags = [] } = useQuery(tagsQueryOptions)
  const { create, remove } = useTagsMutations()
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(TAG_COLORS[0])
  const [showColorPicker, setShowColorPicker] = useState(false)
  const colorPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showColorPicker) return
    function handleClickOutside(e: MouseEvent) {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showColorPicker])

  const handleCreate = async () => {
    if (!newName.trim()) return
    await create.mutateAsync({ name: newName.trim(), color: newColor })
    setNewName('')
  }

  const body = (
    <>
      <h2 className="mb-4 text-lg font-semibold text-text-primary">Manage Tags</h2>

      {/* Create new tag */}
      <div className="mb-4 flex items-center gap-2">
        {/* Color swatch — click to expand picker */}
        <div ref={colorPickerRef} className="relative shrink-0">
          <button
            data-testid="tag-color-swatch"
            type="button"
            onClick={() => setShowColorPicker((v) => !v)}
            className="flex h-6 w-6 items-center justify-center rounded-full ring-1 ring-border transition-transform hover:scale-110"
            style={{ backgroundColor: newColor }}
            title="Pick color"
          />
          {showColorPicker && (
            <div className="absolute left-0 top-full z-50 mt-1 flex flex-col gap-1 rounded-lg border border-border-strong bg-card p-1.5 shadow-lg">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setNewColor(c)
                    setShowColorPicker(false)
                  }}
                  className={`h-4 w-4 rounded-full transition-transform hover:scale-125 ${
                    c === newColor ? 'ring-2 ring-accent ring-offset-1' : ''
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          )}
        </div>
        <Input
          data-testid="tag-name-input"
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          className="flex-1 py-1.5"
          placeholder="New tag name..."
        />
        <Button
          data-testid="tag-add-btn"
          size="sm"
          onClick={handleCreate}
          disabled={!newName.trim()}
        >
          Add
        </Button>
      </div>

      {/* Existing tags */}
      <div data-testid="tag-manager" className="max-h-48 space-y-1 overflow-y-auto">
        {tags.map((tag) => (
          <div
            key={tag.id}
            className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-elevated"
          >
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: tag.color || '#f59e0b' }}
            />
            <span className="flex-1 text-sm text-text-secondary">{tag.name}</span>
            <button
              data-testid="tag-delete-btn"
              onClick={() => remove.mutate(tag.id)}
              className="text-xs text-text-faint hover:text-red-400"
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      {onClose && (
        <div className="mt-4 flex justify-end">
          <Button data-testid="tag-done-btn" variant="ghost" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      )}
    </>
  )

  // Modal mode — overlay with click-to-close backdrop.
  if (onClose) {
    return (
      <Dialog open={true} onOpenChange={(v) => !v && onClose()}>
        <DialogContent onClose={onClose} className="w-96">
          {body}
        </DialogContent>
      </Dialog>
    )
  }

  // Inline mode — card contents only, no overlay.
  return <div className="neu-card rounded-2xl p-6">{body}</div>
}
