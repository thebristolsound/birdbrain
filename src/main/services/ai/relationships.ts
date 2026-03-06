import * as db from '@main/services/database'
import type { EntityGraph, EntityNode, EntityEdge } from '@shared/types'

export function buildEntityGraph(caseId: string): EntityGraph {
  // Get all captures for this case
  const captures = db.listCaptures(caseId)
  if (captures.length === 0) return { nodes: [], edges: [] }

  // Build node map: deduplicate entities by type+value
  const nodeMap = new Map<string, EntityNode>()
  // Map captureId -> list of entity keys
  const captureEntities = new Map<string, string[]>()

  for (const capture of captures) {
    const entities = db.getEntitiesByCapture(capture.id)
    const keys: string[] = []

    for (const entity of entities) {
      const key = `${entity.type}::${entity.value}`
      keys.push(key)

      const existing = nodeMap.get(key)
      if (existing) {
        existing.occurrences++
        if (!existing.captureIds.includes(capture.id)) {
          existing.captureIds.push(capture.id)
        }
        if (capture.timestamp < existing.firstSeen) existing.firstSeen = capture.timestamp
        if (capture.timestamp > existing.lastSeen) existing.lastSeen = capture.timestamp
      } else {
        nodeMap.set(key, {
          type: entity.type,
          value: entity.value,
          captureIds: [capture.id],
          firstSeen: capture.timestamp,
          lastSeen: capture.timestamp,
          occurrences: 1
        })
      }
    }

    if (keys.length > 0) {
      captureEntities.set(capture.id, [...new Set(keys)])
    }
  }

  // Build edges: co-occurrence within the same capture
  const edgeMap = new Map<string, EntityEdge>()

  for (const [captureId, keys] of captureEntities) {
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const source = nodeMap.get(keys[i])!.value
        const target = nodeMap.get(keys[j])!.value
        const edgeKey = [source, target].sort().join(':::')

        const existing = edgeMap.get(edgeKey)
        if (existing) {
          existing.weight++
          if (!existing.captureIds.includes(captureId)) {
            existing.captureIds.push(captureId)
          }
        } else {
          edgeMap.set(edgeKey, {
            source,
            target,
            captureIds: [captureId],
            weight: 1
          })
        }
      }
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values())
  }
}
