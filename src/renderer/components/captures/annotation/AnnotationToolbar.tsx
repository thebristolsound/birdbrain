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

function Separator() {
  return <span aria-hidden className="w-px h-5 bg-border" />
}

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
    <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-1.5">
      {TOOLS.map(({ key, label, Icon }) => {
        const active = tool === key
        return (
          <button
            key={key}
            type="button"
            aria-label={label}
            aria-current={active ? 'true' : undefined}
            onClick={() => setTool(key)}
            className={[
              'h-8 w-8 rounded-lg flex items-center justify-center transition-colors',
              active
                ? 'bg-accent-subtle text-accent'
                : 'text-text-muted hover:bg-elevated hover:text-text-primary'
            ].join(' ')}
          >
            <Icon size={16} />
          </button>
        )
      })}

      <Separator />

      <div className="flex items-center gap-1.5">
        {COLORS.map((c) => {
          const selected = c === color
          return (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              aria-current={selected ? 'true' : undefined}
              onClick={() => setColor(c)}
              className={[
                'h-5 w-5 rounded-full border border-border transition-shadow',
                selected ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface' : ''
              ].join(' ')}
              style={{ backgroundColor: c }}
            />
          )
        })}
      </div>

      <Separator />

      <label className="flex items-center gap-1.5 text-xs text-text-muted">
        <span>Stroke</span>
        <input
          type="range"
          min={1}
          max={10}
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(Number(e.target.value))}
          className="w-20"
        />
        <span className="tabular-nums w-4 text-right">{strokeWidth}</span>
      </label>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          aria-label="Undo"
          onClick={onUndo}
          disabled={!canUndo}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-elevated hover:text-text-primary disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          aria-label="Redo"
          onClick={onRedo}
          disabled={!canRedo}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-elevated hover:text-text-primary disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Redo2 size={16} />
        </button>
      </div>
    </div>
  )
}
