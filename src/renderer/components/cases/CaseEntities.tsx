import { Fragment, useState, useEffect, useRef, useMemo } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import { useCaptures } from '@renderer/hooks/useCaptures'
import {
  Search,
  Sparkles,
  Download,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Fingerprint,
  ArrowUpDown,
  ArrowDown,
  ArrowUp,
  Layers,
  Globe,
  Link,
  EyeOff,
  Trash2,
  FileCode
} from 'lucide-react'
import type { Entity } from '@shared/types'

interface EnrichedEntity extends Entity {
  captureTitle: string
}

interface AggregatedEntity {
  entity: EnrichedEntity
  captureIds: { id: string; title: string; url: string; timestamp: string }[]
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

const ENTITY_TYPE_LABELS: Record<string, string> = {
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

const TYPE_DOT_CLASSES: Record<string, string> = {
  amber: 'bg-amber-500',
  sky: 'bg-sky-500',
  emerald: 'bg-emerald-500',
  violet: 'bg-violet-500',
  pink: 'bg-pink-500',
  red: 'bg-red-500',
  teal: 'bg-teal-500',
  orange: 'bg-orange-500',
  indigo: 'bg-indigo-500',
  yellow: 'bg-yellow-500',
  slate: 'bg-slate-500'
}

const TYPE_BADGE_CLASSES: Record<string, string> = {
  amber: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  sky: 'bg-sky-500/15 text-sky-400 border-sky-500/25',
  emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  violet: 'bg-violet-500/15 text-violet-400 border-violet-500/25',
  pink: 'bg-pink-500/15 text-pink-400 border-pink-500/25',
  red: 'bg-red-500/15 text-red-400 border-red-500/25',
  teal: 'bg-teal-500/15 text-teal-400 border-teal-500/25',
  orange: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  indigo: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/25',
  yellow: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  slate: 'bg-slate-500/15 text-slate-400 border-slate-500/25'
}

function getDotClass(type: string) {
  return TYPE_DOT_CLASSES[ENTITY_TYPE_COLORS[type] ?? 'slate'] ?? TYPE_DOT_CLASSES.slate
}

function getBadgeClass(type: string) {
  return TYPE_BADGE_CLASSES[ENTITY_TYPE_COLORS[type] ?? 'slate'] ?? TYPE_BADGE_CLASSES.slate
}

function getTypeLabel(type: string) {
  return ENTITY_TYPE_LABELS[type] ?? type
}

// Monospace types — values displayed in font-mono
const MONO_TYPES = new Set(['email', 'ip_address', 'crypto_wallet', 'phone', 'domain'])

type SortField = 'value' | 'type' | 'confidence' | 'captures'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 25
const MAX_VISIBLE_TYPE_CHIPS = 5

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
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<SortField>('confidence')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

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

    Promise.all(
      capturesRef.current.map(async (cap) => {
        const capEntities: Entity[] = await window.birdbrain.ai.getEntities(cap.id)
        return capEntities.map((e) => ({ ...e, captureTitle: cap.title || cap.url }))
      })
    )
      .then((results) => {
        setEntities(results.flat())
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load entities:', err)
        setLoading(false)
      })
  }, [activeCaseId, captureIds])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [typeFilter, sourceFilter, minConfidence, searchQuery])

  // Deduplicate by value+type, aggregate captures
  const aggregated = useMemo(() => {
    const map = new Map<string, AggregatedEntity>()
    for (const e of entities) {
      const key = `${e.type}:${e.value}`
      const existing = map.get(key)
      const cap = capturesRef.current.find((c) => c.id === e.captureId)
      const capInfo = {
        id: e.captureId,
        title: e.captureTitle,
        url: cap?.url ?? '',
        timestamp: cap?.timestamp ?? e.createdAt
      }
      if (existing) {
        if (!existing.captureIds.find((c) => c.id === e.captureId)) {
          existing.captureIds.push(capInfo)
        }
        if ((e.confidence ?? 0) > (existing.entity.confidence ?? 0)) {
          existing.entity = e
        }
      } else {
        map.set(key, { entity: e, captureIds: [capInfo] })
      }
    }
    return map
  }, [entities])

  // Type counts for filter chips
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const { entity } of aggregated.values()) {
      counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1)
    }
    return counts
  }, [aggregated])

  const types = useMemo(
    () => [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
    [typeCounts]
  )

  // Filter
  const filtered = useMemo(() => {
    const items = [...aggregated.values()].filter((item) => {
      if (typeFilter !== 'all' && item.entity.type !== typeFilter) return false
      if (sourceFilter !== 'all' && item.entity.source !== sourceFilter) return false
      if (minConfidence > 0 && (item.entity.confidence ?? 0) * 100 < minConfidence) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        if (!item.entity.value.toLowerCase().includes(q)) return false
      }
      return true
    })

    // Sort
    items.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'value':
          cmp = a.entity.value.localeCompare(b.entity.value)
          break
        case 'type':
          cmp = a.entity.type.localeCompare(b.entity.type)
          break
        case 'confidence':
          cmp = (a.entity.confidence ?? 0) - (b.entity.confidence ?? 0)
          break
        case 'captures':
          cmp = a.captureIds.length - b.captureIds.length
          break
      }
      return sortDir === 'desc' ? -cmp : cmp
    })

    return items
  }, [aggregated, typeFilter, sourceFilter, minConfidence, searchQuery, sortField, sortDir])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Selection
  const allPageKeys = paginated.map((item) => `${item.entity.type}:${item.entity.value}`)
  const allPageSelected = allPageKeys.length > 0 && allPageKeys.every((k) => selectedKeys.has(k))
  const somePageSelected = allPageKeys.some((k) => selectedKeys.has(k))

  function toggleSelectAll() {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (allPageSelected) {
        allPageKeys.forEach((k) => next.delete(k))
      } else {
        allPageKeys.forEach((k) => next.add(k))
      }
      return next
    })
  }

  function toggleSelect(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const uniqueCaptureCount = new Set(entities.map((e) => e.captureId)).size

  // Type chips: show top N, overflow the rest
  const visibleTypes = types.slice(0, MAX_VISIBLE_TYPE_CHIPS)
  const overflowCount = types.length - MAX_VISIBLE_TYPE_CHIPS

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-500">
        Loading entities...
      </div>
    )
  }

  if (entities.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
        <Fingerprint className="mb-3 h-10 w-10 text-slate-600" />
        <p className="text-slate-400">No entities found for this case.</p>
        <p className="mt-1 text-sm text-slate-500">
          Extract entities from captures to see them here.
        </p>
      </div>
    )
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) {
      return <ArrowUpDown className="h-2.5 w-2.5 text-slate-600" />
    }
    return sortDir === 'desc' ? (
      <ArrowDown className="h-2.5 w-2.5 text-indigo-400" />
    ) : (
      <ArrowUp className="h-2.5 w-2.5 text-indigo-400" />
    )
  }

  function renderPagination() {
    if (totalPages <= 1) return null
    const pages: (number | '...')[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (page > 3) pages.push('...')
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
        pages.push(i)
      }
      if (page < totalPages - 2) pages.push('...')
      pages.push(totalPages)
    }

    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-600 disabled:cursor-not-allowed disabled:text-slate-700"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`ellipsis-${i}`} className="text-[11px] text-slate-600">
              &hellip;
            </span>
          ) : (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-medium transition-colors ${
                page === p
                  ? 'bg-indigo-600 font-semibold text-white shadow-[0_0_10px_rgba(79,70,229,0.4)]'
                  : 'text-slate-400 hover:bg-white/5'
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page === totalPages}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 disabled:cursor-not-allowed disabled:text-slate-700"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* ===== FILTER BAR ===== */}
      <div className="flex-shrink-0 border-b border-white/[0.06] px-6 py-3.5">
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search entities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-52 rounded-lg border border-white/[0.08] bg-neutral-900 py-1.5 pl-8 pr-3 text-xs text-slate-200 placeholder-slate-600 outline-none transition-all focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/25"
            />
          </div>

          <div className="h-6 w-px bg-white/[0.08]" />

          {/* Type Filter Chips */}
          <div className="flex items-center gap-1.5">
            <span className="mr-0.5 text-[11px] font-medium text-slate-500">Type:</span>
            <button
              onClick={() => setTypeFilter('all')}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                typeFilter === 'all'
                  ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300 shadow-[0_0_12px_rgba(79,70,229,0.25)]'
                  : 'border-white/[0.08] bg-neutral-900 text-slate-400 hover:border-white/[0.15] hover:bg-neutral-800'
              }`}
            >
              All
              <span className="text-[10px] opacity-60">{aggregated.size}</span>
            </button>
            {visibleTypes.map((t) => {
              const isActive = typeFilter === t
              return (
                <button
                  key={t}
                  onClick={() => setTypeFilter(isActive ? 'all' : t)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    isActive
                      ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300 shadow-[0_0_12px_rgba(79,70,229,0.25)]'
                      : 'border-white/[0.08] bg-neutral-900 text-slate-400 hover:border-white/[0.15] hover:bg-neutral-800'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${getDotClass(t)}`} />
                  {getTypeLabel(t)}
                  <span className="text-[10px] text-slate-500">{typeCounts.get(t)}</span>
                </button>
              )
            })}
            {overflowCount > 0 && (
              <button className="rounded-lg border border-white/[0.08] bg-neutral-900 px-2 py-1.5 text-[11px] font-medium text-slate-500 hover:border-white/[0.15] hover:bg-neutral-800">
                +{overflowCount} more
              </button>
            )}
          </div>

          <div className="h-6 w-px bg-white/[0.08]" />

          {/* Source Toggle */}
          <div className="flex items-center gap-1.5">
            <span className="mr-0.5 text-[11px] font-medium text-slate-500">Source:</span>
            <div className="flex overflow-hidden rounded-lg border border-white/[0.08]">
              {(['all', 'rule', 'ai'] as const).map((src) => (
                <button
                  key={src}
                  onClick={() => setSourceFilter(src)}
                  className={`px-3 py-1.5 text-[11px] font-medium transition-colors ${
                    sourceFilter === src
                      ? 'bg-indigo-500/15 font-semibold text-indigo-300'
                      : 'bg-neutral-900 text-slate-400 hover:bg-white/5'
                  } ${src !== 'ai' ? 'border-r border-white/[0.08]' : ''}`}
                >
                  {src === 'all' ? 'All' : src === 'rule' ? 'Rule' : 'AI'}
                </button>
              ))}
            </div>
          </div>

          <div className="h-6 w-px bg-white/[0.08]" />

          {/* Confidence Slider */}
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] font-medium text-slate-500">Min confidence:</span>
            <input
              type="range"
              min="0"
              max="100"
              value={minConfidence}
              onChange={(e) => setMinConfidence(parseInt(e.target.value))}
              className="w-24"
            />
            <span className="w-8 text-right font-mono text-[11px] font-medium text-indigo-400">
              {minConfidence}%
            </span>
          </div>

          {/* Right side actions */}
          <div className="ml-auto flex items-center gap-2">
            <button className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-neutral-900 px-3 py-1.5 text-[11px] font-medium text-slate-400 transition-all hover:border-white/[0.15] hover:text-slate-200">
              <Download className="h-3 w-3" />
              Export
            </button>
            <button className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[11px] font-bold text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 active:scale-[0.98]">
              <Sparkles className="h-3 w-3" />
              Extract All
            </button>
          </div>
        </div>
      </div>

      {/* ===== SUMMARY STRIP ===== */}
      <div className="flex-shrink-0 border-b border-white/[0.06] bg-white/[0.02] px-6 py-2.5">
        <div className="flex items-center gap-4">
          <span className="text-[11px] text-slate-500">
            Showing <span className="font-bold text-white">{filtered.length}</span> entities across{' '}
            <span className="font-bold text-white">{uniqueCaptureCount}</span> captures
          </span>
          <div className="ml-auto flex items-center gap-3">
            {types.slice(0, 6).map((t) => (
              <div key={t} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${getDotClass(t)}`} />
                <span className="text-[10px] text-slate-500">{getTypeLabel(t)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ===== TABLE ===== */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-white/[0.08] bg-neutral-900">
              <th className="w-8 py-3 pl-6 pr-2">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = somePageSelected && !allPageSelected
                  }}
                  onChange={toggleSelectAll}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-neutral-800 text-indigo-600"
                />
              </th>
              <th
                onClick={() => handleSort('value')}
                className="cursor-pointer px-3.5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-200"
              >
                <span className="flex items-center gap-1">
                  Value
                  <SortIcon field="value" />
                </span>
              </th>
              <th
                onClick={() => handleSort('type')}
                className="w-28 cursor-pointer px-3.5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-200"
              >
                <span className="flex items-center gap-1">
                  Type
                  <SortIcon field="type" />
                </span>
              </th>
              <th className="w-20 px-3.5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Source
              </th>
              <th
                onClick={() => handleSort('confidence')}
                className="w-36 cursor-pointer px-3.5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-200"
              >
                <span className="flex items-center gap-1">
                  Confidence
                  <SortIcon field="confidence" />
                </span>
              </th>
              <th
                onClick={() => handleSort('captures')}
                className="w-24 cursor-pointer px-3.5 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-200"
              >
                <span className="flex items-center justify-center gap-1">
                  Captures
                  <SortIcon field="captures" />
                </span>
              </th>
              <th className="w-10 py-3 pr-6" />
            </tr>
          </thead>
          <tbody>
            {paginated.map(({ entity, captureIds: capIds }) => {
              const entityKey = `${entity.type}:${entity.value}`
              const isExpanded = expandedEntity === entityKey
              const isSelected = selectedKeys.has(entityKey)
              const conf = entity.confidence ?? 0
              const confPct = Math.round(conf * 100)
              const isMono = MONO_TYPES.has(entity.type)

              const confBarColor =
                confPct >= 80
                  ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]'
                  : confPct >= 50
                    ? 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.4)]'
                    : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.4)]'

              return (
                <Fragment key={entityKey}>
                  <tr
                    onClick={() => setExpandedEntity(isExpanded ? null : entityKey)}
                    className={`cursor-pointer border-b border-white/[0.06] transition-colors ${
                      isExpanded ? 'bg-slate-950/40' : 'hover:bg-slate-900/50'
                    }`}
                  >
                    <td className="py-3.5 pl-6 pr-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation()
                          toggleSelect(entityKey)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-3.5 w-3.5 rounded border-slate-600 bg-neutral-800 text-indigo-600"
                      />
                    </td>
                    <td className="px-3.5 py-3.5">
                      <span
                        className={`text-xs font-semibold text-white ${isMono ? 'font-mono' : ''}`}
                      >
                        {entity.value}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${getBadgeClass(entity.type)}`}
                      >
                        <span className={`h-2 w-2 rounded-full ${getDotClass(entity.type)}`} />
                        {getTypeLabel(entity.type)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {entity.source === 'ai' ? (
                        <span className="inline-flex items-center gap-1 rounded border border-indigo-500/25 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                          <Sparkles className="h-2.5 w-2.5" />
                          AI
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                          <FileCode className="h-2.5 w-2.5" />
                          Rule
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${confBarColor}`}
                            style={{ width: `${confPct}%` }}
                          />
                        </div>
                        <span className="w-9 text-right font-mono text-[11px] font-semibold text-slate-300">
                          {confPct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="inline-flex min-w-[28px] items-center justify-center rounded-full border border-indigo-500/25 bg-indigo-500/15 px-2 py-0.5 text-[11px] font-semibold text-indigo-300">
                        {capIds.length}
                      </span>
                    </td>
                    <td className="py-3 pr-6">
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 text-indigo-400" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
                      )}
                    </td>
                  </tr>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <tr className="border-b border-white/[0.06]">
                      <td colSpan={7} className="px-6 py-0">
                        <div className="py-3 pl-8">
                          <div className="mb-2.5 flex items-center gap-2">
                            <Layers className="h-3 w-3 text-slate-500" />
                            <span className="text-[11px] font-bold text-slate-300">
                              Found in {capIds.length} capture{capIds.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="flex gap-2 overflow-x-auto pb-1">
                            {capIds.slice(0, 4).map((cap) => {
                              let hostname = ''
                              try {
                                hostname = new URL(cap.url).hostname
                              } catch {
                                hostname = cap.url
                              }
                              return (
                                <button
                                  key={cap.id}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    navigateToCapture(cap.id)
                                  }}
                                  className="flex w-52 flex-shrink-0 cursor-pointer flex-col rounded-xl border border-white/[0.08] bg-neutral-900 p-3 transition-all hover:-translate-y-px hover:border-white/[0.15] hover:shadow-[0_2px_12px_rgba(0,0,0,0.4)]"
                                >
                                  <div className="mb-1.5 flex items-center gap-2">
                                    <div className="flex h-5 w-5 items-center justify-center rounded bg-gradient-to-br from-slate-700 to-slate-800">
                                      <Globe className="h-2.5 w-2.5 text-slate-400" />
                                    </div>
                                    <span className="truncate text-[11px] font-bold text-white">
                                      {cap.title}
                                    </span>
                                  </div>
                                  <span className="block truncate font-mono text-[10px] text-slate-500">
                                    {hostname}
                                  </span>
                                  <span className="mt-1 block text-[10px] text-slate-600">
                                    {new Date(cap.timestamp).toLocaleDateString([], {
                                      month: 'short',
                                      day: 'numeric'
                                    })}{' '}
                                    at{' '}
                                    {new Date(cap.timestamp).toLocaleTimeString([], {
                                      hour: 'numeric',
                                      minute: '2-digit'
                                    })}
                                  </span>
                                </button>
                              )
                            })}
                            {capIds.length > 4 && (
                              <div className="flex w-20 flex-shrink-0 items-center justify-center">
                                <span className="whitespace-nowrap text-[11px] font-medium text-indigo-400 hover:text-indigo-300">
                                  +{capIds.length - 4} more
                                </span>
                              </div>
                            )}
                          </div>
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

      {/* ===== TABLE FOOTER ===== */}
      <div className="flex flex-shrink-0 items-center justify-between border-t border-white/[0.08] px-6 py-2.5">
        <div className="flex items-center gap-3">
          {selectedKeys.size > 0 ? (
            <>
              <span className="text-[11px] text-slate-500">{selectedKeys.size} selected</span>
              <div className="h-4 w-px bg-white/[0.08]" />
              <button className="flex items-center gap-1 text-[11px] font-medium text-slate-400 transition-colors hover:text-slate-200">
                <Link className="h-2.5 w-2.5" />
                Merge
              </button>
              <button className="flex items-center gap-1 text-[11px] font-medium text-slate-400 transition-colors hover:text-slate-200">
                <EyeOff className="h-2.5 w-2.5" />
                Dismiss
              </button>
              <button className="flex items-center gap-1 text-[11px] font-medium text-red-400/70 transition-colors hover:text-red-400">
                <Trash2 className="h-2.5 w-2.5" />
                Delete
              </button>
            </>
          ) : (
            <span className="text-[11px] text-slate-500">
              {filtered.length} entit{filtered.length === 1 ? 'y' : 'ies'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {totalPages > 1 && (
            <span className="text-[11px] text-slate-500">
              Page {page} of {totalPages}
            </span>
          )}
          {renderPagination()}
        </div>
      </div>
    </div>
  )
}
