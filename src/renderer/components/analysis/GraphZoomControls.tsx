import { Minus, Plus, Crosshair, Scan } from 'lucide-react'

export type GraphLayout = 'force' | 'radial' | 'hierarchy'

interface GraphZoomControlsProps {
  zoom: number
  layout: GraphLayout
  onZoomChange: (zoom: number) => void
  onCenter: () => void
  onFitToView: () => void
  onLayoutChange: (layout: GraphLayout) => void
}

const layouts: { id: GraphLayout; label: string }[] = [
  { id: 'force', label: 'Force' },
  { id: 'radial', label: 'Radial' },
  { id: 'hierarchy', label: 'Hierarchy' }
]

export function GraphZoomControls({
  zoom,
  layout,
  onZoomChange,
  onCenter,
  onFitToView,
  onLayoutChange
}: GraphZoomControlsProps) {
  return (
    <div className="flex shrink-0 items-center gap-4 border-t border-white/[0.06] bg-black/50 px-5 py-2.5">
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => onZoomChange(Math.max(10, zoom - 10))}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-100"
        >
          <Minus className="h-3 w-3" />
        </button>
        <input
          type="range"
          min={10}
          max={200}
          value={zoom}
          onChange={(e) => onZoomChange(Number(e.target.value))}
          className="w-28 accent-indigo-500"
        />
        <button
          onClick={() => onZoomChange(Math.min(200, zoom + 10))}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-100"
        >
          <Plus className="h-3 w-3" />
        </button>
        <span className="w-10 text-center font-mono text-[11px] font-medium text-slate-400">
          {zoom}%
        </span>
      </div>

      <div className="h-5 w-px bg-white/[0.08]" />

      <button
        onClick={onCenter}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-slate-300"
      >
        <Crosshair className="h-3 w-3" />
        Center
      </button>
      <button
        onClick={onFitToView}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-slate-300"
      >
        <Scan className="h-3 w-3" />
        Fit to View
      </button>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-[10px] text-slate-600">Layout:</span>
        <div className="flex overflow-hidden rounded-lg border border-white/[0.08]">
          {layouts.map((l, i) => (
            <button
              key={l.id}
              onClick={() => onLayoutChange(l.id)}
              className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${
                i < layouts.length - 1 ? 'border-r border-white/[0.08]' : ''
              } ${
                layout === l.id
                  ? 'bg-indigo-500/15 font-semibold text-indigo-300'
                  : 'text-slate-500 hover:bg-white/[0.05] hover:text-slate-300'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
