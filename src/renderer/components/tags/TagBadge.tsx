import type { Tag } from '@shared/types'

interface TagBadgeProps {
  tag: Tag
  onClick?: () => void
  removable?: boolean
}

export function TagBadge({ tag, onClick, removable }: TagBadgeProps) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-neutral-300 cursor-pointer hover:bg-neutral-700"
      style={{ backgroundColor: `${tag.color || '#f59e0b'}20` }}
      onClick={onClick}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color || '#f59e0b' }} />
      {tag.name}
      {removable && <span className="ml-0.5 text-neutral-500">&times;</span>}
    </span>
  )
}
