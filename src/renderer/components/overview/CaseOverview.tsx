import { useCallback, useMemo, type ReactNode } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Camera,
  ChevronRight,
  Crosshair,
  Globe,
  ShieldCheck,
  StickyNote,
  Tags
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Selector } from '@shared/types'
import {
  caseQueryOptions,
  capturesQueryOptions,
  notesQueryOptions,
  selectorMatchCountsQueryOptions,
  selectorsQueryOptions,
  tagCountForCaseQueryOptions,
  tagsQueryOptions,
  tagUsageCountsForCaseQueryOptions,
  useSelectorsMutations
} from '@renderer/lib/queries'
import { noteReferenceEdgesQueryOptions } from '@renderer/lib/api/notes'
import { useLastVisit } from '@renderer/hooks/useLastVisit'
import { useAppStore } from '@renderer/stores/appStore'
import { Skeleton } from '@renderer/components/ui'
import { ACTIVITY_DAYS, computeOverview } from '@renderer/components/overview/overviewModel'
import { CaseSubhead } from '@renderer/components/overview/CaseSubhead'
import { SinceLastVisitBanner } from '@renderer/components/overview/SinceLastVisitBanner'
import { MetricRow } from '@renderer/components/overview/MetricRow'
import { ActivityTimeline } from '@renderer/components/overview/ActivityTimeline'
import { SourcesBlock } from '@renderer/components/overview/SourcesBlock'
import { VerifyBar } from '@renderer/components/overview/VerifyBar'
import { RecentCapturesStrip } from '@renderer/components/overview/RecentCapturesStrip'
import { BacklinkMap } from '@renderer/components/overview/BacklinkMap'
import { QuickNotesBlock } from '@renderer/components/overview/QuickNotesBlock'
import { OverviewTagsBlock } from '@renderer/components/overview/OverviewTagsBlock'
import { OverviewSelectorsBlock } from '@renderer/components/overview/OverviewSelectorsBlock'
import type { BacklinkMapLabels } from '@renderer/components/overview/backlinkMapModel'

interface SectionCardProps {
  icon: LucideIcon
  title: string
  action?: string
  onAction?: () => void
  badge?: ReactNode
  className?: string
  children: ReactNode
}

function SectionCard({
  icon: Icon,
  title,
  action,
  onAction,
  badge,
  className,
  children
}: SectionCardProps) {
  return (
    <div className={`neu-card rounded-2xl p-[var(--d-card)] ${className ?? ''}`}>
      <div className="mb-3 flex items-center gap-[7px]">
        <Icon size={13} strokeWidth={1.8} className="shrink-0 text-text-faint" />
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.06em] text-text-faint">
          {title}
        </span>
        {badge}
        <span className="flex-1" />
        {action ? (
          <button
            onClick={onAction}
            className="inline-flex shrink-0 items-center gap-1 font-display text-[11px] font-semibold text-text-muted hover:text-text-secondary"
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
  const { data: tags = [] } = useQuery(tagsQueryOptions)
  const { data: tagUsage = {} } = useQuery(tagUsageCountsForCaseQueryOptions(caseId ?? ''))
  const { data: notes = [] } = useQuery(notesQueryOptions(caseId ?? ''))
  const { data: referenceEdges = [] } = useQuery(noteReferenceEdgesQueryOptions(caseId ?? ''))

  const { update: updateSelector } = useSelectorsMutations(caseId ?? '')

  const derived = useMemo(
    () => computeOverview({ captures, selectors, notes, lastVisitAt }),
    [captures, selectors, notes, lastVisitAt]
  )

  const mapNotes = useMemo(
    () => notes.map(({ id, title }) => ({ id, title })),
    [notes]
  )

  // Mention targets carry no label in the index — a Mention is identity, so the
  // display name is whatever the target is called now. Resolved here against
  // the list queries already mounted for this screen rather than in SQL
  // (maintainer ruling 2026-08-21).
  const mapLabels = useMemo<BacklinkMapLabels>(
    () => ({
      capture: Object.fromEntries(captures.map((c) => [c.id, c.title || c.url])),
      selector: Object.fromEntries(selectors.map((s) => [s.id, s.label || s.pattern])),
      tag: Object.fromEntries(tags.map((t) => [t.id, t.name])),
      note: Object.fromEntries(notes.map((n) => [n.id, n.title || '(Untitled note)']))
    }),
    [captures, selectors, tags, notes]
  )

  const openNote = useCallback(
    (noteId: string) => {
      if (!caseId) return
      useAppStore.getState().setSelectedNoteId(noteId)
      navigate({ to: '/cases/$caseId/notes', params: { caseId } })
    },
    [caseId, navigate]
  )

  const toggleSelector = useCallback(
    (selector: Selector, enabled: boolean) => {
      updateSelector.mutate({ id: selector.id, enabled })
    },
    [updateSelector]
  )

  if (!caseId) return null

  if (caseLoading || !caseData) {
    return (
      <div className="flex flex-col gap-[var(--d-gap)]">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }

  const goToCaptures = () => navigate({ to: '/cases/$caseId/captures', params: { caseId } })
  const goToSignals = () => navigate({ to: '/cases/$caseId/signals', params: { caseId } })
  const goToNotes = () => navigate({ to: '/cases/$caseId/notes', params: { caseId } })
  const openCapture = (captureId: string) => {
    useAppStore.getState().setSelectedCaptureId(captureId)
    navigate({ to: '/cases/$caseId/captures', params: { caseId } })
  }

  const showBanner = lastVisitAt != null && derived.newCount > 0

  return (
    <div className="flex flex-col gap-[var(--d-gap)]" data-testid="case-overview">
      <CaseSubhead caseData={caseData} glow={false} />

      <MetricRow
        captures={captures.length}
        sources={derived.sourceCount}
        selectors={selectors.length}
        tags={tagCount}
        notes={notes.length}
        deltas={showBanner ? derived.deltas : undefined}
      />

      <div className="flex items-stretch gap-[var(--d-gap)]">
        <div className="flex min-w-0 flex-[1.55] flex-col gap-[var(--d-gap)]">
          <BacklinkMap
            notes={mapNotes}
            edges={referenceEdges}
            labels={mapLabels}
            onOpenNote={openNote}
            onAllNotes={goToNotes}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-[var(--d-gap)]">
          <SectionCard
            icon={StickyNote}
            title="Quick notes"
            action="All notes"
            onAction={goToNotes}
          >
            <QuickNotesBlock caseId={caseId} notes={notes} />
          </SectionCard>
          {showBanner ? (
            <SinceLastVisitBanner
              deltas={derived.deltas}
              lastVisitAt={lastVisitAt}
              newCount={derived.newCount}
              onReview={goToCaptures}
            />
          ) : null}
          <SectionCard icon={Tags} title="Tags" action="Manage" onAction={goToSignals}>
            <OverviewTagsBlock tags={tags} usageCounts={tagUsage} onManage={goToSignals} />
          </SectionCard>
          <SectionCard
            icon={Crosshair}
            title="Selectors"
            action="Manage"
            onAction={goToSignals}
            badge={
              <span className="rounded-md bg-accent-subtle px-1.5 py-px font-mono text-[10px] font-semibold text-accent">
                {selectors.length}
              </span>
            }
          >
            <OverviewSelectorsBlock
              selectors={selectors}
              matchCounts={matchCounts}
              onToggle={toggleSelector}
            />
          </SectionCard>
        </div>
      </div>

      <div className="flex items-stretch gap-[var(--d-gap)]">
        <div className="flex min-w-0 flex-[1.55] flex-col gap-[var(--d-gap)]">
          <SectionCard
            icon={Camera}
            title="Recent captures"
            action="View all"
            onAction={goToCaptures}
          >
            <RecentCapturesStrip
              captures={derived.recent}
              lastVisitAt={lastVisitAt}
              onOpen={openCapture}
            />
          </SectionCard>
          <SectionCard
            icon={Activity}
            title="Capture activity"
            action="Open timeline"
            onAction={goToCaptures}
            className="flex-1"
          >
            <ActivityTimeline days={derived.dayBuckets} rangeDays={ACTIVITY_DAYS} />
          </SectionCard>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-[var(--d-gap)]">
          {/* Kept against the mock's consolidated branch, which drops it: this
              is the app's only case-level verified/tampered display. */}
          <SectionCard icon={ShieldCheck} title="Evidence integrity">
            <VerifyBar
              verified={derived.verified}
              unverified={derived.unverified}
              tampered={derived.tampered}
            />
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
      </div>
    </div>
  )
}
