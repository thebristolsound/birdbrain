# Analysis Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Analysis tab to a professional split-panel layout with an enhanced entity graph (glowing nodes, grid, zoom/layout controls, type filtering) on the left and a rich AI Insights sidebar on the right.

**Architecture:** The Analysis tab becomes a horizontal split layout — a flex-1 left panel containing the entity graph with toolbar/legend/zoom controls, and a fixed-width 380px right sidebar for AI insights. The graph gets interactive features (type filtering, zoom, layout switching) via new state, and the insights panel is restructured into sections (Summary, Clusters, Timeline, Recommendations) with styled cards. All new components follow the existing OLED dark mode design system (slate palette, indigo accents, `white/[0.06]` borders).

**Tech Stack:** React 19, Tailwind CSS v4, Zustand 5, d3-force, lucide-react

**Design reference:** SuperDesign draft `e57422fb-4e99-49fb-972e-73d7df36706b` (Project `0ee09075-9ca1-4004-a3e4-701a561e82bf`)

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/renderer/components/analysis/GraphToolbar.tsx` | Toolbar above graph: title, node/edge count, Fullscreen/Export SVG/Re-analyze buttons |
| `src/renderer/components/analysis/GraphLegend.tsx` | Filterable entity-type legend strip with active/inactive chips and counts |
| `src/renderer/components/analysis/GraphZoomControls.tsx` | Zoom slider, center/fit-to-view, layout switcher (Force/Radial/Hierarchy) |

### Modified files

| File | Changes |
|------|---------|
| `src/renderer/components/analysis/CaseAnalysis.tsx` | Complete rewrite → split-panel layout orchestrator with graph state (zoom, layout, active filters) |
| `src/renderer/components/analysis/EntityGraph.tsx` | Enhanced SVG: grid pattern, glow effects on nodes, edge opacity scaling, filter support, zoom/pan, layout modes |
| `src/renderer/components/analysis/InsightsPanel.tsx` | Complete rewrite → right sidebar with sections: Summary, Clusters, Timeline, Recommendations, footer |
| `src/renderer/components/analysis/EntityTimeline.tsx` | Rewrite → vertical dot-connected timeline for use inside InsightsPanel (replaces horizontal bar chart) |
| `src/renderer/styles/globals.css` | Add graph node glow keyframes, graph-specific utility classes |

| `src/renderer/components/cases/CaseWorkspace.tsx` | Minor change: render analysis tab like captures tab (no `overflow-auto p-6` wrapper) so CaseAnalysis can fill the full height |

### Unchanged files (context only)

| File | Why |
|------|-----|
| `src/renderer/stores/appStore.ts` | No store changes needed — graph state is local to CaseAnalysis |
| `src/shared/types.ts` | `EntityGraph`, `EntityNode`, `EntityEdge`, `CaseAnalysisResult` types already support the design |

---

## Task 1: Add CSS utilities for graph glow effects

**Files:**
- Modify: `src/renderer/styles/globals.css`

This task adds the CSS keyframes and utility classes needed by the graph nodes for glow/pulse effects.

- [ ] **Step 1: Add graph glow keyframes and node classes to globals.css**

Append after the existing `.test-active` rule at the end of the file:

```css
/* Entity graph node effects */
@keyframes glowPulse {
  0%, 100% { filter: drop-shadow(0 0 6px var(--glow-color)); }
  50% { filter: drop-shadow(0 0 12px var(--glow-color)); }
}

@keyframes nodePulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

.graph-node { transition: filter 0.2s ease; }
.graph-node:hover { animation: nodePulse 1s ease-in-out infinite; cursor: pointer; }

.graph-edge { stroke-linecap: round; }

.legend-chip { transition: all 0.15s ease; cursor: pointer; }

.cluster-card { transition: all 0.15s ease; }
.cluster-card:hover { background: #263244; }
```

- [ ] **Step 2: Verify the dev server picks up CSS changes**

Run: `pnpm dev` (if not already running) and confirm no build errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/globals.css
git commit -m "feat(analysis): add CSS utilities for graph glow and interaction effects"
```

---

## Task 2: Create GraphToolbar component

**Files:**
- Create: `src/renderer/components/analysis/GraphToolbar.tsx`

The toolbar sits above the graph canvas. It shows the graph title, node/edge counts, and action buttons (Fullscreen, Export SVG, Re-analyze).

- [ ] **Step 1: Create GraphToolbar.tsx**

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/analysis/GraphToolbar.tsx
git commit -m "feat(analysis): create GraphToolbar component with action buttons"
```

---

## Task 3: Create GraphLegend component

**Files:**
- Create: `src/renderer/components/analysis/GraphLegend.tsx`

A horizontal strip of filterable entity-type chips. Each chip shows the type name, colored dot, and count. Clicking toggles the filter on/off.

- [ ] **Step 1: Create GraphLegend.tsx**

```tsx
import type { EntityNode, EntityType } from '@shared/types'

const TYPE_COLORS: Record<string, string> = {
  person: '#f59e0b',
  organization: '#38bdf8',
  email: '#22c55e',
  phone: '#a855f7',
  domain: '#ec4899',
  ip_address: '#ef4444',
  address: '#14b8a6',
  date: '#f97316',
  username: '#6366f1',
  crypto_wallet: '#eab308',
  custom: '#737373'
}

const TYPE_LABELS: Record<string, string> = {
  person: 'Person',
  organization: 'Org',
  email: 'Email',
  phone: 'Phone',
  domain: 'Domain',
  ip_address: 'IP',
  address: 'Address',
  date: 'Date',
  username: 'Username',
  crypto_wallet: 'Crypto',
  custom: 'Custom'
}

interface GraphLegendProps {
  nodes: EntityNode[]
  activeTypes: Set<EntityType>
  onToggleType: (type: EntityType) => void
}

export function GraphLegend({ nodes, activeTypes, onToggleType }: GraphLegendProps) {
  const typeCounts = new Map<EntityType, number>()
  for (const node of nodes) {
    typeCounts.set(node.type, (typeCounts.get(node.type) || 0) + 1)
  }

  return (
    <div className="flex shrink-0 items-center border-b border-white/[0.06] bg-slate-900 px-5 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
          Filter:
        </span>
        {Array.from(typeCounts.entries()).map(([type, count]) => {
          const isActive = activeTypes.has(type)
          return (
            <button
              key={type}
              onClick={() => onToggleType(type)}
              className={`legend-chip inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-medium ${
                isActive
                  ? 'border-indigo-400/35 bg-indigo-500/12 font-semibold text-indigo-200'
                  : 'border-white/[0.08] bg-white/[0.04] text-slate-300'
              }`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: TYPE_COLORS[type] || '#737373' }}
              />
              {TYPE_LABELS[type] || type}
              <span className={`text-[9px] ${isActive ? 'opacity-60' : 'text-slate-500'}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export { TYPE_COLORS, TYPE_LABELS }
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/analysis/GraphLegend.tsx
git commit -m "feat(analysis): create GraphLegend filterable entity-type strip"
```

---

## Task 4: Create GraphZoomControls component

**Files:**
- Create: `src/renderer/components/analysis/GraphZoomControls.tsx`

A bottom bar with zoom slider (-/+), center/fit-to-view actions, and a layout mode switcher (Force/Radial/Hierarchy).

- [ ] **Step 1: Create GraphZoomControls.tsx**

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/analysis/GraphZoomControls.tsx
git commit -m "feat(analysis): create GraphZoomControls with zoom slider and layout switcher"
```

---

## Task 5: Enhance EntityGraph with glow effects, grid, and filtering

**Files:**
- Modify: `src/renderer/components/analysis/EntityGraph.tsx`

Major enhancement: SVG grid background, node glow effects colored by entity type, variable edge opacity, support for type filtering, and zoom transform.

- [ ] **Step 1: Rewrite EntityGraph.tsx**

Replace the entire file:

```tsx
import { useEffect, useRef, useState } from 'react'
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force'
import type { EntityGraph as EntityGraphData, EntityNode, EntityType } from '@shared/types'
import { TYPE_COLORS } from './GraphLegend'

interface EntityGraphProps {
  graph: EntityGraphData
  activeTypes: Set<EntityType>
  zoom: number
  onNodeClick?: (node: EntityNode) => void
}

interface SimNode {
  id: string
  node: EntityNode
  x: number
  y: number
}

interface SimLink {
  source: string | SimNode
  target: string | SimNode
  weight: number
}

const GLOW_INTENSITY: Record<string, string> = {
  person: 'rgba(245,158,11,0.5)',
  organization: 'rgba(56,189,248,0.5)',
  email: 'rgba(34,197,94,0.5)',
  phone: 'rgba(168,85,247,0.5)',
  domain: 'rgba(236,72,153,0.5)',
  ip_address: 'rgba(239,68,68,0.5)',
  address: 'rgba(20,184,166,0.5)',
  date: 'rgba(249,115,22,0.5)',
  username: 'rgba(99,102,241,0.5)',
  crypto_wallet: 'rgba(234,179,8,0.5)',
  custom: 'rgba(115,115,115,0.3)'
}

export function EntityGraph({ graph, activeTypes, zoom, onNodeClick }: EntityGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [nodes, setNodes] = useState<SimNode[]>([])
  const [links, setLinks] = useState<SimLink[]>([])
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null)
  const [dimensions, setDimensions] = useState({ width: 900, height: 520 })

  useEffect(() => {
    if (!svgRef.current?.parentElement) return
    const rect = svgRef.current.parentElement.getBoundingClientRect()
    if (rect.width > 0) {
      setDimensions({ width: rect.width, height: Math.max(400, rect.height) })
    }
  }, [])

  useEffect(() => {
    const filteredNodes = graph.nodes.filter((n) => activeTypes.has(n.type))
    if (filteredNodes.length === 0) {
      setNodes([])
      setLinks([])
      return
    }

    const nodeIds = new Set(filteredNodes.map((n) => n.value))

    const simNodes: SimNode[] = filteredNodes.map((n) => ({
      id: n.value,
      node: n,
      x: dimensions.width / 2 + (Math.random() - 0.5) * 100,
      y: dimensions.height / 2 + (Math.random() - 0.5) * 100
    }))

    const simLinks: SimLink[] = graph.edges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        weight: e.weight
      }))

    const sim = forceSimulation(simNodes as any)
      .force('link', forceLink(simLinks as any).id((d: any) => d.id).distance(80))
      .force('charge', forceManyBody().strength(-200))
      .force('center', forceCenter(dimensions.width / 2, dimensions.height / 2))
      .force('collide', forceCollide().radius(20))

    sim.on('tick', () => {
      setNodes([...simNodes])
      setLinks([...simLinks])
    })

    return () => { sim.stop() }
  }, [graph, activeTypes, dimensions])

  if (graph.nodes.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-500">
        No entities to visualize. Extract entities from captures first.
      </div>
    )
  }

  const maxOccurrences = Math.max(...graph.nodes.map((n) => n.occurrences), 1)
  const scale = zoom / 100

  return (
    <div className="relative flex-1 overflow-hidden bg-slate-900">
      <svg
        ref={svgRef}
        className="entity-graph-svg h-full w-full"
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid */}
        <defs>
          <pattern id="analysis-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#analysis-grid)" />

        <g transform={`scale(${scale}) translate(${(1 - scale) * dimensions.width / 2 / scale}, ${(1 - scale) * dimensions.height / 2 / scale})`}>
          {/* Edges */}
          {links.map((link, i) => {
            const s = link.source as SimNode
            const t = link.target as SimNode
            if (!s.x || !t.x) return null
            return (
              <line
                key={i}
                className="graph-edge"
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke="rgba(255,255,255,0.12)"
                strokeWidth={Math.min(link.weight, 4)}
                strokeOpacity={0.2 + Math.min(link.weight / 10, 0.4)}
              />
            )
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const radius = 6 + (node.node.occurrences / maxOccurrences) * 16
            const color = TYPE_COLORS[node.node.type] || '#737373'
            const glow = GLOW_INTENSITY[node.node.type] || 'rgba(115,115,115,0.3)'
            const isHovered = hoveredNode?.id === node.id
            return (
              <g
                key={node.id}
                className="graph-node"
                style={{
                  filter: isHovered
                    ? `drop-shadow(0 0 14px ${glow}) brightness(1.2)`
                    : `drop-shadow(0 0 8px ${glow})`
                }}
              >
                {/* Outer glow ring */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={radius + 4}
                  fill={color}
                  opacity={0.12}
                />
                {/* Main node */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={radius}
                  fill={color}
                  opacity={0.9}
                  stroke={isHovered ? '#fff' : 'transparent'}
                  strokeWidth={isHovered ? 2 : 0}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredNode(node)}
                  onMouseLeave={() => setHoveredNode(null)}
                  onClick={() => onNodeClick?.(node.node)}
                />
                {/* Label */}
                {radius > 10 && (
                  <text
                    x={node.x}
                    y={node.y + 3}
                    textAnchor="middle"
                    fill="white"
                    fontSize={Math.min(radius * 0.6, 8)}
                    fontWeight={600}
                    fontFamily="var(--font-body)"
                    className="pointer-events-none"
                  >
                    {node.node.value.length > 8
                      ? node.node.value.slice(0, 6) + '..'
                      : node.node.value}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      {/* Hover tooltip */}
      {hoveredNode && (
        <div className="pointer-events-none absolute left-4 top-4 max-w-[220px] rounded-xl border border-white/[0.08] bg-slate-800 p-3 shadow-lg">
          <div className="mb-2 flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: TYPE_COLORS[hoveredNode.node.type] || '#737373' }}
            />
            <span className="text-[11px] font-semibold text-slate-100">
              {hoveredNode.node.value}
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-500">Type</span>
              <span className="font-medium text-slate-300">{hoveredNode.node.type}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-500">Occurrences</span>
              <span className="font-medium text-slate-300">
                {hoveredNode.node.occurrences} capture{hoveredNode.node.occurrences !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-500">Connections</span>
              <span className="font-medium text-slate-300">
                {hoveredNode.node.captureIds.length} capture{hoveredNode.node.captureIds.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-500">First seen</span>
              <span className="font-mono text-slate-400">
                {new Date(hoveredNode.node.firstSeen).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/analysis/EntityGraph.tsx
git commit -m "feat(analysis): enhance EntityGraph with glow effects, grid, type filtering, and zoom"
```

---

## Task 6: Rewrite EntityTimeline as vertical dot-connected timeline

**Files:**
- Modify: `src/renderer/components/analysis/EntityTimeline.tsx`

Replaces the horizontal bar-chart timeline with a vertical dot-connected list for use inside the InsightsPanel.

- [ ] **Step 1: Rewrite EntityTimeline.tsx**

Replace the entire file:

```tsx
interface TimelineEntry {
  observation: string
  significance: string
}

interface EntityTimelineProps {
  entries: TimelineEntry[]
}

const DOT_STYLES = [
  'bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.4)]',
  'bg-purple-400 shadow-[0_0_6px_rgba(167,139,250,0.3)]',
  'bg-indigo-500 shadow-[0_0_6px_rgba(99,102,241,0.3)]'
]

const DATE_STYLES = [
  'text-indigo-400',
  'text-purple-400',
  'text-indigo-500'
]

export function EntityTimeline({ entries }: EntityTimelineProps) {
  if (entries.length === 0) return null

  return (
    <div className="space-y-3">
      {entries.map((entry, i) => {
        const dotStyle = DOT_STYLES[i % DOT_STYLES.length]
        const dateStyle = DATE_STYLES[i % DATE_STYLES.length]
        const isLast = i === entries.length - 1
        return (
          <div key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={`mt-1.5 h-2 w-2 rounded-full ${dotStyle}`} />
              {!isLast && <div className="w-px flex-1 bg-indigo-400/20" />}
            </div>
            <div className={isLast ? '' : 'pb-3'}>
              <span className={`font-mono text-[10px] font-medium ${dateStyle}`}>
                {entry.significance}
              </span>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                {entry.observation}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/analysis/EntityTimeline.tsx
git commit -m "feat(analysis): rewrite EntityTimeline as vertical dot-connected list"
```

---

## Task 7: Rewrite InsightsPanel as right sidebar

**Files:**
- Modify: `src/renderer/components/analysis/InsightsPanel.tsx`

Complete rewrite into a 380px sidebar with sections: Summary, Clusters (with colored left borders and entity badges), Timeline, Recommendations, and a footer with copy-to-clipboard.

- [ ] **Step 1: Rewrite InsightsPanel.tsx**

Replace the entire file:

```tsx
import {
  Sparkles,
  MoreVertical,
  FileText,
  GitBranch,
  Clock,
  Lightbulb,
  ChevronRight,
  CheckCircle,
  AlertTriangle,
  Compass,
  ClipboardCopy
} from 'lucide-react'
import type { CaseAnalysisResult } from '@shared/types'
import { EntityTimeline } from './EntityTimeline'

interface InsightsPanelProps {
  analysis: CaseAnalysisResult | null
  analyzing: boolean
  lastAnalyzedAt?: string
}

const CLUSTER_BORDERS = [
  'border-l-[3px] border-l-amber-500',
  'border-l-[3px] border-l-yellow-500',
  'border-l-[3px] border-l-red-500',
  'border-l-[3px] border-l-indigo-500',
  'border-l-[3px] border-l-emerald-500'
]

const CLUSTER_DOTS = [
  'bg-amber-500',
  'bg-yellow-500',
  'bg-red-500',
  'bg-indigo-500',
  'bg-emerald-500'
]

const BADGE_STYLES: Record<string, string> = {
  person: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  organization: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  email: 'bg-green-500/10 text-green-400 border-green-500/20',
  phone: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  domain: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  ip_address: 'bg-red-500/10 text-red-400 border-red-500/20',
  address: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  date: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  username: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
  crypto_wallet: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  custom: 'bg-slate-500/10 text-slate-400 border-slate-500/20'
}

const SUGGESTION_ICONS: Record<string, { icon: typeof CheckCircle; styles: string }> = {
  action: {
    icon: CheckCircle,
    styles: 'bg-emerald-500/[0.06] border-emerald-500/[0.12]'
  },
  warning: {
    icon: AlertTriangle,
    styles: 'bg-amber-500/[0.06] border-amber-500/[0.12]'
  },
  explore: {
    icon: Compass,
    styles: 'bg-indigo-500/[0.06] border-indigo-500/[0.12]'
  }
}

function getSuggestionConfig(type: string) {
  return SUGGESTION_ICONS[type] || SUGGESTION_ICONS.explore
}

export function InsightsPanel({ analysis, analyzing, lastAnalyzedAt }: InsightsPanelProps) {
  const handleCopy = () => {
    if (!analysis) return
    const text = [
      analysis.summary,
      '',
      'Clusters:',
      ...analysis.clusters.map((c) => `- ${c.name}: ${c.summary}`),
      '',
      'Timeline:',
      ...analysis.timeline.map((t) => `- ${t.observation} (${t.significance})`),
      '',
      'Suggestions:',
      ...analysis.suggestions.map((s) => `- [${s.type}] ${s.description}`)
    ].join('\n')
    navigator.clipboard.writeText(text)
  }

  return (
    <aside className="flex w-[380px] shrink-0 flex-col overflow-hidden border-l border-white/[0.06] bg-slate-900/70">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-100">AI Insights</h3>
            <span className="text-[10px] text-slate-600">
              {analyzing
                ? 'Analyzing…'
                : lastAnalyzedAt
                  ? `Last analyzed ${lastAnalyzedAt}`
                  : 'Not yet analyzed'}
            </span>
          </div>
        </div>
        <button className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-white/[0.05] hover:text-slate-300">
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {!analysis && !analyzing && (
          <div className="rounded-xl border border-white/[0.06] bg-slate-800/50 p-6 text-center">
            <p className="text-sm text-slate-400">
              Click "Re-analyze" to generate AI-powered insights about entity relationships and patterns.
            </p>
            <p className="mt-1 text-xs text-slate-600">
              This sends entity data to OpenRouter and uses API tokens.
            </p>
          </div>
        )}

        {analyzing && (
          <div className="flex items-center justify-center py-12">
            <div className="text-sm text-slate-400">Analyzing case data…</div>
          </div>
        )}

        {analysis && (
          <>
            {/* Summary */}
            {analysis.summary && (
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-indigo-400" />
                  <h4 className="font-display text-xs font-semibold uppercase tracking-wider text-slate-100">
                    Summary
                  </h4>
                </div>
                <div className="rounded-xl border border-indigo-500/15 bg-indigo-500/[0.08] p-4">
                  <p className="text-xs leading-relaxed text-slate-300">{analysis.summary}</p>
                </div>
              </div>
            )}

            {/* Clusters */}
            {analysis.clusters.length > 0 && (
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <GitBranch className="h-3.5 w-3.5 text-indigo-400" />
                  <h4 className="font-display text-xs font-semibold uppercase tracking-wider text-slate-100">
                    Identified Clusters
                  </h4>
                  <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-bold text-indigo-300">
                    {analysis.clusters.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {analysis.clusters.map((cluster, i) => (
                    <div
                      key={i}
                      className={`cluster-card cursor-pointer rounded-xl border border-white/[0.06] bg-slate-800 p-3.5 ${
                        CLUSTER_BORDERS[i % CLUSTER_BORDERS.length]
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${CLUSTER_DOTS[i % CLUSTER_DOTS.length]}`} />
                          <span className="text-xs font-semibold text-slate-100">{cluster.name}</span>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
                      </div>
                      <p className="mb-2.5 text-[11px] leading-relaxed text-slate-400">
                        {cluster.summary}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {cluster.entities.map((entity, j) => {
                          const badgeStyle = BADGE_STYLES.custom
                          return (
                            <span
                              key={j}
                              className={`rounded border px-2 py-0.5 text-[9px] font-semibold ${badgeStyle}`}
                            >
                              {entity}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Timeline */}
            {analysis.timeline.length > 0 && (
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-indigo-400" />
                  <h4 className="font-display text-xs font-semibold uppercase tracking-wider text-slate-100">
                    Timeline
                  </h4>
                </div>
                <EntityTimeline entries={analysis.timeline} />
              </div>
            )}

            {/* Recommendations */}
            {analysis.suggestions.length > 0 && (
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <Lightbulb className="h-3.5 w-3.5 text-indigo-400" />
                  <h4 className="font-display text-xs font-semibold uppercase tracking-wider text-slate-100">
                    Recommendations
                  </h4>
                </div>
                <div className="space-y-2">
                  {analysis.suggestions.map((suggestion, i) => {
                    const config = getSuggestionConfig(suggestion.type)
                    const Icon = config.icon
                    return (
                      <div
                        key={i}
                        className={`flex items-start gap-2.5 rounded-xl border p-3 ${config.styles}`}
                      >
                        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-current opacity-70" />
                        <p className="text-[11px] leading-relaxed text-slate-300">
                          {suggestion.description}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {analysis && (
        <div className="shrink-0 border-t border-white/[0.06] bg-slate-900/70 px-5 py-3">
          <button
            onClick={handleCopy}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-2.5 text-[11px] font-semibold text-indigo-300 transition-colors hover:border-indigo-500/30 hover:bg-indigo-500/[0.18]"
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
            Copy Insights to Clipboard
          </button>
        </div>
      )}
    </aside>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/analysis/InsightsPanel.tsx
git commit -m "feat(analysis): rewrite InsightsPanel as rich sidebar with clusters, timeline, and recommendations"
```

---

## Task 8: Update CaseWorkspace to give Analysis tab full-bleed layout

**Files:**
- Modify: `src/renderer/components/cases/CaseWorkspace.tsx`

The analysis tab needs to fill the entire content area without padding or overflow-auto, similar to how the captures tab already gets special treatment. This avoids the fragile negative-margin hack.

- [ ] **Step 1: Update CaseWorkspace tab content rendering**

In `CaseWorkspace.tsx`, change the tab content section to give the analysis tab the same full-bleed treatment as captures. Replace the else branch (lines 96-103):

```tsx
      ) : activeCaseTab === 'analysis' ? (
        <div className="flex flex-1 overflow-hidden">
          <CaseAnalysis />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          {activeCaseTab === 'overview' && <CaseOverview />}
          {activeCaseTab === 'entities' && <CaseEntities />}
          {activeCaseTab === 'selectors' && <SelectorsOverview />}
        </div>
      )}
```

This removes `overflow-auto` and `p-6` from the analysis tab wrapper, letting `CaseAnalysis` manage its own layout.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/cases/CaseWorkspace.tsx
git commit -m "feat(analysis): give analysis tab full-bleed layout in CaseWorkspace"
```

---

## Task 9: Rewrite CaseAnalysis as split-panel layout orchestrator

**Files:**
- Modify: `src/renderer/components/analysis/CaseAnalysis.tsx`

The main orchestrator now holds graph state (zoom, layout, active type filters) and renders the split-panel layout: left panel (GraphToolbar + GraphLegend + EntityGraph + GraphZoomControls), right panel (InsightsPanel).

- [ ] **Step 1: Rewrite CaseAnalysis.tsx**

Replace the entire file:

```tsx
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
    // Export SVG from the graph - find the SVG element in the EntityGraph
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
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/analysis/CaseAnalysis.tsx
git commit -m "feat(analysis): rewrite CaseAnalysis as split-panel layout with graph controls and insights sidebar"
```

---

## Task 10: Visual verification and polish

**Files:**
- All analysis files from previous tasks

This task is a manual check to ensure the new layout renders correctly, all interactions work, and styling matches the design.

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`

- [ ] **Step 2: Navigate to a case with entities and open the Analysis tab**

Verify:
1. Split layout renders — graph panel on left, insights panel (380px) on right
2. GraphToolbar shows correct node/edge counts, Re-analyze button works
3. GraphLegend chips are clickable and filter the graph nodes
4. Graph nodes have colored glow effects and grid background is visible
5. GraphZoomControls slider adjusts zoom, layout buttons are clickable
6. InsightsPanel shows Summary/Clusters/Timeline/Recommendations when analysis data exists
7. "Copy Insights to Clipboard" button works
8. The analysis tab fills the full content area (no extra padding from parent — handled by Task 8 CaseWorkspace change)

- [ ] **Step 3: Fix any layout issues found during verification**

Common issues to check:
- If the graph panel is not filling height, ensure `flex-1` and `h-full` work with the parent `flex flex-1 overflow-hidden` wrapper from CaseWorkspace
- If fonts look wrong, ensure `font-display` and `font-body` CSS custom properties resolve correctly
- If glow effects are too intense or missing, adjust the `GLOW_INTENSITY` opacity values in EntityGraph

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(analysis): polish layout and visual issues from verification"
```

---

## Summary of changes

| Component | Before | After |
|-----------|--------|-------|
| **CaseAnalysis** | Single-column vertical stack | Horizontal split: graph (flex-1) + insights sidebar (380px) |
| **EntityGraph** | Plain SVG with basic circles | Grid background, glowing type-colored nodes, outer rings, zoom transform, type filtering |
| **InsightsPanel** | Simple stacked cards | Rich sidebar with sections: Summary (indigo card), Clusters (colored borders + badges), Timeline (dot-connected), Recommendations (color-coded by type), copy footer |
| **EntityTimeline** | Horizontal bar chart | Vertical dot-connected timeline with alternating colors |
| **New: GraphToolbar** | — | Toolbar with node/edge counts, Fullscreen, Export SVG, Re-analyze |
| **New: GraphLegend** | — | Filterable entity-type chip strip |
| **New: GraphZoomControls** | — | Zoom slider, center/fit, layout mode switcher |
