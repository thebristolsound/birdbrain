import { useEffect, useState } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import { useCaptures } from '@renderer/hooks/useCaptures'
import { ExportDialog } from '@renderer/components/export/ExportDialog'
import { SelectorList } from '@renderer/components/selectors/SelectorList'
import type { Case } from '@shared/types'

export function CaseOverview() {
  const activeCaseId = useAppStore((s) => s.activeCaseId)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const { captures } = useCaptures(activeCaseId)
  const [caseData, setCaseData] = useState<Case | null>(null)
  const [showExport, setShowExport] = useState(false)

  useEffect(() => {
    if (activeCaseId) {
      window.birdbrain.cases.get(activeCaseId).then((c) => setCaseData(c ?? null))
    }
  }, [activeCaseId])

  if (!caseData) {
    return <div className="text-neutral-500">Loading case...</div>
  }

  // Compute top domains
  const domainCounts: Record<string, number> = {}
  for (const cap of captures) {
    try {
      const domain = new URL(cap.url).hostname
      domainCounts[domain] = (domainCounts[domain] || 0) + 1
    } catch {
      // skip invalid URLs
    }
  }
  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  const dateRange =
    captures.length > 0
      ? {
          first: captures[captures.length - 1].timestamp,
          last: captures[0].timestamp
        }
      : null

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-100">{caseData.name}</h1>
        {caseData.description && <p className="mt-1 text-neutral-400">{caseData.description}</p>}
        {dateRange && (
          <p className="mt-1 font-mono text-xs text-neutral-600">
            {new Date(dateRange.first).toLocaleDateString()} — {new Date(dateRange.last).toLocaleDateString()}
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-2xl font-bold text-neutral-100">{captures.length}</div>
          <div className="text-sm text-neutral-400">Captures</div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-2xl font-bold text-neutral-100">{topDomains.length}</div>
          <div className="text-sm text-neutral-400">Domains</div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-2xl font-bold text-neutral-100">0</div>
          <div className="text-sm text-neutral-400">Entities</div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('analysis')}
          className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
        >
          Analyze Case
        </button>
        <button
          onClick={() => setShowExport(true)}
          className="rounded border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
        >
          Export
        </button>
      </div>

      {showExport && caseData && (
        <ExportDialog caseId={caseData.id} caseName={caseData.name} onClose={() => setShowExport(false)} />
      )}

      {/* Selectors */}
      {activeCaseId && <SelectorList caseId={activeCaseId} />}

      {/* Top Domains */}
      {topDomains.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-neutral-200">Top Domains</h2>
          <div className="space-y-2">
            {topDomains.map(([domain, count]) => (
              <div key={domain} className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-900 px-3 py-2">
                <span className="font-mono text-sm text-neutral-300">{domain}</span>
                <span className="text-sm text-neutral-500">{count} capture{count !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Capture Timeline */}
      {captures.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-neutral-200">Capture Timeline</h2>
          <div className="flex h-8 gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-900">
            {captures.slice(0, 50).map((cap) => (
              <div
                key={cap.id}
                className="flex-1 bg-amber-600/60 hover:bg-amber-500"
                title={`${cap.title}\n${new Date(cap.timestamp).toLocaleString()}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
