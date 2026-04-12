import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { tagsQueryOptions, tagUsageCountsForCaseQueryOptions } from '@renderer/lib/queries'
import { TagManager } from './TagManager'
import { Card } from '@renderer/components/ui'

export function TagsOverview() {
  const { caseId } = useParams({ from: '/cases/$caseId/tags' })
  const { data: tags = [], isLoading } = useQuery(tagsQueryOptions)
  const { data: usageCounts = {} } = useQuery(tagUsageCountsForCaseQueryOptions(caseId))

  if (isLoading) {
    return <div className="text-text-muted">Loading tags...</div>
  }

  // Sort tags by usage in this case (desc), then by name.
  const sorted = [...tags].sort((a, b) => {
    const countDiff = (usageCounts[b.id] ?? 0) - (usageCounts[a.id] ?? 0)
    if (countDiff !== 0) return countDiff
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-8 py-6 pb-16">
      <TagManager />

      <Card data-testid="tags-usage-table" className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-display text-sm font-semibold text-text-primary">
            Tag Usage in This Case
          </h3>
          <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-semibold text-accent">
            {sorted.filter((t) => (usageCounts[t.id] ?? 0) > 0).length}
          </span>
        </div>
        {sorted.length === 0 ? (
          <p className="px-5 py-4 text-sm text-text-muted">
            No tags yet. Create one above to get started.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-[11px] uppercase tracking-wider text-text-muted">
                <th className="w-12 px-4 py-2 font-medium">Color</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="w-32 px-4 py-2 font-medium text-right">Usage in Case</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((tag) => (
                <tr
                  key={tag.id}
                  data-testid="tag-usage-row"
                  className="border-b border-border last:border-b-0"
                >
                  <td className="px-4 py-2">
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: tag.color || '#f59e0b' }}
                    />
                  </td>
                  <td className="px-4 py-2 text-text-primary">{tag.name}</td>
                  <td
                    data-testid={`tag-usage-count-${tag.name}`}
                    className="px-4 py-2 text-right font-mono text-text-secondary"
                  >
                    {usageCounts[tag.id] ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
