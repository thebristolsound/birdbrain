import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SharingErrorCode } from '@shared/types'
import { settingsQueryOptions } from '@renderer/lib/api/settings'
import { useTimeTick } from '@renderer/hooks/useTimeTick'
import { manifestSnapshotQueryOptions } from '@renderer/lib/api/exhibits'
import {
  membersQueryOptions,
  sharingAvailableQueryOptions,
  sharingErrorCode,
  syncStateQueryOptions,
  useSharingMutations
} from '@renderer/lib/api/sharing'
import { IdentityCard } from '@renderer/components/sharing/IdentityCard'
import { MembersList } from '@renderer/components/sharing/MembersList'
import { NetworkNotice } from '@renderer/components/sharing/NetworkNotice'
import { NotSharedCard } from '@renderer/components/sharing/NotSharedCard'
import { RecoveryCard } from '@renderer/components/sharing/RecoveryCard'
import { RelayCard } from '@renderer/components/sharing/RelayCard'
import { RelayUnreachableBanner } from '@renderer/components/sharing/RelayUnreachableBanner'
import { RevokeDialog, type RevokeTarget } from '@renderer/components/sharing/RevokeDialog'
import { SyncCard } from '@renderer/components/sharing/SyncCard'
import { UnavailableCard } from '@renderer/components/sharing/UnavailableCard'
import { memberRows, type MemberRow } from '@renderer/components/sharing/memberModel'

// The Members tab (#1514): one of three whole-tab states, then the shared
// view. The Invite and Review actions are wired to the invite dialog in the
// next slice; here they render and open nothing.
export function MembersTab({ caseId }: { caseId: string }) {
  const { data: available } = useQuery(sharingAvailableQueryOptions)
  const { data: members } = useQuery(membersQueryOptions(caseId))
  const shared = members !== undefined && members.members.length > 0
  const { data: syncState } = useQuery({ ...syncStateQueryOptions(caseId), enabled: shared })
  const { data: settings } = useQuery(settingsQueryOptions)
  const { data: snapshot } = useQuery({ ...manifestSnapshotQueryOptions(caseId), enabled: shared })
  // The time of the last 'relay-unreachable' refusal; no field reports relay
  // status, so the banner lives on this and clears on the next success.
  const [relayDownSince, setRelayDownSince] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const relayInput = useRef<HTMLInputElement>(null)
  const { syncNow } = useSharingMutations()
  // Rows read "last seen 2 minutes ago"; one clock keeps them current.
  const nowMs = useTimeTick(30_000)

  function onRefusal(code: SharingErrorCode | null) {
    if (code === 'relay-unreachable') setRelayDownSince(new Date().toISOString())
  }

  function retry() {
    syncNow.mutate(caseId, {
      onSuccess: () => setRelayDownSince(null),
      onError: (err) => onRefusal(sharingErrorCode(err))
    })
  }

  function onRevoke(row: MemberRow) {
    if (row.installationId === null) return
    setRevokeTarget({ installationId: row.installationId, code: row.code, name: row.name })
    setRevokeOpen(true)
  }

  const egress = settings?.egress.kind

  if (available === false) return <UnavailableCard caseId={caseId} />
  if (members === undefined) return null
  if (!shared) {
    return (
      <div className="flex flex-col gap-3" data-testid="members-tab">
        <NetworkNotice egress={egress} />
        <NotSharedCard caseId={caseId} operatorName={settings?.operatorName ?? ''} />
      </div>
    )
  }

  const rows = memberRows({ members, syncState, snapshot, nowMs })
  const self = members.members.find((m) => m.installationId === members.installationId)
  const relayDown =
    relayDownSince !== null &&
    !(
      syncState?.phase === 'idle' &&
      syncState.lastSuccessAt !== null &&
      syncState.lastSuccessAt > relayDownSince
    )
      ? relayDownSince
      : null
  const reachable = new Set(
    (syncState?.peers ?? []).filter((p) => p.reachable).map((p) => p.installationId)
  )
  const peers = members.members.filter(
    (m) => m.installationId !== members.installationId && m.revokedAtIndex === null
  )
  const connectedCodes = peers
    .filter((m) => reachable.has(m.installationId))
    .map((m) => m.memberCode)
  const unreachableCodes = peers
    .filter((m) => !reachable.has(m.installationId))
    .map((m) => m.memberCode)

  return (
    <div className="flex flex-col gap-3" data-testid="members-tab">
      <NetworkNotice egress={egress} />
      {relayDown !== null ? (
        <RelayUnreachableBanner
          since={relayDown}
          nowMs={nowMs}
          connected={connectedCodes}
          unreachable={unreachableCodes}
          retrying={syncNow.isPending || syncState?.phase === 'syncing'}
          onRetry={retry}
          onChangeRelay={() => relayInput.current?.focus()}
        />
      ) : null}
      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-3">
        {self ? <IdentityCard self={self} /> : <div />}
        <SyncCard
          caseId={caseId}
          members={members}
          syncState={syncState}
          snapshot={snapshot}
          nowMs={nowMs}
          onRefusal={onRefusal}
          onResolved={() => setRelayDownSince(null)}
        />
      </div>
      <MembersList
        members={members}
        rows={rows}
        onInvite={() => undefined}
        onReview={() => undefined}
        onRevoke={onRevoke}
      />
      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-3">
        <RelayCard
          key={settings?.sharingRelayUrl ?? ''}
          relayUrl={settings?.sharingRelayUrl ?? ''}
          inputRef={relayInput}
        />
        <RecoveryCard />
      </div>
      <RevokeDialog
        caseId={caseId}
        open={revokeOpen}
        target={revokeTarget}
        onOpenChange={setRevokeOpen}
      />
    </div>
  )
}
