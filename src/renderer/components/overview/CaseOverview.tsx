import { useMemo, type ReactNode } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, Camera, ChevronRight, Globe, ShieldCheck, Target } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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
import { ACTIVITY_DAYS, computeOverview } from './overviewModel'
import { CaseSubhead } from './CaseSubhead'
import { SinceLastVisitBanner } from './SinceLastVisitBanner'
import { MetricRow } from './MetricRow'
import { ActivityTimeline } from './ActivityTimeline'
import { SourcesBlock } from './SourcesBlock'
import { SelectorCoverageBlock } from './SelectorCoverageBlock'
import { VerifyBar } from './VerifyBar'
import { RecentCapturesStrip } from './RecentCapturesStrip'

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
    <div className="flex flex-col gap-4" data-testid="case-overview">
      <CaseSubhead caseData={caseData} glow={false} />

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
