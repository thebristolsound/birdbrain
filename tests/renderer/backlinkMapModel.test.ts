/**
 * The Overview backlink map's geometry (#402).
 *
 * The map is a pure render over the note-references index — derived state,
 * rewritten inside the transaction of every note-body write, never a source of
 * truth. Everything asserted here is a property of that render: what draws,
 * where it lands, and what a filter does. Nothing here writes.
 */
import { describe, it, expect } from 'vitest'
import type { NoteReferenceEdge } from '@shared/types'
import {
  computeBacklinkMap,
  noteRow,
  rowsFor,
  truncateLabel,
  MAP_ROWS,
  NODE_CAP,
  type BacklinkMapInput,
  type MapNode
} from '@renderer/components/overview/backlinkMapModel'

const COL_X = [(0.5 / 3) * 100, (1.5 / 3) * 100, (2.5 / 3) * 100]

const note = (id: string, title = `Note ${id}`) => ({ id, title })

const edge = (
  noteId: string,
  targetType: NoteReferenceEdge['targetType'],
  targetId: string,
  mentionCount = 1
): NoteReferenceEdge => ({ noteId, targetType, targetId, mentionCount })

const build = (over: Partial<BacklinkMapInput> = {}) =>
  computeBacklinkMap({ notes: [], edges: [], ...over })

const columnOf = (node: MapNode) => COL_X.findIndex((x) => Math.abs(x - node.x) < 0.001)

describe('truncateLabel', () => {
  it('leaves a label of 22 characters alone', () => {
    const label = 'a'.repeat(22)
    expect(truncateLabel(label)).toBe(label)
  })

  it('middle-truncates a longer label, keeping both ends', () => {
    expect(truncateLabel('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijk…qrstuvwxyz')
  })
})

describe('rowsFor', () => {
  it('holds the mock’s eight rows for a case that fits in them', () => {
    expect(rowsFor(3, 8)).toBe(MAP_ROWS)
  })

  it('grows a row per note once the notes outnumber the rows', () => {
    expect(rowsFor(12, 0)).toBe(12)
  })

  // The two flanking columns hold 2 * rows entities; at the ceiling with one
  // note that is 19 entities into 16 cells unless the lattice grows.
  it('grows to fit the entities the ceiling admits', () => {
    expect(rowsFor(1, 19)).toBe(10)
  })
})

describe('noteRow', () => {
  it('places three notes on the mock’s rows 1, 4 and 7', () => {
    expect([0, 1, 2].map((i) => noteRow(i, 3, MAP_ROWS))).toEqual([1, 4, 7])
  })

  it('spreads notes over the lane instead of piling them on the last row', () => {
    const rows = rowsFor(6, 0)
    const placed = [0, 1, 2, 3, 4, 5].map((i) => noteRow(i, 6, rows))
    expect(placed).toEqual([0, 1, 3, 4, 6, 7])
    expect(new Set(placed).size).toBe(6)
  })
})

describe('computeBacklinkMap', () => {
  it('returns an empty model with no coordinates at all when the case has no notes', () => {
    const model = build({ edges: [edge('n1', 'capture', 'cap1')] })

    expect(model).toMatchObject({
      nodes: [],
      edges: [],
      nodeCount: 0,
      totalNodes: 0,
      capped: false,
      backlinkCount: 0,
      isEmpty: true,
      notice: 'no-notes'
    })
    expect(model.countLabel).toBe('0 nodes · 0 backlinks')
  })

  it('reports the no-Mentions empty state when notes exist but reference nothing', () => {
    const model = build({ notes: [note('n1'), note('n2')] })

    expect(model.isEmpty).toBe(true)
    expect(model.notice).toBe('no-mentions')
    expect(model.edges).toEqual([])
    // The nodes are still computed: the header count stays honest about what
    // the case holds even while the canvas shows its empty state.
    expect(model.nodeCount).toBe(2)
    expect(model.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true)
  })

  it('draws one node per mentioned target and one dashed edge per pair', () => {
    const model = build({
      notes: [note('n1')],
      edges: [
        edge('n1', 'capture', 'cap1'),
        edge('n1', 'selector', 'sel1'),
        edge('n1', 'tag', 'tag1')
      ]
    })

    expect(model.nodes.map((n) => n.type).sort()).toEqual(['capture', 'note', 'selector', 'tag'])
    expect(model.edges).toHaveLength(3)
    expect(model.edges.every((e) => e.kind === 'ref')).toBe(true)
    expect(model.backlinkCount).toBe(0)
    expect(model.countLabel).toBe('4 nodes · 0 backlinks')
  })

  it('collapses a mutual Mention into one Backlink edge, not two', () => {
    const model = build({
      notes: [note('n1'), note('n2')],
      edges: [edge('n1', 'note', 'n2'), edge('n2', 'note', 'n1')]
    })

    expect(model.edges).toHaveLength(1)
    expect(model.edges[0]).toMatchObject({ kind: 'backlink', a: 'note:n1', b: 'note:n2' })
    expect(model.backlinkCount).toBe(1)
  })

  it('ignores a note that mentions itself', () => {
    const model = build({ notes: [note('n1')], edges: [edge('n1', 'note', 'n1')] })

    expect(model.edges).toEqual([])
    expect(model.nodeCount).toBe(1)
  })

  // A mention of a note the case no longer holds has no second endpoint, so it
  // cannot be a Backlink; it draws as an entity like any other dangling target.
  it('draws a Mention of a deleted note as an entity, not a Backlink', () => {
    const model = build({ notes: [note('n1')], edges: [edge('n1', 'note', 'gone')] })

    expect(model.edges).toHaveLength(1)
    expect(model.edges[0].kind).toBe('ref')
    expect(model.nodes.map((n) => n.key)).toEqual(['note:n1', 'ent:note:gone'])
  })

  it('shares one entity node between two notes that mention the same capture', () => {
    const model = build({
      notes: [note('n1'), note('n2')],
      edges: [edge('n1', 'capture', 'cap1'), edge('n2', 'capture', 'cap1')]
    })

    expect(model.nodes.filter((n) => n.type === 'capture')).toHaveLength(1)
    expect(model.edges).toHaveLength(2)
  })

  it('labels targets from the caches and falls back for one the case no longer holds', () => {
    const model = build({
      notes: [note('n1')],
      edges: [edge('n1', 'capture', 'cap1'), edge('n1', 'tag', 'gone')],
      labels: { capture: { cap1: 'Acme homepage' } }
    })
    const byKey = Object.fromEntries(model.nodes.map((n) => [n.key, n.full]))

    expect(byKey['ent:capture:cap1']).toBe('Acme homepage')
    expect(byKey['ent:tag:gone']).toBe('(missing tag)')
  })

  it('middle-truncates a long node label and keeps the original on `full`', () => {
    const long = 'Extremely Long Capture Title Indeed'
    const model = build({
      notes: [note('n1')],
      edges: [edge('n1', 'capture', 'cap1')],
      labels: { capture: { cap1: long } }
    })
    const node = model.nodes.find((n) => n.key === 'ent:capture:cap1')

    expect(node?.full).toBe(long)
    expect(node?.label).toBe(truncateLabel(long))
    expect(node?.label).not.toBe(long)
  })

  it('gives an untitled note a placeholder rather than an empty pill', () => {
    const model = build({ notes: [note('n1', '')], edges: [edge('n1', 'tag', 't1')] })

    expect(model.nodes[0].full).toBe('(Untitled note)')
  })

  describe('the lattice', () => {
    const many = build({
      notes: [note('n1'), note('n2')],
      edges: [
        edge('n1', 'capture', 'cap1'),
        edge('n1', 'capture', 'cap2'),
        edge('n1', 'selector', 'sel1'),
        edge('n2', 'tag', 'tag1'),
        edge('n2', 'tag', 'tag2'),
        edge('n2', 'capture', 'cap3')
      ]
    })

    it('never puts two nodes in one cell', () => {
      const cells = many.nodes.map((n) => `${n.x},${n.y}`)
      expect(new Set(cells).size).toBe(cells.length)
    })

    it('keeps notes in the centre lane and entities in the flanking columns', () => {
      for (const node of many.nodes) {
        expect(node.isNote ? [1] : [0, 2]).toContain(columnOf(node))
      }
    })

    it('emits percentage coordinates inside the canvas', () => {
      for (const node of many.nodes) {
        expect(node.left).toBe(`${node.x}%`)
        expect(node.top).toBe(`${node.y}%`)
        expect(node.y).toBeGreaterThan(0)
        expect(node.y).toBeLessThan(100)
      }
    })
  })

  describe('the node ceiling', () => {
    // One note mentioning 30 captures, the first three of them twice over, so
    // degree ranks them above the rest.
    const busy = ['cap0', 'cap1', 'cap2']
    const targets = Array.from({ length: 30 }, (_, i) => `cap${i}`)
    const model = build({
      notes: [note('n1'), note('n2')],
      edges: [
        ...targets.map((t) => edge('n1', 'capture', t)),
        ...busy.map((t) => edge('n2', 'capture', t))
      ]
    })

    it('caps the drawn nodes and reports the pre-cap total', () => {
      expect(model.totalNodes).toBe(32)
      expect(model.nodeCount).toBe(NODE_CAP)
      expect(model.capped).toBe(true)
      expect(model.countLabel).toBe('showing 20 of 32 nodes · 0 backlinks')
    })

    it('never drops a note', () => {
      expect(model.nodes.filter((n) => n.isNote).map((n) => n.id)).toEqual(['n1', 'n2'])
    })

    it('keeps the busiest entities', () => {
      const kept = model.nodes.filter((n) => !n.isNote).map((n) => n.id)
      for (const id of busy) expect(kept).toContain(id)
    })

    it('drops every edge that touched a dropped node', () => {
      const keys = new Set(model.nodes.map((n) => n.key))
      for (const e of model.edges) {
        expect(keys.has(e.a)).toBe(true)
        expect(keys.has(e.b)).toBe(true)
      }
    })

    it('says plain "N nodes" when nothing was dropped', () => {
      expect(build({ notes: [note('n1')], edges: [edge('n1', 'tag', 't1')] }).countLabel).toBe(
        '2 nodes · 0 backlinks'
      )
    })

    it('shows every note and no entities when the notes alone reach the ceiling', () => {
      const notes = Array.from({ length: 24 }, (_, i) => note(`n${i}`))
      const capped = build({ notes, edges: [edge('n0', 'capture', 'cap1')] })

      expect(capped.nodes.filter((n) => n.isNote)).toHaveLength(24)
      expect(capped.nodes.filter((n) => !n.isNote)).toHaveLength(0)
      expect(capped.edges).toEqual([])
      // The case has a Mention; the ceiling is why it is not on the canvas.
      expect(capped.isEmpty).toBe(false)
      expect(capped.notice).toBe('entities-capped')
    })

    // NODE_CAP notes is where the ceiling first leaves nothing for the entities:
    // one note fewer and a single entity still survives to be drawn.
    it('keeps the notes drawn when the ceiling leaves no room for their Mentions', () => {
      const notes = Array.from({ length: NODE_CAP }, (_, i) => note(`n${i}`))
      const mentions = [edge('n0', 'capture', 'cap1'), edge('n1', 'tag', 'tag1')]
      const model = build({ notes, edges: mentions })

      expect(model.nodes).toHaveLength(NODE_CAP)
      expect(model.nodes.every((n) => n.isNote)).toBe(true)
      expect(model.edges).toEqual([])
      expect(model.isEmpty).toBe(false)
      expect(model.notice).toBe('entities-capped')
      expect(model.countLabel).toBe('showing 20 of 22 nodes · 0 backlinks')

      const under = build({ notes: notes.slice(0, NODE_CAP - 1), edges: mentions })
      expect(under.notice).toBeNull()
      expect(under.edges).toHaveLength(1)
    })

    // A Note-to-Note Backlink joins two nodes the ceiling never drops, so it
    // survives however many notes the case has.
    it('is not the capped notice when a surviving Backlink still draws', () => {
      const notes = Array.from({ length: 24 }, (_, i) => note(`n${i}`))
      const model = build({
        notes,
        edges: [edge('n0', 'note', 'n1'), edge('n2', 'capture', 'cap1')]
      })

      expect(model.edges.map((e) => e.kind)).toEqual(['backlink'])
      expect(model.notice).toBeNull()
    })
  })

  describe('edge treatment', () => {
    const model = build({
      notes: [note('n1'), note('n2')],
      edges: [edge('n1', 'note', 'n2'), edge('n1', 'capture', 'cap1')]
    })
    const backlink = model.edges.find((e) => e.kind === 'backlink')
    const ref = model.edges.find((e) => e.kind === 'ref')

    it('draws Backlinks solid in the accent colour', () => {
      expect(backlink).toMatchObject({
        stroke: 'var(--color-accent)',
        strokeWidth: 1.4,
        strokeDasharray: '0',
        opacity: 0.9
      })
    })

    it('draws references dashed and faint', () => {
      expect(ref).toMatchObject({
        stroke: 'var(--color-text-faint)',
        strokeWidth: 1,
        strokeDasharray: '3 3',
        opacity: 0.85
      })
    })

    it('emits a quadratic Bezier through both endpoints', () => {
      expect(backlink?.d).toMatch(/^M [\d.]+ [\d.]+ Q -?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/)
    })

    // The bow's whole job: push the curve's control point away from the middle
    // of the canvas, so edges arc clear of the busy centre lane rather than
    // through it. Asserted as the invariant rather than on one hardcoded sign.
    it('bows every edge away from the centre of the canvas', () => {
      const fromCentre = (x: number, y: number) => Math.hypot(x - 50, y - 50)
      const bowed = build({
        notes: [note('n1'), note('n2'), note('n3')],
        edges: [
          edge('n1', 'note', 'n2'),
          edge('n2', 'note', 'n3'),
          edge('n1', 'capture', 'cap1'),
          edge('n3', 'tag', 'tag1')
        ]
      })
      const byKey = Object.fromEntries(bowed.nodes.map((n) => [n.key, n]))

      expect(bowed.edges.length).toBeGreaterThan(0)
      for (const e of bowed.edges) {
        const [cx, cy] = e.d.split(' Q ')[1].split(' ').slice(0, 2).map(Number)
        const a = byKey[e.a]
        const b = byKey[e.b]
        expect(fromCentre(cx, cy)).toBeGreaterThanOrEqual(
          fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2) - 1e-9
        )
      }
    })

    it('bows a Backlink further than a reference', () => {
      const spread = (kind: 'backlink' | 'ref', m: ReturnType<typeof build>) => {
        const e = m.edges.find((x) => x.kind === kind)
        const byKey = Object.fromEntries(m.nodes.map((n) => [n.key, n]))
        const [cx, cy] = e!.d.split(' Q ')[1].split(' ').slice(0, 2).map(Number)
        const a = byKey[e!.a]
        const b = byKey[e!.b]
        return Math.hypot(cx - (a.x + b.x) / 2, cy - (a.y + b.y) / 2)
      }
      const model = build({
        notes: [note('n1'), note('n2')],
        edges: [edge('n1', 'note', 'n2'), edge('n1', 'capture', 'cap1')]
      })

      expect(spread('backlink', model)).toBeGreaterThan(spread('ref', model))
    })
  })

  describe('hover and focus', () => {
    const input: BacklinkMapInput = {
      notes: [note('n1'), note('n2')],
      edges: [edge('n1', 'capture', 'cap1'), edge('n2', 'tag', 'tag1')]
    }
    const opacityOf = (m: ReturnType<typeof build>, key: string) =>
      m.nodes.find((n) => n.key === key)?.opacity

    it('lights everything when nothing is hovered or focused', () => {
      expect(build(input).nodes.every((n) => n.opacity === 1)).toBe(true)
    })

    it('lights the hovered node and its one-hop neighbours, dimming the rest', () => {
      const model = build({ ...input, hover: 'note:n1' })

      expect(opacityOf(model, 'note:n1')).toBe(1)
      expect(opacityOf(model, 'ent:capture:cap1')).toBe(1)
      expect(opacityOf(model, 'note:n2')).toBe(0.22)
      expect(opacityOf(model, 'ent:tag:tag1')).toBe(0.22)
    })

    it('dims edges that touch neither end of the highlight', () => {
      const model = build({ ...input, hover: 'note:n1' })
      const byKey = Object.fromEntries(model.edges.map((e) => [`${e.a}->${e.b}`, e.opacity]))

      expect(byKey['note:n1->ent:capture:cap1']).toBe(0.85)
      expect(byKey['note:n2->ent:tag:tag1']).toBe(0.12)
    })

    it('tints the focused node and marks the hovered one on the border', () => {
      const focused = build({ ...input, focus: 'note:n1' })
      const hovered = build({ ...input, hover: 'note:n1' })
      const pick = (m: ReturnType<typeof build>) => m.nodes.find((n) => n.key === 'note:n1')

      expect(pick(focused)?.background).toBe('var(--color-accent-subtle)')
      expect(pick(focused)?.borderColor).toContain('45%')
      expect(pick(hovered)?.background).toBe('var(--color-card)')
      expect(pick(hovered)?.borderColor).toContain('30%')
    })

    it('lets focus win over hover', () => {
      const model = build({ ...input, focus: 'note:n1', hover: 'note:n2' })

      expect(opacityOf(model, 'note:n2')).toBe(0.22)
    })
  })

  describe('type filtering', () => {
    const input: BacklinkMapInput = {
      notes: [note('n1')],
      edges: [edge('n1', 'capture', 'cap1'), edge('n1', 'tag', 'tag1')]
    }

    // Ghosting, not hiding: a filtered node keeps its cell and its place in the
    // count, so the chips can never make the map understate the case.
    it('ghosts a filtered type without removing it from the map or the count', () => {
      const model = build({ ...input, typesOff: { capture: true } })
      const ghost = model.nodes.find((n) => n.type === 'capture')

      expect(model.nodeCount).toBe(3)
      expect(ghost?.opacity).toBe(0.12)
      expect(ghost?.pointerEvents).toBe('none')
    })

    it('all but erases an edge with a ghosted endpoint', () => {
      const model = build({ ...input, typesOff: { capture: true } })
      const byKey = Object.fromEntries(model.edges.map((e) => [e.b, e.opacity]))

      expect(byKey['ent:capture:cap1']).toBe(0.05)
      expect(byKey['ent:tag:tag1']).toBe(0.85)
    })

    it('keeps the other types interactive', () => {
      const model = build({ ...input, typesOff: { capture: true } })
      const kept = model.nodes.find((n) => n.type === 'tag')

      expect(kept?.opacity).toBe(1)
      expect(kept?.pointerEvents).toBe('auto')
    })
  })

  it('colours node dots by type', () => {
    const model = build({
      notes: [note('n1')],
      edges: [
        edge('n1', 'capture', 'cap1'),
        edge('n1', 'selector', 'sel1'),
        edge('n1', 'tag', 'tag1')
      ]
    })
    const dots = Object.fromEntries(model.nodes.map((n) => [n.type, n.dot]))

    expect(dots).toEqual({
      note: 'var(--color-accent)',
      capture: '#f59e0b',
      selector: '#0ea5e9',
      tag: '#ec4899'
    })
  })

  it('sets notes apart from entities in the pill type scale', () => {
    const model = build({ notes: [note('n1')], edges: [edge('n1', 'tag', 't1')] })
    const [noteNode, entity] = model.nodes

    expect(noteNode).toMatchObject({ fontSize: '11px', fontWeight: '600' })
    expect(entity).toMatchObject({ fontSize: '10px', fontWeight: '500' })
  })

  it('drops an edge whose referring note is not in the case list', () => {
    const model = build({ notes: [note('n1')], edges: [edge('ghost', 'capture', 'cap1')] })

    expect(model.edges).toEqual([])
    expect(model.nodeCount).toBe(1)
  })

  it('produces the same model whatever order the index rows arrive in', () => {
    const rows = [
      edge('n2', 'tag', 'tag1'),
      edge('n1', 'capture', 'cap1'),
      edge('n1', 'note', 'n2'),
      edge('n2', 'selector', 'sel1')
    ]
    const notes = [note('n1'), note('n2')]
    const first = computeBacklinkMap({ notes, edges: rows })
    const second = computeBacklinkMap({ notes, edges: [...rows].reverse() })

    expect(second).toEqual(first)
  })
})
