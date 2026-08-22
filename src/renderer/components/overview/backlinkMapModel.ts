import type { MentionTargetType, NoteReferenceEdge } from '@shared/types'

/**
 * Geometry and visual state for the Overview backlink map (#402), kept pure and
 * out of the component: every branch here — the node ceiling, the lattice
 * collision search, label truncation, the opacity ladder — is directly
 * testable, and none of it needs a DOM.
 *
 * The map is a render over the note-references index, which is derived state
 * rewritten inside the transaction of every note-body write. It is never a
 * source of truth about a case, and nothing here writes.
 */

/** Notes always survive the cap; the busiest entities fill what is left. */
export const NODE_CAP = 20
export const MAP_COLS = 3
/** Floor, not a fixed height — the lattice grows when the case needs more rows. */
export const MAP_ROWS = 8
/** Longer labels middle-truncate; the untruncated string stays on `full`. */
export const LABEL_MAX = 22

export type MapNodeType = MentionTargetType

export interface MapNoteInput {
  id: string
  title: string
}

/**
 * Display names for mention targets, resolved by the caller against the cached
 * `captures:list` / `selectors:list` / `tags:list` queries rather than in SQL
 * (maintainer ruling 2026-08-21). A target absent from its map is one the case
 * no longer holds — a dangling reference, drawn rather than dropped.
 */
export type BacklinkMapLabels = Partial<Record<MentionTargetType, Record<string, string>>>

export interface BacklinkMapInput {
  notes: MapNoteInput[]
  edges: NoteReferenceEdge[]
  labels?: BacklinkMapLabels
  focus?: string | null
  hover?: string | null
  typesOff?: Partial<Record<MapNodeType, boolean>>
}

export interface MapNode {
  key: string
  /** The note or target id behind the node. */
  id: string
  type: MapNodeType
  isNote: boolean
  /** Middle-truncated for the pill. */
  label: string
  /** Untruncated, for the title attribute. */
  full: string
  x: number
  y: number
  left: string
  top: string
  opacity: number
  pointerEvents: 'auto' | 'none'
  dot: string
  background: string
  borderColor: string
  fontSize: string
  fontWeight: string
}

export type MapEdgeKind = 'ref' | 'backlink'

export interface MapEdge {
  key: string
  a: string
  b: string
  kind: MapEdgeKind
  /** Quadratic Bezier in the 0-100 viewBox space. */
  d: string
  stroke: string
  strokeWidth: number
  strokeDasharray: string
  opacity: number
}

export type MapEmptyReason = 'no-notes' | 'no-mentions'

export interface BacklinkMapModel {
  nodes: MapNode[]
  edges: MapEdge[]
  /** Nodes drawn, after the ceiling. */
  nodeCount: number
  /** Nodes before the ceiling. Equal to `nodeCount` when nothing was dropped. */
  totalNodes: number
  capped: boolean
  backlinkCount: number
  /** The header string, e.g. `showing 20 of 26 nodes · 3 backlinks`. */
  countLabel: string
  isEmpty: boolean
  emptyReason: MapEmptyReason | null
}

const TYPE_COLORS: Record<MapNodeType, string> = {
  note: 'var(--color-accent)',
  capture: '#f59e0b',
  selector: '#0ea5e9',
  tag: '#ec4899'
}

/** Fixed legend order — the chips ghost a type, they never hide it. */
export const MAP_LEGEND_TYPES: MapNodeType[] = ['note', 'capture', 'selector', 'tag']

export function nodeTypeColor(type: MapNodeType): string {
  return TYPE_COLORS[type]
}

export function truncateLabel(label: string): string {
  return label.length > LABEL_MAX ? `${label.slice(0, 11)}…${label.slice(-10)}` : label
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

interface WorkNode {
  key: string
  id: string
  type: MapNodeType
  isNote: boolean
  full: string
  x: number
  y: number
}

interface WorkEdge {
  key: string
  a: string
  b: string
  kind: MapEdgeKind
}

const emptyModel = (reason: MapEmptyReason): BacklinkMapModel => ({
  nodes: [],
  edges: [],
  nodeCount: 0,
  totalNodes: 0,
  capped: false,
  backlinkCount: 0,
  countLabel: '0 nodes · 0 backlinks',
  isEmpty: true,
  emptyReason: reason
})

function labelFor(
  labels: BacklinkMapLabels,
  targetType: MentionTargetType,
  targetId: string
): string {
  return labels[targetType]?.[targetId] || `(missing ${targetType})`
}

/**
 * Seed positions on an ellipse before the lattice snap. These coordinates never
 * reach the DOM: they only decide which side of the canvas an entity prefers
 * and roughly which row, so a note's own mentions fan out around it instead of
 * queueing in id order.
 */
function seedPositions(
  notes: MapNoteInput[],
  outgoing: Map<string, NoteReferenceEdge[]>,
  labels: BacklinkMapLabels,
  noteIds: Set<string>
): { nodes: WorkNode[]; edges: WorkEdge[] } {
  const nodes: WorkNode[] = []
  const edges: WorkEdge[] = []
  const seen = new Set<string>()
  const backlinkPairs = new Set<string>()
  const noteAngle = (i: number) => ((-90 + (i * 360) / notes.length) * Math.PI) / 180

  notes.forEach((note, i) => {
    const a = noteAngle(i)
    nodes.push({
      key: `note:${note.id}`,
      id: note.id,
      type: 'note',
      isNote: true,
      full: note.title || '(Untitled note)',
      x: 50 + Math.cos(a) * 13,
      y: 50 + Math.sin(a) * 17
    })
    seen.add(`note:${note.id}`)
  })

  notes.forEach((note, i) => {
    const a = noteAngle(i)
    const outs = outgoing.get(note.id) ?? []
    outs.forEach((out, j) => {
      const { targetType, targetId } = out
      // A mention of another note in this case is a Backlink between two note
      // nodes, not a third node. A mention of a note the case no longer holds
      // has no second endpoint, so it draws as an entity like any other.
      if (targetType === 'note' && noteIds.has(targetId)) {
        if (targetId === note.id) return
        const [p0, p1] = [`note:${note.id}`, `note:${targetId}`].sort()
        const pair = `${p0}|${p1}`
        if (backlinkPairs.has(pair)) return
        backlinkPairs.add(pair)
        edges.push({ key: `backlink:${pair}`, a: p0, b: p1, kind: 'backlink' })
        return
      }
      const key = `ent:${targetType}:${targetId}`
      if (!seen.has(key)) {
        seen.add(key)
        const spread = (j - (outs.length - 1) / 2) * 0.78
        const ea = a + spread
        const rx = 41 + (j % 2) * 5
        const ry = 33 + (j % 2) * 6
        nodes.push({
          key,
          id: targetId,
          type: targetType,
          isNote: false,
          full: labelFor(labels, targetType, targetId),
          x: clamp(50 + Math.cos(ea) * rx, 14, 86),
          y: clamp(50 + Math.sin(ea) * ry, 9, 90)
        })
      }
      edges.push({ key: `ref:${note.id}|${key}`, a: `note:${note.id}`, b: key, kind: 'ref' })
    })
  })

  return { nodes, edges }
}

/**
 * Apply the node ceiling. Notes are never dropped, so a case with more than
 * NODE_CAP notes shows all of them and no entities. Entities are ranked by edge
 * degree, ties broken by key so two runs over the same data drop the same ones.
 */
function applyCap(nodes: WorkNode[], edges: WorkEdge[]): { nodes: WorkNode[]; edges: WorkEdge[] } {
  if (nodes.length <= NODE_CAP) return { nodes, edges }
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.a, (degree.get(edge.a) ?? 0) + 1)
    degree.set(edge.b, (degree.get(edge.b) ?? 0) + 1)
  }
  const noteCount = nodes.filter((n) => n.isNote).length
  const ranked = nodes
    .filter((n) => !n.isNote)
    .sort((a, b) => (degree.get(b.key) ?? 0) - (degree.get(a.key) ?? 0) || a.key.localeCompare(b.key))
  const dropped = new Set(ranked.slice(Math.max(0, NODE_CAP - noteCount)).map((n) => n.key))
  return {
    nodes: nodes.filter((n) => !dropped.has(n.key)),
    edges: edges.filter((e) => !dropped.has(e.a) && !dropped.has(e.b))
  }
}

/**
 * How many rows the lattice needs. The mock fixes it at 8, which breaks twice:
 * past three notes its `1 + noteIndex * 3` piles every further note on the last
 * row, and with few notes the ceiling admits more entities than the two
 * flanking columns hold. Growing the lattice keeps one node per cell in both
 * directions — the property the snap exists to guarantee.
 */
export function rowsFor(noteCount: number, entityCount: number): number {
  return Math.max(MAP_ROWS, noteCount, Math.ceil(entityCount / 2))
}

/**
 * Row for the nth note down the centre lane. At three notes or fewer this is
 * the mock's own placement (rows 1, 4, 7); above it the notes spread over the
 * whole lane instead of stacking on the last row.
 */
export function noteRow(index: number, noteCount: number, rows: number): number {
  if (noteCount <= 3) return clamp(1 + index * 3, 0, rows - 1)
  return clamp(Math.round((index * (rows - 1)) / (noteCount - 1)), 0, rows - 1)
}

/** Snap every node onto its own lattice cell; notes take the centre column. */
function snapToLattice(nodes: WorkNode[], rows: number): void {
  const taken = new Set<string>()
  const cellX = (c: number) => ((c + 0.5) / MAP_COLS) * 100
  const cellY = (r: number) => ((r + 0.5) / rows) * 100
  const notes = nodes.filter((n) => n.isNote)
  const entities = nodes.filter((n) => !n.isNote)
  const noteCount = notes.length

  notes.forEach((node, i) => {
    let row = noteRow(i, noteCount, rows)
    // Two notes can still want one row once the row count is clamped; take the
    // next free row down the lane rather than overlapping.
    while (taken.has(`1,${row}`) && row < rows - 1) row++
    while (taken.has(`1,${row}`) && row > 0) row--
    taken.add(`1,${row}`)
    node.x = cellX(1)
    node.y = cellY(row)
  })

  entities.forEach((node) => {
    let col = node.x < 50 ? 0 : 2
    let row = clamp(Math.round((node.y / 100) * rows - 0.5), 0, rows - 1)
    if (taken.has(`${col},${row}`)) {
      let best: [number, number] | null = null
      let bestD = Infinity
      for (const c of [0, 2]) {
        for (let r = 0; r < rows; r++) {
          if (taken.has(`${c},${r}`)) continue
          const d = (c - col) * (c - col) * 4 + (r - row) * (r - row)
          if (d < bestD) {
            bestD = d
            best = [c, r]
          }
        }
      }
      if (best) [col, row] = best
    }
    taken.add(`${col},${row}`)
    node.x = cellX(col)
    node.y = cellY(row)
  })
}

function edgePath(a: WorkNode, b: WorkNode, kind: MapEdgeKind): string {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  // Bow away from the centre so a Backlink arcs clear of the notes it joins.
  const outward = ((mx - 50) * -dy) / len + ((my - 50) * dx) / len >= 0 ? 1 : -1
  const bow = (kind === 'backlink' ? 34 : 4) * outward
  const cx = mx - (dy / len) * bow
  const cy = my + (dx / len) * bow
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`
}

export function computeBacklinkMap({
  notes,
  edges: refEdges,
  labels = {},
  focus = null,
  hover = null,
  typesOff = {}
}: BacklinkMapInput): BacklinkMapModel {
  // The mock divides by `notes.length` to fan the lattice out, so zero notes
  // yields NaN coordinates rather than an empty map. Guarded here.
  if (notes.length === 0) return emptyModel('no-notes')

  const noteIds = new Set(notes.map((n) => n.id))
  const outgoing = new Map<string, NoteReferenceEdge[]>()
  // Sorted defensively: the query already returns this order, but the layout is
  // only deterministic if the input order is.
  const sorted = [...refEdges].sort(
    (a, b) =>
      a.noteId.localeCompare(b.noteId) ||
      a.targetType.localeCompare(b.targetType) ||
      a.targetId.localeCompare(b.targetId)
  )
  for (const edge of sorted) {
    if (!noteIds.has(edge.noteId)) continue
    const list = outgoing.get(edge.noteId)
    if (list) list.push(edge)
    else outgoing.set(edge.noteId, [edge])
  }

  const seeded = seedPositions(notes, outgoing, labels, noteIds)
  const totalNodes = seeded.nodes.length
  const capped = applyCap(seeded.nodes, seeded.edges)
  const rows = rowsFor(
    capped.nodes.filter((n) => n.isNote).length,
    capped.nodes.filter((n) => !n.isNote).length
  )
  snapToLattice(capped.nodes, rows)

  const byKey = new Map(capped.nodes.map((n) => [n.key, n]))
  const highlight = focus ?? hover
  const neighbours = new Set<string>()
  if (highlight) {
    for (const edge of capped.edges) {
      if (edge.a === highlight) neighbours.add(edge.b)
      if (edge.b === highlight) neighbours.add(edge.a)
    }
  }
  const lit = (key: string) => !highlight || highlight === key || neighbours.has(key)

  const nodes: MapNode[] = capped.nodes.map((node) => {
    const ghosted = !!typesOff[node.type]
    const on = !ghosted && lit(node.key)
    const focused = focus === node.key
    return {
      key: node.key,
      id: node.id,
      type: node.type,
      isNote: node.isNote,
      label: truncateLabel(node.full),
      full: node.full,
      x: node.x,
      y: node.y,
      left: `${node.x}%`,
      top: `${node.y}%`,
      opacity: ghosted ? 0.12 : on ? 1 : 0.22,
      pointerEvents: ghosted ? 'none' : 'auto',
      dot: nodeTypeColor(node.type),
      background: focused ? 'var(--color-accent-subtle)' : 'var(--color-card)',
      borderColor: focused
        ? 'color-mix(in srgb, var(--color-accent) 45%, transparent)'
        : hover === node.key
          ? 'color-mix(in srgb, var(--color-accent) 30%, transparent)'
          : 'var(--color-border-strong)',
      fontSize: node.isNote ? '11px' : '10px',
      fontWeight: node.isNote ? '600' : '500'
    }
  })

  const edges: MapEdge[] = capped.edges.map((edge) => {
    const a = byKey.get(edge.a)
    const b = byKey.get(edge.b)
    // Unreachable: applyCap drops every edge whose endpoints it removed.
    if (!a || !b) throw new Error(`backlink map edge ${edge.key} has no endpoints`)
    const ghosted = !!typesOff[a.type] || !!typesOff[b.type]
    const on = !ghosted && (!highlight || edge.a === highlight || edge.b === highlight)
    const backlink = edge.kind === 'backlink'
    return {
      key: edge.key,
      a: edge.a,
      b: edge.b,
      kind: edge.kind,
      d: edgePath(a, b, edge.kind),
      stroke: backlink ? 'var(--color-accent)' : 'var(--color-text-faint)',
      strokeWidth: backlink ? 1.4 : 1,
      strokeDasharray: backlink ? '0' : '3 3',
      opacity: ghosted ? 0.05 : on ? (backlink ? 0.9 : 0.85) : 0.12
    }
  })

  const backlinkCount = edges.filter((e) => e.kind === 'backlink').length
  const nodeCount = nodes.length
  const wasCapped = totalNodes > nodeCount
  const countLabel =
    `${wasCapped ? `showing ${nodeCount} of ${totalNodes}` : nodeCount} nodes · ` +
    `${backlinkCount} backlinks`

  return {
    nodes,
    edges,
    nodeCount,
    totalNodes,
    capped: wasCapped,
    backlinkCount,
    countLabel,
    isEmpty: edges.length === 0,
    emptyReason: edges.length === 0 ? 'no-mentions' : null
  }
}
