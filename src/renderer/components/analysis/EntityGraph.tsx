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
