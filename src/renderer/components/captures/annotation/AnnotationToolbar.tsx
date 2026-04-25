import type { AnnotationTool } from './useAnnotationEditor'
import {
  Square,
  ArrowRight,
  Highlighter,
  EyeOff,
  MapPin,
  MousePointer2,
  Undo2,
  Redo2
} from 'lucide-react'

interface Props {
  tool: AnnotationTool
  setTool: (t: AnnotationTool) => void
  color: string
  setColor: (c: string) => void
  strokeWidth: number
  setStrokeWidth: (w: number) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

const TOOLS: Array<{ key: AnnotationTool; label: string; Icon: typeof Square }> = [
  { key: 'select', label: 'Select', Icon: MousePointer2 },
  { key: 'rect', label: 'Rectangle', Icon: Square },
  { key: 'arrow', label: 'Arrow', Icon: ArrowRight },
  { key: 'highlight', label: 'Highlight', Icon: Highlighter },
  { key: 'redact', label: 'Redact', Icon: EyeOff },
  { key: 'pin', label: 'Pin', Icon: MapPin }
]

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#000000', '#ffffff']

export function AnnotationToolbar({
  tool,
  setTool,
  color,
  setColor,
  strokeWidth,
  setStrokeWidth,
  canUndo,
  canRedo,
  onUndo,
  onRedo
}: Props) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface px-2 py-1">
      {TOOLS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          aria-label={label}
          onClick={() => setTool(key)}
          className={[
            'rounded px-2 py-1 hover:bg-canvas',
            tool === key ? 'bg-canvas text-accent' : 'text-text-primary'
          ].join(' ')}
        >
          <Icon size={16} />
        </button>
      ))}
      <div className="ml-2 flex items-center gap-1">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            onClick={() => setColor(c)}
            className={[
              'h-5 w-5 rounded border',
              c === color ? 'border-accent ring-2 ring-accent' : 'border-border'
            ].join(' ')}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <label className="ml-2 flex items-center gap-1 text-xs text-text-muted">
        <span>Stroke</span>
        <input
          type="range"
          min={1}
          max={10}
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(Number(e.target.value))}
          className="w-20"
        />
        <span>{strokeWidth}</span>
      </label>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          aria-label="Undo"
          onClick={onUndo}
          disabled={!canUndo}
          className="rounded p-1 text-text-primary hover:bg-canvas disabled:opacity-40"
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          aria-label="Redo"
          onClick={onRedo}
          disabled={!canRedo}
          className="rounded p-1 text-text-primary hover:bg-canvas disabled:opacity-40"
        >
          <Redo2 size={16} />
        </button>
      </div>
    </div>
  )
}
