// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { NoteReferenceEdge } from '@shared/types'
import { BacklinkMap } from '@renderer/components/overview/BacklinkMap'

const edge = (
  noteId: string,
  targetType: NoteReferenceEdge['targetType'],
  targetId: string
): NoteReferenceEdge => ({ noteId, targetType, targetId, mentionCount: 1 })

const NOTES = [
  { id: 'n1', title: 'First note' },
  { id: 'n2', title: 'Second note' }
]

const EDGES = [
  edge('n1', 'capture', 'cap1'),
  edge('n1', 'note', 'n2'),
  edge('n2', 'tag', 'tag1')
]

const LABELS = {
  capture: { cap1: 'Acme homepage' },
  tag: { tag1: 'evidence' },
  note: { n1: 'First note', n2: 'Second note' }
}

function renderMap(over: Partial<Parameters<typeof BacklinkMap>[0]> = {}) {
  const onOpenNote = vi.fn()
  const onAllNotes = vi.fn()
  render(
    <BacklinkMap
      notes={NOTES}
      edges={EDGES}
      labels={LABELS}
      onOpenNote={onOpenNote}
      onAllNotes={onAllNotes}
      {...over}
    />
  )
  return { onOpenNote, onAllNotes }
}

afterEach(cleanup)

describe('BacklinkMap', () => {
  it('draws a pill per node and a path per edge', () => {
    renderMap()

    expect(screen.getAllByTestId('overview-map-node')).toHaveLength(4)
    expect(screen.getAllByTestId('overview-map-edge')).toHaveLength(3)
    expect(screen.getByTestId('overview-map-count').textContent).toBe('4 nodes · 1 backlinks')
  })

  it('marks each edge with its kind so a Backlink reads differently from a reference', () => {
    renderMap()
    const kinds = screen.getAllByTestId('overview-map-edge').map((p) => p.dataset.edgeKind)

    expect(kinds.filter((k) => k === 'backlink')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'ref')).toHaveLength(2)
  })

  it('carries the untruncated label on the pill title', () => {
    renderMap({
      notes: [{ id: 'n1', title: 'A very long note title that will not fit' }],
      edges: [edge('n1', 'tag', 'tag1')]
    })

    expect(screen.getByTitle('A very long note title that will not fit')).toBeTruthy()
  })

  it('focuses a node on click and offers a way back out', () => {
    renderMap()
    const [first] = screen.getAllByTestId('overview-map-node')

    expect(screen.queryByTestId('overview-map-clear-focus')).toBeNull()
    fireEvent.click(first)
    expect(first.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByTestId('overview-map-clear-focus'))
    expect(first.getAttribute('aria-pressed')).toBe('false')
  })

  it('clears the focus when the focused node is clicked again', () => {
    renderMap()
    const [first] = screen.getAllByTestId('overview-map-node')

    fireEvent.click(first)
    fireEvent.click(first)

    expect(first.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByTestId('overview-map-clear-focus')).toBeNull()
  })

  it('dims the neighbourhood a node is not part of while it is hovered', () => {
    renderMap()
    const nodes = screen.getAllByTestId('overview-map-node')
    const noteNode = nodes.find((n) => n.dataset.nodeKey === 'note:n1')
    const far = nodes.find((n) => n.dataset.nodeKey === 'ent:tag:tag1')

    fireEvent.mouseEnter(noteNode!)

    expect(noteNode!.style.opacity).toBe('1')
    expect(far!.style.opacity).toBe('0.22')
  })

  // Keyboard parity: a pill reached by Tab lights the same neighbourhood the
  // pointer does, so the preview is not mouse-only.
  it('previews the neighbourhood on keyboard focus too', () => {
    renderMap()
    const nodes = screen.getAllByTestId('overview-map-node')
    const noteNode = nodes.find((n) => n.dataset.nodeKey === 'note:n1')
    const far = nodes.find((n) => n.dataset.nodeKey === 'ent:tag:tag1')

    fireEvent.focus(noteNode!)
    expect(far!.style.opacity).toBe('0.22')

    fireEvent.blur(noteNode!)
    expect(far!.style.opacity).toBe('1')
  })

  it('opens a note on double-click and does nothing for an entity', () => {
    const { onOpenNote } = renderMap()
    const nodes = screen.getAllByTestId('overview-map-node')

    fireEvent.doubleClick(nodes.find((n) => n.dataset.nodeKey === 'note:n1')!)
    expect(onOpenNote).toHaveBeenCalledWith('n1')

    onOpenNote.mockClear()
    fireEvent.doubleClick(nodes.find((n) => n.dataset.nodeKey === 'ent:tag:tag1')!)
    expect(onOpenNote).not.toHaveBeenCalled()
  })

  it('ghosts a filtered type instead of removing it', () => {
    renderMap()

    fireEvent.click(screen.getByTestId('overview-map-legend-capture'))

    const nodes = screen.getAllByTestId('overview-map-node')
    expect(nodes).toHaveLength(4)
    const ghost = nodes.find((n) => n.dataset.nodeType === 'capture')
    expect(ghost!.style.opacity).toBe('0.12')
    expect(ghost!.style.pointerEvents).toBe('none')
    expect(screen.getByTestId('overview-map-count').textContent).toContain('4 nodes')
  })

  it('flips a legend chip between hide and show', () => {
    renderMap()
    const chip = screen.getByTestId('overview-map-legend-tag')

    expect(chip.getAttribute('title')).toBe('Hide tag nodes')
    fireEvent.click(chip)
    expect(chip.getAttribute('title')).toBe('Show tag nodes')
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  it('drops a focus the operator has just filtered out of view', () => {
    renderMap()
    const capture = screen
      .getAllByTestId('overview-map-node')
      .find((n) => n.dataset.nodeType === 'capture')

    fireEvent.click(capture!)
    expect(screen.getByTestId('overview-map-clear-focus')).toBeTruthy()

    fireEvent.click(screen.getByTestId('overview-map-legend-capture'))
    expect(screen.queryByTestId('overview-map-clear-focus')).toBeNull()
  })

  it('discloses the ceiling in the header once it bites', () => {
    const many = Array.from({ length: 30 }, (_, i) => edge('n1', 'capture', `cap${i}`))
    renderMap({ notes: [{ id: 'n1', title: 'One' }], edges: many, labels: {} })

    expect(screen.getByTestId('overview-map-count').textContent).toContain('showing 20 of 31 nodes')
    expect(screen.getAllByTestId('overview-map-node')).toHaveLength(20)
  })

  it('shows the no-notes empty state instead of an empty lattice', () => {
    renderMap({ notes: [], edges: [] })

    expect(screen.getByTestId('overview-map-empty').textContent).toBe('No notes in this case yet.')
    expect(screen.queryAllByTestId('overview-map-node')).toHaveLength(0)
  })

  it('shows the no-Mentions empty state when the index is empty', () => {
    renderMap({ edges: [] })

    expect(screen.getByTestId('overview-map-empty').textContent).toBe('No Mentions to map yet.')
    expect(screen.queryByTestId('overview-map-notice')).toBeNull()
  })

  // A case whose notes fill the ceiling still has Mentions; saying it has none
  // while hiding all 20 note pills was the #402 review's blocking finding.
  it('keeps the notes drawn and explains the ceiling instead of claiming no Mentions', () => {
    const notes = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, title: `Note ${i}` }))
    renderMap({ notes, edges: [edge('n0', 'capture', 'cap1')], labels: {} })

    expect(screen.queryByTestId('overview-map-empty')).toBeNull()
    expect(screen.getAllByTestId('overview-map-node')).toHaveLength(20)
    expect(screen.queryAllByTestId('overview-map-edge')).toHaveLength(0)
    expect(screen.getByTestId('overview-map-notice').textContent).toBe(
      'All 20 nodes the map can draw are notes, so what they mention is not drawn.'
    )
  })

  it('carries no notice on a map that draws in full', () => {
    renderMap()

    expect(screen.queryByTestId('overview-map-notice')).toBeNull()
  })

  it('routes the header action to the notes screen', () => {
    const { onAllNotes } = renderMap()

    fireEvent.click(screen.getByText('All notes'))
    expect(onAllNotes).toHaveBeenCalled()
  })
})
