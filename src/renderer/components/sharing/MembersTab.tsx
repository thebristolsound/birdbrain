import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SharingErrorCode, SharingInvite, SharingSyncOutcome } from '@shared/types'
import { caseQueryOptions } from '@renderer/lib/api/cases'
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
import { InviteDialog, type InviteStart } from '@renderer/components/sharing/InviteDialog'
import { MembersList } from '@renderer/components/sharing/MembersList'
import { NetworkNotice } from '@renderer/components/sharing/NetworkNotice'
import { NotSharedCard } from '@renderer/components/sharing/NotSharedCard'
import { RecoveryCard } from '@renderer/components/sharing/RecoveryCard'
import { RelayCard } from '@renderer/components/sharing/RelayCard'
import { RelayUnreachableBanner } from '@renderer/components/sharing/RelayUnreachableBanner'
import { RevokeDialog, type RevokeTarget } from '@renderer/components/sharing/RevokeDialog'
import { SyncCard } from '@renderer/components/sharing/SyncCard'
import { UnavailableCard } from '@renderer/components/sharing/UnavailableCard'
import {
  memberRows,
  refusalMessage,
  syncAttemptMessage,
  type MemberRow
} from '@renderer/components/sharing/memberModel'

// The Members tab (#1514): one of three whole-tab states, then the shared
// view. The invite dialog is owned here, above the state switch, because the
// first invite shares the Case and flips the tab from the not-shared card to
// the roster while the dialog stays open.
export function MembersTab({ caseId }: { caseId: string }) {
  const { data: available } = useQuery(sharingAvailableQueryOptions)
  const { data: members } = useQuery(membersQueryOptions(caseId))
  const { data: caseRecord } = useQuery(caseQueryOptions(caseId))
  const shared = members !== undefined && members.members.length > 0
  const { data: syncState } = useQuery({ ...syncStateQueryOptions(caseId), enabled: shared })
  const { data: settings } = useQuery(settingsQueryOptions)
  const { data: snapshot } = useQuery({ ...manifestSnapshotQueryOptions(caseId), enabled: shared })
  // The time of the last 'relay-unreachable' refusal; no field reports relay
  // status, so the banner lives on this and clears on the next success.
  const [relayDownSince, setRelayDownSince] = useState<string | null>(null)
  const [attemptMessage, setAttemptMessage] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const relayInput = useRef<HTMLInputElement>(null)
  // The invite string lives in memory only (main keeps no copy to read
  // back), so "Copy again" is offered while this tab still holds it.
  const [heldInvite, setHeldInvite] = useState<SharingInvite | null>(null)
  const [inviteStart, setInviteStart] = useState<InviteStart | null>(null)
  const [inviteSeq, setInviteSeq] = useState(0)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const { syncNow, createInvite } = useSharingMutations()
  // Rows read "last seen 2 minutes ago"; one clock keeps them current.
  const nowMs = useTimeTick(30_000)

  function onRefusal(code: SharingErrorCode | null) {
    if (code === 'relay-unreachable') setRelayDownSince(new Date().toISOString())
  }

  function onSyncOutcome(outcomes: SharingSyncOutcome[]) {
    const message = syncAttemptMessage(outcomes)
    setAttemptMessage(message)
    if (message === null) setRelayDownSince(null)
  }

  function onSyncError(error: unknown) {
    const code = sharingErrorCode(error)
    onRefusal(code)
    setAttemptMessage(refusalMessage(code, error instanceof Error ? error.message : String(error)))
  }

  function retry() {
    syncNow.mutate(caseId, { onSuccess: onSyncOutcome, onError: onSyncError })
  }

  function onRevoke(row: MemberRow) {
    if (row.installationId === null) return
    setRevokeTarget({ installationId: row.installationId, code: row.code, name: row.name })
    setRevokeOpen(true)
  }

  function openInvite(start: InviteStart) {
    setInviteStart(start)
    setInviteSeq((n) => n + 1)
    setInviteOpen(true)
  }

  function onCreated(invite: SharingInvite) {
    setHeldInvite(invite)
    openInvite({ kind: 'created', invite })
  }

  // Invite from the roster: an invite still open reopens on its waiting
  // step; otherwise a new one is created and shown.
  function onInvite() {
    if (members === undefined) return
    setInviteError(null)
    const [stillOpen] = members.invites
    if (stillOpen) {
      const held = heldInvite?.inviteId === stillOpen.inviteId ? heldInvite.invite : null
      openInvite({
        kind: 'waiting',
        inviteId: stillOpen.inviteId,
        expiresAt: stillOpen.expiresAt,
        invite: held
      })
      return
    }
    createInvite.mutate(
      { caseId },
      {
        onSuccess: onCreated,
        onError: (err) => {
          const code = sharingErrorCode(err)
          onRefusal(code)
          setInviteError(refusalMessage(code, err instanceof Error ? err.message : String(err)))
        }
      }
    )
  }

  function onReview(row: MemberRow) {
    const join = members?.pendingJoins.find((j) => j.requestId === row.requestId)
    if (join) openInvite({ kind: 'request', join })
  }

  const egress = settings?.egress.kind

  if (available === false) return <UnavailableCard caseId={caseId} />
  if (members === undefined) return null

  const inviteDialog = (
    <InviteDialog
      key={inviteSeq}
      caseId={caseId}
      caseName={caseRecord?.name ?? ''}
      members={members}
      open={inviteOpen}
      start={inviteStart}
      nowMs={nowMs}
      onOpenChange={setInviteOpen}
      onInviteGone={() => setHeldInvite(null)}
      onRefusal={onRefusal}
    />
  )

  if (!shared) {
    return (
      <div className="flex flex-col gap-3" data-testid="members-tab">
        <NetworkNotice egress={egress} />
        <NotSharedCard
          caseId={caseId}
          operatorName={settings?.operatorName ?? ''}
          onCreated={onCreated}
        />
        {inviteDialog}
      </div>
    )
  }

  const rows = memberRows({ members, syncState, snapshot, nowMs })
  const self = members.members.find((m) => m.installationId === members.installationId)
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
      {relayDownSince !== null ? (
        <RelayUnreachableBanner
          since={relayDownSince}
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
          attemptMessage={attemptMessage}
          onOutcome={onSyncOutcome}
          onError={onSyncError}
        />
      </div>
      <MembersList
        members={members}
        rows={rows}
        inviteError={inviteError}
        inviting={createInvite.isPending}
        onInvite={onInvite}
        onReview={onReview}
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
      {inviteDialog}
    </div>
  )
}
