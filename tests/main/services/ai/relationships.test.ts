import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase, createCase, insertCapture, insertEntity } from '../../../../src/main/services/database'
import { buildEntityGraph } from '../../../../src/main/services/ai/relationships'

describe('relationships', () => {
  let caseId: string

  beforeEach(() => {
    initDatabase(':memory:')
    const c = createCase({ name: 'Test Case' })
    caseId = c.id
  })

  afterEach(() => {
    closeDatabase()
  })

  it('returns empty graph for case with no entities', () => {
    const graph = buildEntityGraph(caseId)
    expect(graph.nodes).toHaveLength(0)
    expect(graph.edges).toHaveLength(0)
  })

  it('builds nodes from entities', () => {
    const cap = insertCapture({
      caseId,
      url: 'https://example.com',
      title: 'Test',
      hash: 'abc',
      timestamp: '2024-01-01T00:00:00Z'
    })
    insertEntity({ captureId: cap.id, type: 'person', value: 'John Smith' })
    insertEntity({ captureId: cap.id, type: 'email', value: 'john@example.com' })

    const graph = buildEntityGraph(caseId)
    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes.find((n) => n.value === 'John Smith')).toBeDefined()
    expect(graph.nodes.find((n) => n.value === 'john@example.com')).toBeDefined()
  })

  it('deduplicates entities across captures', () => {
    const cap1 = insertCapture({
      caseId,
      url: 'https://a.com',
      title: 'A',
      hash: 'a',
      timestamp: '2024-01-01T00:00:00Z'
    })
    const cap2 = insertCapture({
      caseId,
      url: 'https://b.com',
      title: 'B',
      hash: 'b',
      timestamp: '2024-01-02T00:00:00Z'
    })
    insertEntity({ captureId: cap1.id, type: 'person', value: 'John Smith' })
    insertEntity({ captureId: cap2.id, type: 'person', value: 'John Smith' })

    const graph = buildEntityGraph(caseId)
    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0].occurrences).toBe(2)
    expect(graph.nodes[0].captureIds).toHaveLength(2)
  })

  it('builds edges for co-occurring entities', () => {
    const cap = insertCapture({
      caseId,
      url: 'https://example.com',
      title: 'Test',
      hash: 'abc',
      timestamp: '2024-01-01T00:00:00Z'
    })
    insertEntity({ captureId: cap.id, type: 'person', value: 'Alice' })
    insertEntity({ captureId: cap.id, type: 'person', value: 'Bob' })

    const graph = buildEntityGraph(caseId)
    expect(graph.edges).toHaveLength(1)
    const edge = graph.edges[0]
    expect([edge.source, edge.target].sort()).toEqual(['Alice', 'Bob'])
    expect(edge.weight).toBe(1)
  })

  it('tracks first and last seen timestamps', () => {
    const cap1 = insertCapture({
      caseId,
      url: 'https://a.com',
      title: 'A',
      hash: 'a',
      timestamp: '2024-01-01T00:00:00Z'
    })
    const cap2 = insertCapture({
      caseId,
      url: 'https://b.com',
      title: 'B',
      hash: 'b',
      timestamp: '2024-03-15T00:00:00Z'
    })
    insertEntity({ captureId: cap1.id, type: 'domain', value: 'example.com' })
    insertEntity({ captureId: cap2.id, type: 'domain', value: 'example.com' })

    const graph = buildEntityGraph(caseId)
    const node = graph.nodes[0]
    expect(node.firstSeen).toBe('2024-01-01T00:00:00Z')
    expect(node.lastSeen).toBe('2024-03-15T00:00:00Z')
  })
})
