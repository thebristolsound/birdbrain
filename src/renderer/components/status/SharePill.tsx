import { useQuery } from '@tanstack/react-query'
import { LoaderCircle, TriangleAlert, Users } from 'lucide-react'
import {
  membersQueryOptions,
  sharingAvailableQueryOptions,
  syncStateQueryOptions
} from '@renderer/lib/api/sharing'
import { useTimeTick } from '@renderer/hooks/useTimeTick'
import { cn } from '@renderer/lib/utils'
import {
  COPY,
  egressLabel,
  networkNoticeShort,
  sharePillModel
} from '@renderer/components/sharing/memberModel'

// The top bar's sharing control (docs/design-handoff/2026-10-28-share-a-case/,
// frames B and G): one button whose label follows the Case from "Share" to its
// sync state, every state opening Members. Below `lg` the label folds to the
// icon or the dot and the tooltip carries it, as the Export button's does.
export function SharePill({
  caseId,
  onOpenMembers
}: {
  caseId: string
  onOpenMembers: () => void
}) {
  const { data: available } = useQuery(sharingAvailableQueryOptions)
  const { data: members } = useQuery(membersQueryOptions(caseId))
  // Only a Case with a roster polls its sync state, as the Members tab does.
  const shared = members !== undefined && members.members.length > 0
  const { data: state } = useQuery({ ...syncStateQueryOptions(caseId), enabled: shared })
  const nowMs = useTimeTick(60_000)
  const pill = sharePillModel({ available, members, syncState: state, nowMs })
  if (!pill) return null
  const { sync } = pill
  return (
    <button
      type="button"
      onClick={onOpenMembers}
      title={pill.title}
      data-testid="share-pill"
      data-state={pill.state}
      data-chrome={sync?.chrome}
      data-tour="share"
      className={cn(
        'group relative inline-flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-full border px-[7px] text-[11px] font-medium lg:px-2.5',
        sync
          ? sync.chrome === 'error'
            ? 'border-danger-fg/35 bg-danger-fg/8 text-danger-fg'
            : sync.chrome === 'active'
              ? 'border-border-strong text-text-secondary'
              : 'border-border text-text-muted'
          : pill.state === 'unavailable'
            ? 'border-dashed border-border text-text-faint'
            : 'border-border-strong text-text-secondary transition-colors hover:bg-elevated hover:text-text-primary'
      )}
    >
      {sync ? (
        <>
          {sync.glyph && (
            <span tabIndex={0} aria-label={COPY.glyphLabel} className="group/notice relative">
              <TriangleAlert size={12} className="text-warning-fg" />
              <span
                role="tooltip"
                className="absolute right-0 top-full z-50 hidden w-[300px] rounded border border-border-strong bg-elevated px-3 py-2.5 text-left text-[11px] text-text-secondary shadow-xl group-hover/notice:block group-focus/notice:block"
              >
                {networkNoticeShort(egressLabel(state?.egress ?? 'unavailable'))}
                <span className="mt-1 block text-accent">{COPY.detailsInMembers}</span>
              </span>
            </span>
          )}
          {sync.spinner ? (
            <LoaderCircle size={12} className="animate-spin" />
          ) : (
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                sync.dot === 'danger'
                  ? 'bg-danger-fg'
                  : sync.dot === 'warning'
                    ? 'bg-warning-fg'
                    : 'bg-success-fg'
              )}
            />
          )}
        </>
      ) : (
        <>
          {/* The icon-only form is a 28px circle; the waiting dot sits in the icon's corner. */}
          <span className="relative flex lg:hidden">
            <Users size={12} />
            {pill.dot && (
              <span
                className={cn(
                  'absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-warning-fg',
                  pill.pulse && 'animate-pulse'
                )}
              />
            )}
          </span>
          {pill.dot ? (
            <span
              className={cn(
                'hidden h-1.5 w-1.5 rounded-full bg-warning-fg lg:block',
                pill.pulse && 'animate-pulse'
              )}
            />
          ) : (
            <Users size={12} className="hidden lg:block" />
          )}
        </>
      )}
      <span className="sr-only lg:not-sr-only">
        {pill.b === null ? pill.a : `${pill.a} · ${pill.b}`}
      </span>
    </button>
  )
}
