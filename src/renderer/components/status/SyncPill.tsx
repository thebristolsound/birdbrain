import { useQuery } from '@tanstack/react-query'
import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { syncStateQueryOptions } from '@renderer/lib/api/sharing'
import { cn } from '@renderer/lib/utils'
import {
  COPY,
  egressLabel,
  networkNoticeShort,
  syncPillModel
} from '@renderer/components/sharing/memberModel'

export function SyncPill({ caseId, onOpenMembers }: { caseId: string; onOpenMembers: () => void }) {
  const { data: state } = useQuery(syncStateQueryOptions(caseId))
  const pill = syncPillModel(state)
  if (!pill) return null
  return (
    <button
      type="button"
      onClick={onOpenMembers}
      title={pill.title}
      data-testid="sync-pill"
      data-chrome={pill.chrome}
      className={cn(
        'group relative inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium',
        pill.chrome === 'error'
          ? 'border-danger-fg/35 bg-danger-fg/8 text-danger-fg'
          : pill.chrome === 'active'
            ? 'border-border-strong text-text-secondary'
            : 'border-border text-text-muted'
      )}
    >
      {pill.glyph && (
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
      {pill.spinner ? (
        <LoaderCircle size={12} className="animate-spin" />
      ) : (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            pill.dot === 'danger'
              ? 'bg-danger-fg'
              : pill.dot === 'warning'
                ? 'bg-warning-fg'
                : 'bg-success-fg'
          )}
        />
      )}
      <span>
        {pill.a} · {pill.b}
      </span>
    </button>
  )
}
