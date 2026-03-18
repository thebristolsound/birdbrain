import { Fragment, useState, useEffect, useRef } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import { useCaptures } from '@renderer/hooks/useCaptures'
import { Search, Sparkles, Download, ChevronRight, ChevronDown, Fingerprint } from 'lucide-react'
import type { Entity } from '@shared/types'

interface EnrichedEntity extends Entity {
  captureTitle: string
}

const ENTITY_TYPE_COLORS: Record<string, string> = {
  person: 'amber',
  organization: 'sky',
  email: 'emerald',
  phone: 'violet',
  domain: 'pink',
  ip_address: 'red',
  address: 'teal',
  date: 'orange',
  username: 'indigo',
  crypto_wallet: 'yellow',
  custom: 'slate'
}

const TYPE_COLOR_CLASSES: Record<string, { active: string; dot: string }> = {
  amber: {
    active: 'bg-amber-500/15 border-amber-500/40 text-amber-500',
    dot: 'bg-amber-500'
  },
  sky: {
    active: 'bg-sky-500/15 border-sky-500/40 text-sky-500',
    dot: 'bg-sky-500'
  },
  emerald: {
    active: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-500',
    dot: 'bg-emerald-500'
  },
  violet: {
    active: 'bg-violet-500/15 border-violet-500/40 text-violet-500',
    dot: 'bg-violet-500'
  },
  pink: {
    active: 'bg-pink-500/15 border-pink-500/40 text-pink-500',
    dot: 'bg-pink-500'
  },
  red: {
    active: 'bg-red-500/15 border-red-500/40 text-red-500',
    dot: 'bg-red-500'
  },
  teal: {
    active: 'bg-teal-500/15 border-teal-500/40 text-teal-500',
    dot: 'bg-teal-500'
  },
  orange: {
    active: 'bg-orange-500/15 border-orange-500/40 text-orange-500',
    dot: 'bg-orange-500'
  },
  indigo: {
    active: 'bg-indigo-500/15 border-indigo-500/40 text-indigo-500',
    dot: 'bg-indigo-500'
  },
  yellow: {
    active: 'bg-yellow-500/15 border-yellow-500/40 text-yellow-500',
    dot: 'bg-yellow-500'
  },
  slate: {
    active: 'bg-slate-500/15 border-slate-500/40 text-slate-500',
    dot: 'bg-slate-500'
  }
}

function getTypeColor(type: string) {
  const color = ENTITY_TYPE_COLORS[type] ?? 'slate'
  return TYPE_COLOR_CLASSES[color] ?? TYPE_COLOR_CLASSES.slate
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
  const [searchQuery, setSearchQuery] = useState('')

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

  const types = [...new Set(entities.map((e) => e.type))]

  const filtered = [...aggregated.values()].filter((item) => {
    if (typeFilter !== 'all' && item.entity.type !== typeFilter) return false
    if (sourceFilter !== 'all' && item.entity.source !== sourceFilter) return false
    if (minConfidence > 0 && (item.entity.confidence ?? 0) < minConfidence) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      if (!item.entity.value.toLowerCase().includes(q)) return false
    }
    return true
  })

  if (loading) {
    return <div className="text-slate-500">Loading entities...</div>
  }

  if (entities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Fingerprint className="mb-3 h-10 w-10 text-slate-600" />
        <p className="text-slate-400">No entities found for this case.</p>
        <p className="mt-1 text-sm text-slate-500">
          Extract entities from captures to see them here.
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* Search + Actions */}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search entities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-white/[0.08] bg-slate-800 py-1.5 pl-8 pr-3 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500/40"
          />
        </div>
        <button className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700">
          <Download className="h-3.5 w-3.5" />
          Export
        </button>
        <button className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500">
          <Sparkles className="h-3.5 w-3.5" />
          Extract All
        </button>
      </div>

      {/* Type filter chips */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setTypeFilter('all')}
          className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
            typeFilter === 'all'
              ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-400'
              : 'border-white/[0.08] bg-slate-800 text-slate-400'
          }`}
        >
          All types
        </button>
        {types.map((t) => {
          const colors = getTypeColor(t)
          const isActive = typeFilter === t
          return (
            <button
              key={t}
              onClick={() => setTypeFilter(isActive ? 'all' : t)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                isActive
                  ? colors.active
                  : 'border-white/[0.08] bg-slate-800 text-slate-400'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
              {t}
            </button>
          )
        })}
      </div>

      {/* Source filter + confidence */}
      <div className="mb-4 flex items-center gap-3">
        {/* Source segmented buttons */}
        <div className="flex overflow-hidden rounded-lg border border-white/[0.08]">
          {(['all', 'rule', 'ai'] as const).map((src) => (
            <button
              key={src}
              onClick={() => setSourceFilter(src)}
              className={`px-3 py-1 text-[11px] font-medium transition-colors ${
                sourceFilter === src
                  ? 'border-indigo-500/30 bg-indigo-500/15 text-indigo-300'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {src === 'all' ? 'All' : src === 'rule' ? 'Rule' : 'AI'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500">Min confidence:</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={minConfidence}
            onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
            className="w-24"
          />
          <span className="text-xs text-slate-500">{Math.round(minConfidence * 100)}%</span>
        </div>
      </div>

      {/* Entity table */}
      <div className="neu-card overflow-hidden rounded-2xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-white/[0.02] text-left text-slate-400">
              <th className="px-4 py-2.5 text-xs font-medium">Value</th>
              <th className="px-4 py-2.5 text-xs font-medium">Type</th>
              <th className="px-4 py-2.5 text-xs font-medium">Source</th>
              <th className="px-4 py-2.5 text-xs font-medium">Confidence</th>
              <th className="px-4 py-2.5 text-xs font-medium">Captures</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ entity, captureIds: capIds }) => {
              const entityKey = `${entity.type}:${entity.value}`
              const isExpanded = expandedEntity === entityKey
              const colors = getTypeColor(entity.type)
              const conf = entity.confidence ?? 0

              return (
                <Fragment key={entityKey}>
                  <tr
                    onClick={() => setExpandedEntity(isExpanded ? null : entityKey)}
                    className="cursor-pointer border-b border-white/[0.06] transition-colors hover:bg-white/[0.03]"
                  >
                    <td className="px-4 py-2.5 text-slate-100">
                      <div className="flex items-center gap-2">
                        {isExpanded
                          ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                          : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
                        }
                        {entity.value}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium ${colors.active}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                        {entity.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-md px-1.5 py-0.5 text-xs ${
                        entity.source === 'rule'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-indigo-500/15 text-indigo-400'
                      }`}>
                        {entity.source === 'rule' ? 'Rule' : 'AI'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {entity.confidence != null ? (
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 w-16 rounded-full bg-slate-700">
                            <div
                              className="h-full rounded-full bg-indigo-500"
                              style={{ width: `${conf * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-500">
                            {Math.round(conf * 100)}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">&mdash;</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400">{capIds.length}</td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${entity.id}-expanded`}>
                      <td colSpan={5} className="border-b border-white/[0.06] bg-white/[0.02] px-4 pb-3 pl-10 pt-1">
                        <div className="flex flex-wrap gap-2">
                          {capIds.map((c) => (
                            <button
                              key={c.id}
                              onClick={(e) => {
                                e.stopPropagation()
                                navigateToCapture(c.id)
                              }}
                              className="rounded-lg border border-white/[0.08] bg-slate-800 px-2 py-1 text-xs text-indigo-400 hover:bg-slate-700"
                            >
                              {c.title}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
