import { Maximize2, Download, RefreshCw } from 'lucide-react'

interface GraphToolbarProps {
  nodeCount: number
  edgeCount: number
  analyzing: boolean
  onReanalyze: () => void
  onExportSvg: () => void
  onFullscreen: () => void
}

export function GraphToolbar({
  nodeCount,
  edgeCount,
  analyzing,
  onReanalyze,
  onExportSvg,
  onFullscreen
}: GraphToolbarProps) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] bg-slate-900 px-5 py-3">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-sm font-semibold text-slate-100">Entity Graph</h2>
        <div className="h-4 w-px bg-white/[0.08]" />
        <span className="text-[11px] text-slate-500">
          {nodeCount} nodes · {edgeCount} edges
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onFullscreen}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-slate-400 transition-all hover:border-white/[0.12] hover:bg-white/[0.08] hover:text-slate-100"
        >
          <Maximize2 className="h-3 w-3" />
          Fullscreen
        </button>
        <button
          onClick={onExportSvg}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-slate-400 transition-all hover:border-white/[0.12] hover:bg-white/[0.08] hover:text-slate-100"
        >
          <Download className="h-3 w-3" />
          Export SVG
        </button>
        <button
          onClick={onReanalyze}
          disabled={analyzing}
          className="glow-indigo-btn flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${analyzing ? 'animate-spin' : ''}`} />
          {analyzing ? 'Analyzing…' : 'Re-analyze'}
        </button>
      </div>
    </div>
  )
}
