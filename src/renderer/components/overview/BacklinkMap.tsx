import { useMemo, useState } from 'react'
import { ChevronRight, Link as LinkIcon } from 'lucide-react'
import type { NoteReferenceEdge } from '@shared/types'
import {
  computeBacklinkMap,
  nodeTypeColor,
  MAP_LEGEND_TYPES,
  type BacklinkMapLabels,
  type MapNodeType,
  type MapNoteInput
} from '@renderer/components/overview/backlinkMapModel'

interface BacklinkMapProps {
  notes: MapNoteInput[]
  edges: NoteReferenceEdge[]
  labels: BacklinkMapLabels
  onOpenNote: (noteId: string) => void
  onAllNotes: () => void
}

const EMPTY_COPY: Record<'no-notes' | 'no-mentions', string> = {
  'no-notes': 'No notes in this case yet.',
  'no-mentions': 'No Mentions to map yet.'
}

/**
 * The Overview's link map: Notes down the centre lane, mentioned entities in
 * the flanking columns, dashed edges for references and solid for Note-to-Note
 * Backlinks. A pure render over the note-references index — all geometry lives
 * in backlinkMapModel, this holds only the three pieces of interaction state.
 *
 * Filtering ghosts a type rather than removing it: the node stays on the
 * lattice at low opacity and keeps its place in the count, so the chips can
 * never make the map claim the case holds less than it does.
 */
export function BacklinkMap({ notes, edges, labels, onOpenNote, onAllNotes }: BacklinkMapProps) {
  const [focus, setFocus] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [typesOff, setTypesOff] = useState<Partial<Record<MapNodeType, boolean>>>({})

  const model = useMemo(
    () => computeBacklinkMap({ notes, edges, labels, focus, hover, typesOff }),
    [notes, edges, labels, focus, hover, typesOff]
  )

  const toggleType = (type: MapNodeType) => {
    const next = { ...typesOff, [type]: !typesOff[type] }
    setTypesOff(next)
    setHover(null)
    const focused = model.nodes.find((n) => n.key === focus)
    if (focused && next[focused.type]) setFocus(null)
  }

  return (
    <div
      data-testid="overview-link-map"
      className="flex min-h-0 flex-1 flex-col rounded-[var(--d-r)] border border-border bg-card p-[var(--d-card)]"
    >
      <div className="mb-2.5 flex items-center gap-2">
        <LinkIcon size={13} strokeWidth={1.8} className="shrink-0 text-text-faint" />
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.06em] text-text-faint">
          Link map
        </span>
        <span
          data-testid="overview-map-count"
          className="truncate font-mono text-[10px] text-text-faint"
        >
          {model.countLabel}
        </span>
        <span className="flex-1" />
        {focus ? (
          <button
            data-testid="overview-map-clear-focus"
            onClick={() => setFocus(null)}
            className="inline-flex shrink-0 items-center font-display text-[11px] font-semibold text-accent"
          >
            Clear focus
          </button>
        ) : null}
        <button
          onClick={onAllNotes}
          className="inline-flex shrink-0 items-center gap-1 font-display text-[11px] font-semibold text-text-muted hover:text-text-secondary"
        >
          All notes
          <ChevronRight size={12} strokeWidth={1.8} />
        </button>
      </div>

      <div
        data-testid="overview-map-canvas"
        className="relative min-h-[220px] flex-1 overflow-hidden rounded-md border border-border"
        style={{
          background: 'color-mix(in srgb, var(--color-text-primary) 5%, var(--color-canvas))',
          backgroundImage:
            'radial-gradient(color-mix(in srgb, var(--color-text-primary) 10%, transparent) 1px, transparent 1px)',
          backgroundSize: '14px 14px'
        }}
      >
        {model.isEmpty ? (
          <p
            data-testid="overview-map-empty"
            className="absolute inset-0 grid place-items-center px-4 text-center font-body text-xs text-text-faint"
          >
            {EMPTY_COPY[model.emptyReason ?? 'no-notes']}
          </p>
        ) : (
          <>
            {/* preserveAspectRatio="none" stretches the 0-100 space to the card,
                so the stroke has to opt out of scaling or it distorts with it. */}
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
            >
              {model.edges.map((edge) => (
                <path
                  key={edge.key}
                  data-testid="overview-map-edge"
                  data-edge-kind={edge.kind}
                  d={edge.d}
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                  stroke={edge.stroke}
                  strokeWidth={edge.strokeWidth}
                  strokeDasharray={edge.strokeDasharray}
                  opacity={edge.opacity}
                />
              ))}
            </svg>
            {model.nodes.map((node) => (
              <button
                key={node.key}
                data-testid="overview-map-node"
                data-node-type={node.type}
                data-node-key={node.key}
                title={node.full}
                aria-pressed={focus === node.key}
                onClick={() => setFocus(focus === node.key ? null : node.key)}
                onDoubleClick={() => {
                  if (node.isNote) onOpenNote(node.id)
                }}
                onMouseEnter={() => setHover(node.key)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(node.key)}
                onBlur={() => setHover(null)}
                className="absolute flex max-w-[118px] -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border py-1 pl-2 pr-2.5 font-body shadow-[var(--shadow-card)] transition-[opacity,background-color,border-color] duration-150"
                style={{
                  left: node.left,
                  top: node.top,
                  opacity: node.opacity,
                  pointerEvents: node.pointerEvents,
                  background: node.background,
                  borderColor: node.borderColor
                }}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: node.dot }}
                />
                <span
                  className="min-w-0 truncate text-text-primary"
                  style={{ fontSize: node.fontSize, fontWeight: node.fontWeight }}
                >
                  {node.label}
                </span>
              </button>
            ))}
          </>
        )}
        <div className="absolute bottom-2.5 left-2.5 flex items-center gap-2 font-body text-[10px] text-text-faint">
          {MAP_LEGEND_TYPES.map((type) => {
            const off = !!typesOff[type]
            return (
              <button
                key={type}
                data-testid={`overview-map-legend-${type}`}
                aria-pressed={off}
                title={off ? `Show ${type} nodes` : `Hide ${type} nodes`}
                onClick={() => toggleType(type)}
                className={`inline-flex items-center gap-1 text-[10px] text-text-faint ${
                  off ? 'line-through opacity-[.55]' : ''
                }`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: off ? 'var(--color-border-strong)' : nodeTypeColor(type) }}
                />
                {type}
              </button>
            )
          })}
          <span className="truncate">click to focus · double-click to open</span>
        </div>
      </div>
    </div>
  )
}
