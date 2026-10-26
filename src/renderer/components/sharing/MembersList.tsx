import { Plus } from 'lucide-react'
import type { SharingMembers } from '@shared/types'
import { Button, Card, SectionLabel } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import { MemberCodeChip } from '@renderer/components/sharing/MemberCodeChip'
import { NewerVersionStrip } from '@renderer/components/sharing/NewerVersionStrip'
import {
  CONNECTION_TONE_CLASSES,
  COPY,
  DOT_TONE_CLASSES,
  PULSE_CLASSES,
  memberCount,
  type MemberRow
} from '@renderer/components/sharing/memberModel'

const GRID = 'grid grid-cols-[56px_minmax(160px,1fr)_88px_200px_150px_72px] items-center px-4'

interface MembersListProps {
  members: SharingMembers
  rows: MemberRow[]
  // A refusal of the last Invite, shown beside the button; the mock draws
  // none, so it is one plain sentence from refusalMessage.
  inviteError?: string | null
  inviting?: boolean
  onInvite: () => void
  onReview: (row: MemberRow) => void
  onRevoke: (row: MemberRow) => void
}

// The roster (#1514, mock 1a): one row per member plus one per pending join,
// in the shape memberRows() computed. Nothing here decides a state; the cell
// classes come from the model's tone tables.
export function MembersList({
  members,
  rows,
  inviteError = null,
  inviting = false,
  onInvite,
  onReview,
  onRevoke
}: MembersListProps) {
  return (
    <Card className="p-0" data-testid="members-list">
      <div className="flex items-center gap-2 px-4 pb-2 pt-3">
        <SectionLabel data-testid="members-count">
          Members · {memberCount(members.members)}
        </SectionLabel>
        <span className="flex-1" />
        {inviteError ? (
          <span className="text-[11px] text-danger-fg" data-testid="invite-error">
            {inviteError}
          </span>
        ) : null}
        {members.isOwner ? (
          <Button
            onClick={onInvite}
            disabled={inviting}
            className="gap-1.5"
            data-testid="invite-button"
          >
            <Plus size={12} strokeWidth={2.2} aria-hidden="true" />
            {COPY.invite}
          </Button>
        ) : null}
      </div>
      <div
        className={cn(
          GRID,
          'border-b border-border py-1 text-[10px] font-medium uppercase tracking-[.05em] text-text-faint'
        )}
      >
        <span>Code</span>
        <span>Operator</span>
        <span>Role</span>
        <span>Connection</span>
        <span>Last synced</span>
        <span />
      </div>
      {rows.map((row) => (
        <div key={row.key} className="border-b border-border" data-testid={`member-row-${row.key}`}>
          <div
            className={cn(
              GRID,
              'group min-h-10 text-xs hover:bg-elevated',
              row.dimmed && 'opacity-[.55]'
            )}
            data-connection={row.connection.label}
          >
            <span className="flex items-center">
              <MemberCodeChip code={row.code} hue={row.hue} size={18} dot />
            </span>
            <span className="flex min-w-0 items-baseline gap-2 overflow-hidden">
              <span className="whitespace-nowrap font-medium text-text-primary">{row.name}</span>
              {row.fingerprint ? (
                <span className="truncate font-mono text-[10px] text-text-faint">
                  {row.fingerprint}
                </span>
              ) : null}
            </span>
            <span className="text-text-muted">{row.role}</span>
            <span
              className={cn(
                'flex items-center gap-1.5',
                CONNECTION_TONE_CLASSES[row.connection.tone]
              )}
              data-testid="member-connection"
              data-tone={row.connection.tone}
              data-dot={row.connection.dot}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  DOT_TONE_CLASSES[row.connection.dot],
                  PULSE_CLASSES[row.connection.pulse]
                )}
              />
              {row.connection.label}
            </span>
            <span className="tabular-nums text-text-muted">{row.lastSynced}</span>
            <span className="flex justify-end">
              {row.action === 'revoke' ? (
                <Button
                  variant="outline"
                  size="xs"
                  className="h-6 border-border px-2 text-[11px] text-danger-fg opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => onRevoke(row)}
                >
                  {COPY.revoke}
                </Button>
              ) : row.action === 'review' ? (
                <Button size="xs" className="h-6 px-2 text-[11px]" onClick={() => onReview(row)}>
                  {COPY.review}
                </Button>
              ) : null}
            </span>
          </div>
          {row.paused ? <NewerVersionStrip strip={row.paused} /> : null}
        </div>
      ))}
      <p className="px-4 pb-3 pt-2.5 text-[11px] leading-[1.55] text-text-faint">
        {COPY.membersFootnote}
      </p>
    </Card>
  )
}
