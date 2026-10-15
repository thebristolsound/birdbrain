import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import type { Tag } from '@shared/types'
import { NewTagPopover } from '@renderer/components/overview/NewTagPopover'

interface OverviewTagsBlockProps {
  caseId: string
  tags: Tag[]
  /** Per-case usage counts, keyed by tag id. */
  usageCounts: Record<string, number>
}

const DEFAULT_TAG_COLOR = 'var(--color-text-muted)'

/**
 * The case's tags as tinted chips with their per-case usage count. Tags are
 * global but the count is not: a tag the case never applied shows zero and is
 * dropped from the list, so the block describes this case rather than the
 * whole database. A tag created here is the exception until the dashboard is
 * left, so the create visibly lands instead of vanishing on its zero count.
 */
export function OverviewTagsBlock({ caseId, tags, usageCounts }: OverviewTagsBlockProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [createdIds, setCreatedIds] = useState<ReadonlySet<string>>(new Set())
  const anchorRef = useRef<HTMLButtonElement>(null)

  const used = tags
    .map((tag) => ({ tag, count: usageCounts[tag.id] ?? 0 }))
    .filter(({ tag, count }) => count > 0 || createdIds.has(tag.id))
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
      <div className="relative">
        <button
          ref={anchorRef}
          data-testid="overview-tags-new"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-border-strong px-2.5 py-1 font-body text-[11px] font-medium text-text-muted hover:border-accent hover:text-accent"
        >
          <Plus size={10} strokeWidth={2} />
          New tag
        </button>
        {menuOpen ? (
          <NewTagPopover
            caseId={caseId}
            tags={tags}
            anchorRef={anchorRef}
            onClose={() => setMenuOpen(false)}
            onCreated={(tag) => setCreatedIds((ids) => new Set(ids).add(tag.id))}
          />
        ) : null}
      </div>
    </div>
  )
}
