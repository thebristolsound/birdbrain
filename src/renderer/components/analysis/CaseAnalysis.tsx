import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import { EntityGraph } from './EntityGraph'
import { InsightsPanel } from './InsightsPanel'
import { GraphToolbar } from './GraphToolbar'
import { GraphLegend } from './GraphLegend'
import { GraphZoomControls } from './GraphZoomControls'
import type { GraphLayout } from './GraphZoomControls'
import type { EntityGraph as EntityGraphData, CaseAnalysisResult, EntityType } from '@shared/types'

export function CaseAnalysis() {
  const { activeCaseId } = useAppStore()

  // Data state
  const [graph, setGraph] = useState<EntityGraphData | null>(null)
  const [analysis, setAnalysis] = useState<CaseAnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)

  // Graph interaction state
  const [zoom, setZoom] = useState(100)
  const [layout, setLayout] = useState<GraphLayout>('force')
  const [activeTypes, setActiveTypes] = useState<Set<EntityType>>(new Set())

  useEffect(() => {
    if (!activeCaseId) return
    setLoading(true)
    Promise.all([
      window.birdbrain.ai.buildGraph(activeCaseId),
      window.birdbrain.ai.getAnalysis(activeCaseId)
    ])
      .then(([g, a]) => {
        setGraph(g)
        setAnalysis(a)
        if (g) {
          const types = new Set(g.nodes.map((n) => n.type))
          setActiveTypes(types)
        }
      })
      .catch((err) => {
        console.error('Failed to load analysis data:', err)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [activeCaseId])

  const handleAnalyze = useCallback(async () => {
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
  }, [activeCaseId])

  const handleToggleType = useCallback((type: EntityType) => {
    setActiveTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }, [])

  const handleCenter = useCallback(() => {
    setZoom(100)
  }, [])

  const handleFitToView = useCallback(() => {
    setZoom(100)
  }, [])

  const handleExportSvg = useCallback(() => {
    const svg = document.querySelector('.entity-graph-svg') as SVGSVGElement | null
    if (!svg) return
    const serializer = new XMLSerializer()
    const svgStr = serializer.serializeToString(svg)
    const blob = new Blob([svgStr], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'entity-graph.svg'
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const handleFullscreen = useCallback(() => {
    const graphEl = document.querySelector('.analysis-graph-panel') as HTMLElement | null
    if (!graphEl) return
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      graphEl.requestFullscreen()
    }
  }, [])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500">Loading…</div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Entity Graph */}
      <div className="analysis-graph-panel flex flex-1 flex-col overflow-hidden">
        <GraphToolbar
          nodeCount={graph ? graph.nodes.filter((n) => activeTypes.has(n.type)).length : 0}
          edgeCount={graph ? graph.edges.length : 0}
          analyzing={analyzing}
          onReanalyze={handleAnalyze}
          onExportSvg={handleExportSvg}
          onFullscreen={handleFullscreen}
        />

        {graph && graph.nodes.length > 0 && (
          <GraphLegend
            nodes={graph.nodes}
            activeTypes={activeTypes}
            onToggleType={handleToggleType}
          />
        )}

        {graph ? (
          <EntityGraph
            graph={graph}
            activeTypes={activeTypes}
            zoom={zoom}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-slate-500">
            No graph data available. Extract entities from captures first.
          </div>
        )}

        <GraphZoomControls
          zoom={zoom}
          layout={layout}
          onZoomChange={setZoom}
          onCenter={handleCenter}
          onFitToView={handleFitToView}
          onLayoutChange={setLayout}
        />
      </div>

      {/* Right: AI Insights */}
      <InsightsPanel
        analysis={analysis}
        analyzing={analyzing}
      />
    </div>
  )
}
