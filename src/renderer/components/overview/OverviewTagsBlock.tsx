import { Plus } from 'lucide-react'
import type { Tag } from '@shared/types'

interface OverviewTagsBlockProps {
  tags: Tag[]
  /** Per-case usage counts, keyed by tag id. */
  usageCounts: Record<string, number>
  onManage: () => void
}

const DEFAULT_TAG_COLOR = 'var(--color-text-muted)'

/**
 * The case's tags as tinted chips with their per-case usage count. Tags are
 * global but the count is not: a tag the case never applied shows zero and is
 * dropped from the list, so the block describes this case rather than the
 * whole database.
 */
export function OverviewTagsBlock({ tags, usageCounts, onManage }: OverviewTagsBlockProps) {
  const used = tags
    .map((tag) => ({ tag, count: usageCounts[tag.id] ?? 0 }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count || a.tag.name.localeCompare(b.tag.name))

  return (
    <div data-testid="overview-tags-block" className="flex flex-wrap gap-1.5">
      {used.map(({ tag, count }) => {
        const color = tag.color || DEFAULT_TAG_COLOR
        return (
          <span
            key={tag.id}
            data-testid="overview-tag-chip"
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-body text-[11px] font-medium"
            style={{
              color,
              background: `color-mix(in srgb, ${color} 9%, transparent)`,
              borderColor: `color-mix(in srgb, ${color} 13%, transparent)`
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
            {tag.name}
            <span className="font-mono text-[10px] opacity-70">{count}</span>
          </span>
        )
      })}
      <button
        data-testid="overview-tags-new"
        onClick={onManage}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-border-strong px-2.5 py-1 font-body text-[11px] font-medium text-text-muted hover:border-accent hover:text-accent"
      >
        <Plus size={10} strokeWidth={2} />
        New tag
      </button>
    </div>
  )
}
