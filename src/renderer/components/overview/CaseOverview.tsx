import { useMemo, type ReactNode } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, Camera, ChevronRight, Globe, ShieldCheck, Target } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Capture, Note, Selector } from '@shared/types'
import {
  caseQueryOptions,
  capturesQueryOptions,
  notesQueryOptions,
  selectorMatchCountsQueryOptions,
  selectorsQueryOptions,
  tagCountForCaseQueryOptions
} from '@renderer/lib/queries'
import { useLastVisit } from '@renderer/hooks/useLastVisit'
import { useAppStore } from '@renderer/stores/appStore'
import { Skeleton } from '@renderer/components/ui'
import { CaseSubhead } from './CaseSubhead'
import { SinceLastVisitBanner } from './SinceLastVisitBanner'
import { MetricRow } from './MetricRow'
import { ActivityTimeline } from './ActivityTimeline'
import { SourcesBlock } from './SourcesBlock'
import { SelectorCoverageBlock } from './SelectorCoverageBlock'
import { VerifyBar } from './VerifyBar'
import { RecentCapturesStrip } from './RecentCapturesStrip'

const ACTIVITY_DAYS = 14
const DAY_MS = 86_400_000
// Deterministic tone palette, applied by sorted source rank.
const SOURCE_TONES = [
  '#38bdf8',
  '#f472b6',
  '#a78bfa',
  '#fbbf24',
  '#34d399',
  '#fb923c',
  '#60a5fa',
  '#f87171',
  '#2dd4bf',
  '#c084fc'
]

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function dayStartMs(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

interface ComputeInput {
  captures: Capture[]
  selectors: Selector[]
  matchCounts: Record<string, number>
  notes: Note[]
  lastVisitAt: string | null
}

function computeOverview({ captures, selectors, matchCounts, notes, lastVisitAt }: ComputeInput) {
  const hostCounts = new Map<string, number>()
  const hostFirstSeen = new Map<string, string>()
  for (const cap of captures) {
    const host = hostOf(cap.url)
    if (!host) continue
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1)
    const seen = hostFirstSeen.get(host)
    if (!seen || cap.createdAt < seen) hostFirstSeen.set(host, cap.createdAt)
  }

  const sources = [...hostCounts.entries()]
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((s, i) => ({ ...s, tone: SOURCE_TONES[i % SOURCE_TONES.length] }))

  let verified = 0
  let tampered = 0
  for (const cap of captures) {
    const st = cap.lastVerifiedStatus
    if (st === 'verified') verified++
    else if (st === 'tampered' || st === 'chain-broken' || st === 'missing') tampered++
  }
  const unverified = captures.length - verified - tampered

  const coverageRows = selectors
    .map((s) => ({
      id: s.id,
      label: s.label,
      pattern: s.pattern,
      isRegex: s.isRegex,
      matchCount: matchCounts[s.id] ?? 0
    }))
    .sort((a, b) => b.matchCount - a.matchCount)
    .slice(0, 6)

  const startOfToday = dayStartMs(Date.now())
  const cutoffMs = lastVisitAt ? new Date(lastVisitAt).getTime() : null
  const counts = new Array(ACTIVITY_DAYS).fill(0)
  for (const cap of captures) {
    const t = new Date(cap.createdAt).getTime()
    if (Number.isNaN(t)) continue
    const fromToday = Math.floor((startOfToday - dayStartMs(t)) / DAY_MS)
    if (fromToday < 0 || fromToday >= ACTIVITY_DAYS) continue
    counts[ACTIVITY_DAYS - 1 - fromToday]++
  }
  const dayBuckets = counts.map((count, i) => {
    const dayStart = startOfToday - (ACTIVITY_DAYS - 1 - i) * DAY_MS
    return { count, fresh: cutoffMs != null && dayStart + DAY_MS > cutoffMs }
  })

  const recent = [...captures]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6)

  const cutoff = lastVisitAt
  const newCaptures = cutoff ? captures.filter((c) => c.createdAt > cutoff).length : 0
  const newSelectors = cutoff ? selectors.filter((s) => s.createdAt > cutoff).length : 0
  const newNotes = cutoff ? notes.filter((n) => n.createdAt > cutoff).length : 0
  let newSources = 0
  if (cutoff) {
    for (const firstSeen of hostFirstSeen.values()) {
      if (firstSeen > cutoff) newSources++
    }
  }
  const deltas = {
    captures: newCaptures,
    sources: newSources,
    selectors: newSelectors,
    notes: newNotes
  }

  return {
    sourceCount: hostCounts.size,
    sources,
    verified,
    unverified,
    tampered,
    coverageRows,
    dayBuckets,
    recent,
    deltas,
    newCount: newCaptures + newSelectors + newNotes + newSources
  }
}

interface SectionCardProps {
  icon: LucideIcon
  title: string
  action?: string
  onAction?: () => void
  tone?: string
  className?: string
  children: ReactNode
}

function SectionCard({
  icon: Icon,
  title,
  action,
  onAction,
  tone,
  className,
  children
}: SectionCardProps) {
  return (
    <div className={`neu-card rounded-2xl p-5 ${className ?? ''}`}>
      <div className="mb-3.5 flex items-center gap-2">
        <Icon size={15} strokeWidth={1.8} className={tone ?? 'text-text-muted'} />
        <span className="font-display text-[13.5px] font-bold tracking-tight text-text-primary">
          {title}
        </span>
        <span className="flex-1" />
        {action ? (
          <button
            onClick={onAction}
            className="inline-flex items-center gap-1 font-display text-[11.5px] font-semibold text-text-muted hover:text-text-secondary"
          >
            {action}
            <ChevronRight size={12} strokeWidth={1.8} />
          </button>
        ) : null}
      </div>
      {children}
    </div>
  )
}

export function CaseOverview() {
  const { caseId } = useParams({ strict: false }) as { caseId?: string }
  const navigate = useNavigate()
  const lastVisitAt = useLastVisit(caseId ?? '')

  const { data: caseData, isLoading: caseLoading } = useQuery({
    ...caseQueryOptions(caseId ?? ''),
    enabled: !!caseId
  })
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId ?? ''))
  const { data: selectors = [] } = useQuery(selectorsQueryOptions(caseId ?? ''))
  const { data: matchCounts = {} } = useQuery(selectorMatchCountsQueryOptions(caseId ?? ''))
  const { data: tagCount = 0 } = useQuery(tagCountForCaseQueryOptions(caseId ?? ''))
  const { data: notes = [] } = useQuery(notesQueryOptions(caseId ?? ''))

  const derived = useMemo(
    () => computeOverview({ captures, selectors, matchCounts, notes, lastVisitAt }),
    [captures, selectors, matchCounts, notes, lastVisitAt]
  )

  if (!caseId) return null

  if (caseLoading || !caseData) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }

  const goToCaptures = () => navigate({ to: '/cases/$caseId/captures', params: { caseId } })
  const goToSelectors = () => navigate({ to: '/cases/$caseId/selectors', params: { caseId } })
  const openCapture = (captureId: string) => {
    useAppStore.getState().setSelectedCaptureId(captureId)
    navigate({ to: '/cases/$caseId/captures', params: { caseId } })
  }

  const showBanner = lastVisitAt != null && derived.newCount > 0

  return (
    <div className="flex flex-col gap-4">
      <CaseSubhead caseData={caseData} glow />

      {showBanner ? (
        <SinceLastVisitBanner
          deltas={derived.deltas}
          lastVisitAt={lastVisitAt}
          newCount={derived.newCount}
          onReview={goToCaptures}
        />
      ) : null}

      <MetricRow
        captures={captures.length}
        sources={derived.sourceCount}
        selectors={selectors.length}
        tags={tagCount}
        notes={notes.length}
        deltas={showBanner ? derived.deltas : undefined}
      />

      <div className="flex items-stretch gap-4">
        <div className="flex min-w-0 flex-[1.55] flex-col gap-4">
          <SectionCard
            icon={Activity}
            title="Capture activity"
            tone="text-accent"
            action="Open timeline"
            onAction={goToCaptures}
          >
            <ActivityTimeline days={derived.dayBuckets} rangeDays={ACTIVITY_DAYS} />
          </SectionCard>
          <SectionCard
            icon={Globe}
            title="Top sources"
            action="All sources"
            onAction={goToCaptures}
            className="flex-1"
          >
            <SourcesBlock sources={derived.sources} />
          </SectionCard>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <SectionCard icon={Target} title="Selector coverage" action="Manage" onAction={goToSelectors}>
            <SelectorCoverageBlock selectors={derived.coverageRows} totalCaptures={captures.length} />
          </SectionCard>
          <SectionCard icon={ShieldCheck} title="Evidence integrity" className="flex-1">
            <VerifyBar
              verified={derived.verified}
              unverified={derived.unverified}
              tampered={derived.tampered}
            />
          </SectionCard>
        </div>
      </div>

      <SectionCard icon={Camera} title="Recent captures" action="View all" onAction={goToCaptures}>
        <RecentCapturesStrip captures={derived.recent} lastVisitAt={lastVisitAt} onOpen={openCapture} />
      </SectionCard>
    </div>
  )
}
