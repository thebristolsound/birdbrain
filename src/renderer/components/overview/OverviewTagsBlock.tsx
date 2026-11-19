import type { Tag } from '@shared/types'

interface OverviewTagsBlockProps {
  tags: Tag[]
  /** Per-case usage counts, keyed by tag id. */
  usageCounts: Record<string, number>
}

const DEFAULT_TAG_COLOR = 'var(--color-text-muted)'

/**
 * The case's tags as tinted chips with their per-case usage count. Tags are
 * global but the count is not: a tag the case never applied shows zero and is
 * dropped from the list, so the block describes this case rather than the
 * whole database. Signals creates and edits them.
 */
export function OverviewTagsBlock({ tags, usageCounts }: OverviewTagsBlockProps) {
  const used = tags
    .map((tag) => ({ tag, count: usageCounts[tag.id] ?? 0 }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count || a.tag.name.localeCompare(b.tag.name))

  return (
    <div data-testid="overview-tags-block" className="flex flex-wrap gap-1.5">
      {used.length === 0 ? (
        <p className="font-body text-xs text-text-faint">No Tags applied in this Case yet.</p>
      ) : null}
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
    </div>
  )
}
