import { Fragment, useState, useEffect, useRef } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import { useCaptures } from '@renderer/hooks/useCaptures'
import type { Entity } from '@shared/types'

interface EnrichedEntity extends Entity {
  captureTitle: string
}

export function CaseEntities() {
  const activeCaseId = useAppStore((s) => s.activeCaseId)
  const navigateToCapture = useAppStore((s) => s.navigateToCapture)
  const { captures } = useCaptures(activeCaseId)
  const [entities, setEntities] = useState<EnrichedEntity[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [minConfidence, setMinConfidence] = useState(0)
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null)

  // Track capture IDs to avoid infinite re-renders from array reference changes
  const captureIds = captures.map((c) => c.id).join(',')
  const capturesRef = useRef(captures)
  capturesRef.current = captures

  useEffect(() => {
    if (!activeCaseId) return
    if (!captureIds) {
      setEntities([])
      setExpandedEntity(null)
      setLoading(false)
      return
    }
    setLoading(true)

    // Load entities for all captures in the case
    Promise.all(
      capturesRef.current.map(async (cap) => {
        const capEntities: Entity[] = await window.birdbrain.ai.getEntities(cap.id)
        return capEntities.map((e) => ({ ...e, captureTitle: cap.title || cap.url }))
      })
    ).then((results) => {
      setEntities(results.flat())
      setLoading(false)
    }).catch((err) => {
      console.error('Failed to load entities:', err)
      setLoading(false)
    })
  }, [activeCaseId, captureIds])

  // Deduplicate by value+type, aggregate capture count
  const aggregated = entities.reduce<
    Map<string, { entity: EnrichedEntity; captureIds: { id: string; title: string }[] }>
  >((acc, e) => {
    const key = `${e.type}:${e.value}`
    const existing = acc.get(key)
    if (existing) {
      if (!existing.captureIds.find((c) => c.id === e.captureId)) {
        existing.captureIds.push({ id: e.captureId, title: e.captureTitle })
      }
      // Keep highest confidence
      if ((e.confidence ?? 0) > (existing.entity.confidence ?? 0)) {
        existing.entity = e
      }
    } else {
      acc.set(key, {
        entity: e,
        captureIds: [{ id: e.captureId, title: e.captureTitle }]
      })
    }
    return acc
  }, new Map())

  const sources = new Set(entities.map((e) => e.source).filter(Boolean))
  const types = [...new Set(entities.map((e) => e.type))]

  const filtered = [...aggregated.values()].filter((item) => {
    if (typeFilter !== 'all' && item.entity.type !== typeFilter) return false
    if (sourceFilter !== 'all' && item.entity.source !== sourceFilter) return false
    if (minConfidence > 0 && (item.entity.confidence ?? 0) < minConfidence) return false
    return true
  })

  if (loading) {
    return <div className="text-neutral-500">Loading entities…</div>
  }

  if (entities.length === 0) {
    return (
      <div className="text-center text-neutral-500">
        <p>No entities found for this case.</p>
        <p className="mt-1 text-sm">Extract entities from captures to see them here.</p>
      </div>
    )
  }

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200"
        >
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {sources.size > 1 && (
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200"
          >
            <option value="all">All sources</option>
            <option value="rule">Rule</option>
            <option value="ai">AI</option>
          </select>
        )}

        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-400">Min confidence:</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={minConfidence}
            onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
            className="w-24"
          />
          <span className="text-xs text-neutral-400">{Math.round(minConfidence * 100)}%</span>
        </div>
      </div>

      {/* Entity table */}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-neutral-500">
            <th className="pb-2 pr-4">Value</th>
            <th className="pb-2 pr-4">Type</th>
            <th className="pb-2 pr-4">Source</th>
            <th className="pb-2 pr-4">Confidence</th>
            <th className="pb-2">Captures</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(({ entity, captureIds }) => (
            <Fragment key={`${entity.type}:${entity.value}`}>
              <tr
                onClick={() => setExpandedEntity(
                  expandedEntity === `${entity.type}:${entity.value}` ? null : `${entity.type}:${entity.value}`
                )}
                className="cursor-pointer border-b border-neutral-800/50 hover:bg-neutral-800/30"
              >
                <td className="py-2 pr-4 text-neutral-100">{entity.value}</td>
                <td className="py-2 pr-4">
                  <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-xs">{entity.type}</span>
                </td>
                <td className="py-2 pr-4">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${
                    entity.source === 'rule' ? 'bg-emerald-900 text-emerald-300' : 'bg-blue-900 text-blue-300'
                  }`}>
                    {entity.source ?? 'AI'}
                  </span>
                </td>
                <td className="py-2 pr-4 text-neutral-400">
                  {entity.confidence != null ? `${Math.round(entity.confidence * 100)}%` : '—'}
                </td>
                <td className="py-2 text-neutral-400">{captureIds.length}</td>
              </tr>
              {expandedEntity === `${entity.type}:${entity.value}` && (
                <tr key={`${entity.id}-expanded`}>
                  <td colSpan={5} className="pb-3 pl-4 pt-1">
                    <div className="flex flex-wrap gap-2">
                      {captureIds.map((c) => (
                        <button
                          key={c.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            navigateToCapture(c.id)
                          }}
                          className="rounded bg-neutral-800 px-2 py-1 text-xs text-blue-400 hover:bg-neutral-700"
                        >
                          {c.title}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
