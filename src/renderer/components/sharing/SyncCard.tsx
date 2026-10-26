import { RefreshCw } from 'lucide-react'
import type { CaseManifestSnapshot } from '@shared/manifestSnapshot'
import type { SharingMembers, SharingSyncOutcome, SyncState } from '@shared/types'
import { Button, Card, SectionLabel } from '@renderer/components/ui'
import { formatSeq } from '@renderer/components/data/ledgerModel'
import { useSharingMutations } from '@renderer/lib/api/sharing'
import {
  COPY,
  formatClock,
  lastMergeOf,
  syncPillModel
} from '@renderer/components/sharing/memberModel'

interface SyncCardProps {
  caseId: string
  members: SharingMembers
  syncState: SyncState | undefined
  snapshot: CaseManifestSnapshot | undefined
  nowMs: number
  attemptMessage?: string | null
  onOutcome: (outcomes: SharingSyncOutcome[]) => void
  onError: (error: unknown) => void
}

function peersConnected(state: SyncState): string {
  return `${state.peersReachable} of ${state.peersTotal} peers connected`
}

// The Sync card (#1514, mock 1a). The headline is the phase; the footer is
// what the file and the local chain remember of the last completed round.
// No "41 of 63": the IPC reports no total, so the bar is indeterminate.
export function SyncCard({
  caseId,
  members,
  syncState,
  snapshot,
  nowMs,
  attemptMessage,
  onOutcome,
  onError
}: SyncCardProps) {
  const { syncNow } = useSharingMutations()
  const roster = members.members
  const reachableNames = (syncState?.peers ?? [])
    .filter((peer) => peer.reachable)
    .map((peer) => roster.find((m) => m.installationId === peer.installationId)?.operatorName)
    .filter((name): name is string => name !== undefined)
  const syncing = syncState?.phase === 'syncing'
  const pill = syncPillModel(syncState)
  const merge = lastMergeOf(snapshot, roster)

  function run() {
    syncNow.mutate(caseId, {
      onSuccess: (outcomes) => onOutcome(outcomes),
      onError: (error) => onError(error)
    })
  }

  const footer: React.ReactNode[] = []
  if (syncState?.lastSuccessAt) {
    footer.push(
      <span key="last">
        Last completed sync{' '}
        <span className="text-text-secondary">{formatClock(syncState.lastSuccessAt, nowMs)}</span>
      </span>
    )
  }
  if (merge) {
    footer.push(
      <span key="received">
        received {merge.entriesReceived} {merge.entriesReceived === 1 ? 'entry' : 'entries'} from{' '}
        {merge.fromCode ?? merge.fromInstallationId}
      </span>,
      <span key="merge">
        Manifest entry <span className="font-medium">merge #{formatSeq(merge.index)}</span>
      </span>
    )
  }

  return (
    <Card className="flex flex-col p-4" data-testid="sync-card">
      <SectionLabel className="mb-3">Sync</SectionLabel>
      <div className="flex items-center gap-2.5">
        {syncing ? (
          <RefreshCw
            size={14}
            strokeWidth={2.2}
            className="shrink-0 animate-spin text-accent"
            data-testid="sync-spinner"
          />
        ) : null}
        <div className="min-w-0 flex-1" data-testid="sync-headline">
          {syncState?.phase === 'syncing' ? (
            <>
              <div className="text-xs font-medium text-text-primary">
                Syncing with {reachableNames.length > 0 ? reachableNames.join(', ') : 'members'}
              </div>
              <div className="text-[11px] tabular-nums text-text-muted">
                {peersConnected(syncState)}
              </div>
            </>
          ) : syncState?.phase === 'error' || pill?.chrome === 'error' ? (
            <div className="text-xs font-medium text-danger-fg">
              {pill ? `${pill.a} · ${pill.b}` : 'Sync failed'}
            </div>
          ) : attemptMessage ? (
            <div className="text-xs font-medium text-warning-fg" role="status">
              {attemptMessage}
            </div>
          ) : syncState === undefined ? (
            <div className="text-xs text-text-muted">—</div>
          ) : (
            <div className="text-xs font-medium tabular-nums text-text-primary">
              Synced · {peersConnected(syncState)}
            </div>
          )}
        </div>
        <Button
          variant="outline"
          className="border-border text-text-secondary"
          disabled={syncing || syncNow.isPending}
          onClick={run}
        >
          {COPY.syncNow}
        </Button>
      </div>
      {syncing ? (
        <div
          className="mt-2.5 h-0.5 overflow-hidden rounded-sm bg-elevated"
          role="progressbar"
          aria-label="Sync in progress"
        >
          <div className="h-full w-1/3 animate-pulse bg-accent" />
        </div>
      ) : null}
      {footer.length > 0 ? (
        <div className="mt-auto pt-3 text-[11px] text-text-muted" data-testid="sync-footer">
          {footer.map((part, i) => (
            <span key={i}>
              {i > 0 ? ' · ' : ''}
              {part}
            </span>
          ))}
        </div>
      ) : null}
    </Card>
  )
}
