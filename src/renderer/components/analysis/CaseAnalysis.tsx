import { useState, useEffect } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import { EntityGraph } from './EntityGraph'
import { InsightsPanel } from './InsightsPanel'
import { EntityTimeline } from './EntityTimeline'
import type { EntityGraph as EntityGraphData, CaseAnalysisResult } from '@shared/types'

export function CaseAnalysis() {
  const { activeCaseId } = useAppStore()
  const [graph, setGraph] = useState<EntityGraphData | null>(null)
  const [analysis, setAnalysis] = useState<CaseAnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)

  useEffect(() => {
    if (!activeCaseId) return
    setLoading(true)
    Promise.all([
      window.birdbrain.ai.buildGraph(activeCaseId),
      window.birdbrain.ai.getAnalysis(activeCaseId)
    ]).then(([g, a]) => {
      setGraph(g)
      setAnalysis(a)
    }).catch((err) => {
      console.error('Failed to load analysis data:', err)
    }).finally(() => {
      setLoading(false)
    })
  }, [activeCaseId])

  const handleAnalyze = async () => {
    if (!activeCaseId) return
    setAnalyzing(true)
    try {
      const result = await window.birdbrain.ai.analyzeCase(activeCaseId)
      setAnalysis(result)
    } catch (err) {
      console.error('Analysis failed:', err)
    } finally {
      setAnalyzing(false)
    }
  }

  if (loading) return <div className="text-neutral-500">Loading...</div>

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-100">Case Analysis</h1>
        <button
          onClick={handleAnalyze}
          disabled={analyzing}
          className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
        >
          {analyzing ? 'Analyzing...' : analysis ? 'Re-analyze Case' : 'Analyze Case'}
        </button>
      </div>

      {/* Entity Graph */}
      {graph && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-neutral-200">Entity Graph</h2>
          <EntityGraph graph={graph} />
        </div>
      )}

      {/* Entity Timeline */}
      {graph && graph.nodes.length > 0 && <EntityTimeline nodes={graph.nodes} />}

      {/* AI Insights */}
      {analysis && <InsightsPanel analysis={analysis} />}

      {!analysis && !analyzing && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-center">
          <p className="text-neutral-400">
            Click "Analyze Case" to generate AI-powered insights about entity relationships and patterns.
          </p>
          <p className="mt-1 text-xs text-neutral-600">
            This sends entity data to OpenRouter and uses API tokens.
          </p>
        </div>
      )}
    </div>
  )
}
