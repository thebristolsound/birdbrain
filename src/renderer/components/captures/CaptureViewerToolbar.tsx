import { useState } from 'react'
import {
  Hand,
  MousePointer2,
  Square,
  ArrowRight,
  Highlighter,
  EyeOff,
  MapPin,
  Minus,
  Plus,
  Eye,
  Undo2,
  Redo2,
  Trash2
} from 'lucide-react'
import type { AnnotationTool } from '@renderer/components/captures/annotation/useAnnotationEditor'

interface Props {
  tool: AnnotationTool
  setTool: (t: AnnotationTool) => void
  color: string
  setColor: (c: string) => void
  strokeWidth: number
  setStrokeWidth: (w: number) => void
  scale: number
  zoomIn: () => void
  zoomOut: () => void
  fit: () => void
  oneToOne: () => void
  overlayVisible: boolean
  setOverlayVisible: (next: boolean) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  selectedId: string | null
  onDeleteSelected: () => void
}

const NAV_TOOLS: Array<{ key: AnnotationTool; label: string; Icon: typeof Square }> = [
  { key: 'hand', label: 'Hand tool', Icon: Hand },
  { key: 'select', label: 'Select', Icon: MousePointer2 }
]

const DRAW_TOOLS: Array<{ key: AnnotationTool; label: string; Icon: typeof Square }> = [
  { key: 'rect', label: 'Rectangle', Icon: Square },
  { key: 'arrow', label: 'Arrow', Icon: ArrowRight },
  { key: 'highlight', label: 'Highlight', Icon: Highlighter },
  { key: 'redact', label: 'Redact', Icon: EyeOff },
  { key: 'pin', label: 'Pin', Icon: MapPin }
]

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#000000', '#ffffff']

const DRAW_KEYS = new Set<AnnotationTool>(['rect', 'arrow', 'highlight', 'redact', 'pin'])

const OVERLAY_SHADOW = { boxShadow: 'var(--shadow-overlay)' }

function toolButtonClass(active: boolean): string {
  return [
    'h-8 w-8 rounded-lg flex items-center justify-center transition-colors',
    active
      ? 'bg-accent-subtle text-accent'
      : 'text-text-muted hover:bg-elevated hover:text-text-primary'
  ].join(' ')
}

function Separator() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
}

export function CaptureViewerToolbar({
  tool,
  setTool,
  color,
  setColor,
  strokeWidth,
  setStrokeWidth,
  scale,
  zoomIn,
  zoomOut,
  fit,
  oneToOne,
  overlayVisible,
  setOverlayVisible,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  selectedId,
  onDeleteSelected
}: Props) {
  const [styleOpen, setStyleOpen] = useState(false)
  const drawing = DRAW_KEYS.has(tool)
  const panelOpen = drawing || styleOpen
  const editVisible = drawing
  const eyeDisabled = drawing
  const EyeIcon = overlayVisible ? Eye : EyeOff

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex flex-col items-center gap-2 px-3">
      {panelOpen && (
        <div
          className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-3 rounded-xl border border-border-strong bg-card px-3 py-2"
          style={OVERLAY_SHADOW}
        >
          <span className="text-[11px] font-semibold text-text-muted">Style</span>
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
                    selected ? 'ring-2 ring-accent ring-offset-1 ring-offset-card' : ''
                  ].join(' ')}
                  style={{ backgroundColor: c }}
                />
              )
            })}
          </div>
          <span aria-hidden className="h-5 w-px bg-border" />
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            <span>Stroke</span>
            <input
              type="range"
              min={1}
              max={10}
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
              className="w-20 accent-accent"
            />
            <span className="w-4 text-right tabular-nums text-text-secondary">{strokeWidth}</span>
          </label>
        </div>
      )}

      <div
        className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-y-1 rounded-2xl border border-border-strong bg-card p-1.5"
        style={OVERLAY_SHADOW}
      >
        {NAV_TOOLS.map(({ key, label, Icon }) => {
          const active = tool === key
          return (
            <button
              key={key}
              type="button"
              aria-label={label}
              aria-pressed={active}
              onClick={() => setTool(active && key === 'hand' ? 'select' : key)}
              className={toolButtonClass(active)}
            >
              <Icon size={16} />
            </button>
          )
        })}

        <Separator />

        {DRAW_TOOLS.map(({ key, label, Icon }) => {
          const active = tool === key
          return (
            <button
              key={key}
              type="button"
              aria-label={label}
              aria-current={active ? 'true' : undefined}
              onClick={() => setTool(key)}
              className={toolButtonClass(active)}
            >
              <Icon size={16} />
            </button>
          )
        })}

        <Separator />

        <button
          type="button"
          aria-label="Color & stroke"
          aria-pressed={panelOpen}
          onClick={() => setStyleOpen((s) => !s)}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-text-muted transition-colors hover:bg-elevated hover:text-text-primary"
        >
          <span
            className="h-4 w-4 rounded-full border-2 border-card"
            style={{ backgroundColor: color, boxShadow: '0 0 0 1px var(--color-border-strong)' }}
          />
        </button>

        <Separator />

        <button
          type="button"
          aria-label="Zoom out"
          onClick={zoomOut}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-elevated hover:text-text-primary"
        >
          <Minus size={16} />
        </button>
        <span className="min-w-[3.5rem] text-center text-xs text-text-muted tabular-nums">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={zoomIn}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-elevated hover:text-text-primary"
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          onClick={fit}
          className="h-8 rounded-lg px-2 text-xs text-text-muted hover:bg-elevated hover:text-text-primary"
        >
          Fit
        </button>
        <button
          type="button"
          onClick={oneToOne}
          className="h-8 rounded-lg px-2 text-xs text-text-muted hover:bg-elevated hover:text-text-primary"
        >
          1:1
        </button>

        <Separator />

        <button
          type="button"
          aria-label={overlayVisible ? 'Hide annotations' : 'Show annotations'}
          aria-pressed={!overlayVisible}
          aria-disabled={eyeDisabled}
          onClick={() => {
            if (eyeDisabled) return
            setOverlayVisible(!overlayVisible)
          }}
          title={
            eyeDisabled
              ? 'Switch to the cursor tool to hide annotations'
              : overlayVisible
                ? 'Hide annotations'
                : 'Show annotations'
          }
          className={[
            'h-8 w-8 rounded-lg flex items-center justify-center transition-colors',
            eyeDisabled
              ? 'text-text-faint opacity-50 cursor-not-allowed'
              : 'text-text-muted hover:bg-elevated hover:text-text-primary'
          ].join(' ')}
        >
          <EyeIcon size={16} />
        </button>

        {editVisible && (
          <>
            <Separator />
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
            <button
              type="button"
              aria-label="Delete selected shape"
              title="Delete selected (Del/Backspace)"
              onClick={onDeleteSelected}
              disabled={!selectedId}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-elevated hover:text-text-primary disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
