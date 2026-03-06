import { useEffect, useRef, useState } from 'react'
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force'
import type { EntityGraph as EntityGraphData, EntityNode } from '@shared/types'

interface EntityGraphProps {
  graph: EntityGraphData
  onNodeClick?: (node: EntityNode) => void
}

const TYPE_COLORS: Record<string, string> = {
  person: '#f59e0b',
  organization: '#3b82f6',
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

export function EntityGraph({ graph, onNodeClick }: EntityGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [nodes, setNodes] = useState<SimNode[]>([])
  const [links, setLinks] = useState<SimLink[]>([])
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null)
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 })

  useEffect(() => {
    if (!svgRef.current) return
    const rect = svgRef.current.parentElement?.getBoundingClientRect()
    if (rect) setDimensions({ width: rect.width, height: Math.max(400, rect.height) })
  }, [])

  useEffect(() => {
    if (graph.nodes.length === 0) return

    const simNodes: SimNode[] = graph.nodes.map((n) => ({
      id: n.value,
      node: n,
      x: dimensions.width / 2 + (Math.random() - 0.5) * 100,
      y: dimensions.height / 2 + (Math.random() - 0.5) * 100
    }))

    const simLinks: SimLink[] = graph.edges.map((e) => ({
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
  }, [graph, dimensions])

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-neutral-500">
        No entities to visualize. Extract entities from captures first.
      </div>
    )
  }

  const maxOccurrences = Math.max(...graph.nodes.map((n) => n.occurrences), 1)

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        width="100%"
        height={dimensions.height}
        className="rounded border border-neutral-800 bg-neutral-900"
      >
        {/* Edges */}
        {links.map((link, i) => {
          const s = link.source as SimNode
          const t = link.target as SimNode
          if (!s.x || !t.x) return null
          return (
            <line
              key={i}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke="#404040"
              strokeWidth={Math.min(link.weight, 5)}
              strokeOpacity={0.6}
            />
          )
        })}
        {/* Nodes */}
        {nodes.map((node) => {
          const radius = 6 + (node.node.occurrences / maxOccurrences) * 14
          const color = TYPE_COLORS[node.node.type] || '#737373'
          return (
            <g key={node.id}>
              <circle
                cx={node.x}
                cy={node.y}
                r={radius}
                fill={color}
                fillOpacity={0.8}
                stroke={hoveredNode?.id === node.id ? '#fff' : color}
                strokeWidth={hoveredNode?.id === node.id ? 2 : 1}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredNode(node)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => onNodeClick?.(node.node)}
              />
              {radius > 10 && (
                <text
                  x={node.x}
                  y={node.y + radius + 12}
                  textAnchor="middle"
                  fill="#a3a3a3"
                  fontSize={10}
                  className="pointer-events-none"
                >
                  {node.node.value.length > 15 ? node.node.value.slice(0, 15) + '...' : node.node.value}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Hover tooltip */}
      {hoveredNode && (
        <div className="absolute left-4 top-4 rounded border border-neutral-700 bg-neutral-800 p-3 shadow-lg">
          <div className="text-sm font-medium text-neutral-200">{hoveredNode.node.value}</div>
          <div className="mt-1 text-xs text-neutral-400">
            Type: {hoveredNode.node.type} | Seen {hoveredNode.node.occurrences}x in {hoveredNode.node.captureIds.length} capture(s)
          </div>
          <div className="mt-0.5 font-mono text-xs text-neutral-500">
            {new Date(hoveredNode.node.firstSeen).toLocaleDateString()} — {new Date(hoveredNode.node.lastSeen).toLocaleDateString()}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-2 flex flex-wrap gap-3">
        {Object.entries(TYPE_COLORS)
          .filter(([type]) => graph.nodes.some((n) => n.type === type))
          .map(([type, color]) => (
            <div key={type} className="flex items-center gap-1 text-xs text-neutral-500">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
              {type}
            </div>
          ))}
      </div>
    </div>
  )
}
