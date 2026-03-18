import type { Tag } from '@shared/types'
import { X } from 'lucide-react'

interface TagBadgeProps {
  tag: Tag
  onClick?: () => void
  removable?: boolean
}

export function TagBadge({ tag, onClick, removable }: TagBadgeProps) {
  const color = tag.color || '#f59e0b'
  return (
    <span
      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-transform hover:scale-[1.04] cursor-default"
      style={{
        background: `${color}18`,
        color: color,
        border: `1px solid ${color}20`
      }}
      onClick={onClick}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {tag.name}
      {removable && (
        <button className="ml-0.5 hover:opacity-70 transition-opacity">
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  )
}
