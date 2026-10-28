import type { SharingMembers } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { MemberCodeChip } from '@renderer/components/sharing/MemberCodeChip'
import { COPY, caseRoleLine } from '@renderer/components/sharing/memberModel'

// What this installation is to a Case, in one line (docs/design-handoff/
// 2026-10-28-share-a-case/, frame E): under a dashboard card's description,
// and in the Sharing cell of the Older Cases list, where a local Case reads
// as the action it offers instead.
interface CaseRoleLineProps {
  shared: boolean
  members: SharingMembers | undefined
  nowMs: number
  variant?: 'card' | 'row'
  className?: string
}

export function CaseRoleLine({
  shared,
  members,
  nowMs,
  variant = 'card',
  className
}: CaseRoleLineProps) {
  const line = caseRoleLine(shared, members, nowMs)
  if (line === null) return null
  const local = line.kind === 'local'
  return (
    <div
      data-testid="case-role-line"
      data-kind={line.kind}
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-[11px]',
        local && variant === 'card' ? 'text-text-faint' : 'text-text-muted',
        className
      )}
    >
      {line.kind === 'invite' && (
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-warning-fg" />
      )}
      {(line.kind === 'owner' || line.kind === 'joined') && (
        <MemberCodeChip code={line.code} hue="accent" size={16} dot />
      )}
      <span className="truncate">
        {local && variant === 'row' ? COPY.shareThisCase : line.text}
      </span>
    </div>
  )
}
