import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { tagsQueryOptions, useTagsMutations } from '@renderer/lib/queries'

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
  onClose: () => void
}

export function TagManager({ onClose }: TagManagerProps) {
  const { data: tags = [] } = useQuery(tagsQueryOptions)
  const { create, remove } = useTagsMutations()
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(TAG_COLORS[0])

  const handleCreate = async () => {
    if (!newName.trim()) return
    await create.mutateAsync({ name: newName.trim(), color: newColor })
    setNewName('')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div className="neu-card w-96 rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold text-text-primary">Manage Tags</h2>

        {/* Create new tag */}
        <div className="mb-4 flex items-center gap-2">
          <input
            data-testid="tag-name-input"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="flex-1 rounded border border-border-strong bg-elevated px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
            placeholder="New tag name..."
          />
          <div className="flex gap-1">
            {TAG_COLORS.map((c) => (
              <button
                data-testid="tag-color-swatch"
                key={c}
                onClick={() => setNewColor(c)}
                className={`h-5 w-5 rounded-full ${newColor === c ? 'ring-2 ring-white ring-offset-1 ring-offset-card' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button
            data-testid="tag-add-btn"
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="rounded bg-accent px-2 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Add
          </button>
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

        <div className="mt-4 flex justify-end">
          <button
            data-testid="tag-done-btn"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:text-text-primary"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
