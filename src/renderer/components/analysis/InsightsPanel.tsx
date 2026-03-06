import type { CaseAnalysisResult } from '@shared/types'

interface InsightsPanelProps {
  analysis: CaseAnalysisResult
}

export function InsightsPanel({ analysis }: InsightsPanelProps) {
  return (
    <div className="space-y-6">
      {/* Summary */}
      {analysis.summary && (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-4">
          <h3 className="mb-2 text-sm font-semibold text-amber-500">Summary</h3>
          <p className="text-sm text-neutral-300">{analysis.summary}</p>
        </div>
      )}

      {/* Clusters */}
      {analysis.clusters.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-neutral-200">Entity Clusters</h3>
          <div className="space-y-2">
            {analysis.clusters.map((cluster, i) => (
              <div key={i} className="rounded border border-neutral-800 bg-neutral-900 p-3">
                <div className="font-medium text-neutral-200">{cluster.name}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {cluster.entities.map((e, j) => (
                    <span key={j} className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                      {e}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-sm text-neutral-400">{cluster.summary}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline observations */}
      {analysis.timeline.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-neutral-200">Timeline Observations</h3>
          <div className="space-y-2">
            {analysis.timeline.map((t, i) => (
              <div key={i} className="rounded border border-neutral-800 bg-neutral-900 p-3">
                <div className="text-sm text-neutral-300">{t.observation}</div>
                <div className="mt-1 text-xs text-neutral-500">{t.significance}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {analysis.suggestions.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-neutral-200">Suggestions</h3>
          <div className="space-y-2">
            {analysis.suggestions.map((s, i) => (
              <div key={i} className="rounded border border-neutral-800 bg-neutral-900 p-3">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-amber-600/20 px-2 py-0.5 text-xs text-amber-500">{s.type}</span>
                  <span className="text-sm text-neutral-300">{s.description}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
