import { useState } from 'react'
import { useTags } from '@renderer/hooks/useTags'
import { TagBadge } from './TagBadge'
import { TagManager } from './TagManager'

export function TagList() {
  const { tags } = useTags()
  const [showManager, setShowManager] = useState(false)

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Tags</span>
        <button
          data-testid="manage-tags-btn"
          onClick={() => setShowManager(true)}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          title="Manage tags"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
      <div className="flex flex-wrap gap-1 px-3 pb-2">
        {tags.map((tag) => (
          <TagBadge key={tag.id} tag={tag} />
        ))}
        {tags.length === 0 && (
          <span className="text-xs text-neutral-600">No tags yet</span>
        )}
      </div>
      {showManager && <TagManager onClose={() => setShowManager(false)} />}
    </div>
  )
}
