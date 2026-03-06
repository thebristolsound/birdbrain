import type { EntityNode } from '@shared/types'

interface EntityTimelineProps {
  nodes: EntityNode[]
}

export function EntityTimeline({ nodes }: EntityTimelineProps) {
  if (nodes.length === 0) return null

  const sorted = [...nodes].sort((a, b) => a.firstSeen.localeCompare(b.firstSeen))
  const earliest = sorted[0].firstSeen
  const latest = sorted.reduce((max, n) => (n.lastSeen > max ? n.lastSeen : max), earliest)

  const timeRange = new Date(latest).getTime() - new Date(earliest).getTime()
  if (timeRange === 0) return null

  const getPosition = (timestamp: string) => {
    return ((new Date(timestamp).getTime() - new Date(earliest).getTime()) / timeRange) * 100
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-neutral-200">Entity Timeline</h3>
      <div className="space-y-1">
        {sorted.slice(0, 20).map((node) => {
          const startPos = getPosition(node.firstSeen)
          const endPos = getPosition(node.lastSeen)
          const width = Math.max(endPos - startPos, 1)
          return (
            <div key={`${node.type}::${node.value}`} className="flex items-center gap-2">
              <span className="w-32 shrink-0 truncate text-xs text-neutral-400" title={node.value}>
                {node.value}
              </span>
              <div className="relative h-4 flex-1 rounded bg-neutral-800">
                <div
                  className="absolute h-full rounded bg-amber-600/40"
                  style={{ left: `${startPos}%`, width: `${width}%` }}
                  title={`${new Date(node.firstSeen).toLocaleDateString()} — ${new Date(node.lastSeen).toLocaleDateString()}`}
                />
              </div>
              <span className="w-6 shrink-0 text-right text-xs text-neutral-600">{node.occurrences}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-neutral-600">
        <span>{new Date(earliest).toLocaleDateString()}</span>
        <span>{new Date(latest).toLocaleDateString()}</span>
      </div>
    </div>
  )
}
