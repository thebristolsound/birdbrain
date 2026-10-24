import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Clipboard, QrCode, RefreshCw, X } from 'lucide-react'
import type {
  CaseMember,
  SharingErrorCode,
  SharingInvite,
  SharingMembers,
  SharingPendingJoin
} from '@shared/types'
import { Button, Dialog, DialogContent, DialogTitle } from '@renderer/components/ui'
import { queryKeys } from '@renderer/lib/api/keys'
import { notify } from '@renderer/lib/notify'
import { sharingErrorCode, useSharingMutations } from '@renderer/lib/api/sharing'
import { InviteQr } from '@renderer/components/sharing/InviteQr'
import { MemberCodeChip } from '@renderer/components/sharing/MemberCodeChip'
import { MemberCodeField } from '@renderer/components/sharing/MemberCodeField'
import {
  COPY,
  expiresLine,
  fingerprintFull,
  hueFor,
  inviteTitle,
  joinRequestLead,
  memberAddCaption,
  memberCodeCheck,
  memberCodeHelper,
  refusalMessage,
  trustNote,
  waitingBody
} from '@renderer/components/sharing/memberModel'

// Where the dialog opens (#1514, mock 1c): with the invite just created, on
// an invite still open (the string is held only while this window created
// it), or on a join request from a row's Review.
export type InviteStart =
  | { kind: 'created'; invite: SharingInvite; pendingRequestIds: readonly string[] }
  | {
      kind: 'waiting'
      inviteId: string
      expiresAt: string
      invite: string | null
      pendingRequestIds: readonly string[]
    }
  | { kind: 'request'; join: SharingPendingJoin }

type InviteStep = InviteStart | { kind: 'done'; member: CaseMember }

interface InviteDialogProps {
  caseId: string
  caseName: string
  members: SharingMembers
  open: boolean
  // The parent keys the dialog on each opening, so the step starts here and
  // moves on its own: created to waiting on Copy, waiting to request when a
  // join arrives, request to done on Approve.
  start: InviteStart | null
  nowMs: number
  onOpenChange: (open: boolean) => void
  // The open invite is gone (cancelled, or main no longer knows it): the
  // parent drops the string it held.
  onInviteGone: () => void
  // A refusal the Members tab shows as its relay banner.
  onRefusal: (code: SharingErrorCode | null) => void
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function InviteDialog({
  caseId,
  caseName,
  members,
  open,
  start,
  nowMs,
  onOpenChange,
  onInviteGone,
  onRefusal
}: InviteDialogProps) {
  const titleId = useId()
  const codeId = useId()
  const queryClient = useQueryClient()
  const { cancelInvite, approveJoin, declineJoin } = useSharingMutations()
  const [step, setStep] = useState<InviteStep | null>(start)
  const [qrOpen, setQrOpen] = useState(true)
  const [typed, setTyped] = useState<string | null>(null)
  const [codeRefusal, setCodeRefusal] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A join that arrives while the dialog waits on the invite takes it over.
  const pendingRequestIds =
    step?.kind === 'created' || step?.kind === 'waiting' ? step.pendingRequestIds : []
  const arrived = members.pendingJoins.find((join) => !pendingRequestIds.includes(join.requestId))
  const current: InviteStep | null =
    (step?.kind === 'waiting' || step?.kind === 'created') && arrived
      ? { kind: 'request', join: arrived }
      : step

  function close() {
    setError(null)
    onOpenChange(false)
  }

  function refetchAndClose() {
    queryClient.invalidateQueries({ queryKey: queryKeys.sharingMembers(caseId) })
    close()
  }

  async function copy(invite: string, inviteId: string, expiresAt: string) {
    try {
      await navigator.clipboard.writeText(invite)
    } catch (cause) {
      notify.error('Couldn’t copy the invite to your clipboard', { cause })
      return
    }
    setStep({ kind: 'waiting', inviteId, expiresAt, invite, pendingRequestIds })
  }

  function cancel(inviteId: string) {
    setError(null)
    cancelInvite.mutate(
      { caseId, inviteId },
      {
        onSuccess: () => {
          onInviteGone()
          close()
        },
        onError: (err) => {
          const code = sharingErrorCode(err)
          if (code === 'invite-not-found') {
            onInviteGone()
            refetchAndClose()
            return
          }
          setError(refusalMessage(code, messageOf(err)))
        }
      }
    )
  }

  function approve(join: SharingPendingJoin, memberCode: string) {
    setError(null)
    setCodeRefusal(null)
    approveJoin.mutate(
      { caseId, requestId: join.requestId, memberCode },
      {
        onSuccess: (member) => setStep({ kind: 'done', member }),
        onError: (err) => {
          const code = sharingErrorCode(err)
          if (code === 'member-code-rejected') {
            setCodeRefusal(messageOf(err))
            return
          }
          if (code === 'already-member' || code === 'join-request-unknown') {
            refetchAndClose()
            return
          }
          if (code === 'relay-unreachable' || code === 'sharing-unavailable') onRefusal(code)
          setError(refusalMessage(code, messageOf(err)))
        }
      }
    )
  }

  function decline(join: SharingPendingJoin) {
    setError(null)
    declineJoin.mutate(
      { caseId, requestId: join.requestId },
      {
        onSuccess: close,
        onError: (err) => {
          const code = sharingErrorCode(err)
          if (code === 'join-request-unknown') {
            refetchAndClose()
            return
          }
          setError(refusalMessage(code, messageOf(err)))
        }
      }
    )
  }

  const title =
    current?.kind === 'created' || current?.kind === 'waiting'
      ? inviteTitle(caseName)
      : COPY.joinRequestTitle

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent
        onClose={close}
        aria-labelledby={titleId}
        className="max-w-[420px] p-4"
        data-testid="invite-dialog"
        data-step={current?.kind}
      >
        <div className="flex items-center justify-between">
          <DialogTitle id={titleId} className="font-display text-sm font-bold">
            {title}
          </DialogTitle>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={close}
            aria-label="Close"
            className="-mr-1.5 text-text-muted"
          >
            <X size={14} aria-hidden="true" />
          </Button>
        </div>

        {current?.kind === 'created' ? (
          <div className="mt-1.5">
            <p className="text-xs leading-[1.55] text-text-secondary">{COPY.inviteExplainer}</p>
            <div
              className="mt-3 break-all rounded border border-border-strong bg-canvas px-3 py-2.5 font-mono text-[11px] leading-[1.5] text-text-secondary"
              data-testid="invite-string"
            >
              {current.invite.invite}
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <Button
                className="gap-1.5"
                onClick={() =>
                  copy(current.invite.invite, current.invite.inviteId, current.invite.expiresAt)
                }
              >
                <Clipboard size={12} aria-hidden="true" />
                {COPY.copyInvite}
              </Button>
              <Button
                variant="outline"
                className="gap-1.5 border-border text-text-secondary"
                onClick={() => setQrOpen((v) => !v)}
                aria-pressed={qrOpen}
              >
                <QrCode size={12} aria-hidden="true" />
                {qrOpen ? COPY.hideQr : COPY.showQr}
              </Button>
              <span className="flex-1" />
              <span className="text-[11px] tabular-nums text-text-faint">
                {expiresLine(current.invite.expiresAt, nowMs)}
              </span>
            </div>
            {qrOpen ? (
              <div className="mt-3 flex items-center gap-3.5 rounded border border-border p-3">
                <InviteQr invite={current.invite.invite} />
                <p className="text-[11px] leading-[1.55] text-text-muted">{COPY.qrExplainer}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {current?.kind === 'waiting' ? (
          <div className="mt-1.5">
            <div className="flex items-center gap-2.5 rounded bg-elevated p-3">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-text-primary">{COPY.waitingTitle}</div>
                <div className="mt-0.5 text-[11px] text-text-muted">
                  {waitingBody(current.expiresAt, nowMs)}
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              {current.invite !== null ? (
                <Button
                  variant="outline"
                  className="border-border text-text-secondary"
                  onClick={() => {
                    const held = current.invite
                    if (held !== null) copy(held, current.inviteId, current.expiresAt)
                  }}
                >
                  {COPY.copyAgain}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                className="text-danger-fg hover:text-danger-fg"
                disabled={cancelInvite.isPending}
                onClick={() => cancel(current.inviteId)}
              >
                {COPY.cancelInvite}
              </Button>
              <span className="flex-1" />
              <Button onClick={close}>{COPY.done}</Button>
            </div>
          </div>
        ) : null}

        {current?.kind === 'request' ? (
          <RequestStep
            join={current.join}
            members={members}
            codeId={codeId}
            typed={typed}
            codeRefusal={codeRefusal}
            nowMs={nowMs}
            pending={approveJoin.isPending || declineJoin.isPending}
            onType={(value) => {
              setTyped(value)
              setCodeRefusal(null)
            }}
            onApprove={(code) => approve(current.join, code)}
            onDecline={() => decline(current.join)}
          />
        ) : null}

        {current?.kind === 'done' ? (
          <div className="mt-3" data-testid="invite-done">
            <div className="grid min-h-10 grid-cols-[56px_1fr_88px_190px] items-center rounded bg-accent-subtle px-2.5 text-xs">
              <span className="flex items-center">
                <MemberCodeChip
                  code={current.member.memberCode}
                  hue={hueFor(
                    members.members,
                    members.installationId,
                    current.member.installationId
                  )}
                  size={18}
                  dot
                />
              </span>
              <span className="font-medium text-text-primary">{current.member.operatorName}</span>
              <span className="text-text-muted">Member</span>
              <span className="flex items-center gap-1.5 text-text-secondary">
                <RefreshCw
                  size={11}
                  strokeWidth={2.2}
                  className="animate-spin text-accent"
                  aria-hidden="true"
                />
                Syncing
              </span>
            </div>
            <p className="mt-2 text-[11px] text-text-muted">
              {memberAddCaption(current.member.addedAtIndex)}
            </p>
            <div className="mt-3 flex justify-end">
              <Button onClick={close}>{COPY.done}</Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="mt-2 text-[11px] text-danger-fg" data-testid="invite-dialog-error">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

interface RequestStepProps {
  join: SharingPendingJoin
  members: SharingMembers
  codeId: string
  typed: string | null
  codeRefusal: string | null
  nowMs: number
  pending: boolean
  onType: (value: string) => void
  onApprove: (code: string) => void
  onDecline: () => void
}

function RequestStep({
  join,
  members,
  codeId,
  typed,
  codeRefusal,
  nowMs,
  pending,
  onType,
  onApprove,
  onDecline
}: RequestStepProps) {
  const value = typed ?? join.suggestedMemberCode
  const check = memberCodeCheck(value, members.members, join.operatorName)
  const shown = check.code.length > 0 ? check.code : join.suggestedMemberCode
  return (
    <div className="mt-1.5" data-testid="join-request">
      <p className="text-xs leading-[1.55] text-text-secondary">
        {joinRequestLead(join.receivedAt, nowMs)}
      </p>
      <div className="mt-3 grid grid-cols-[110px_1fr] items-baseline gap-x-3 gap-y-2 text-xs">
        <span className="text-text-muted">{COPY.operatorNameLabel}</span>
        <span className="font-medium text-text-primary">{join.operatorName}</span>
        <span className="text-text-muted">{COPY.fingerprintLabel}</span>
        <span className="font-mono text-[11px] text-text-secondary" data-testid="join-fingerprint">
          {fingerprintFull(join.fingerprint)}
        </span>
        <label htmlFor={codeId} className="text-text-muted">
          {COPY.memberCodeLabel}
        </label>
        <div>
          <MemberCodeField
            id={codeId}
            value={value}
            check={check}
            refusal={codeRefusal}
            onChange={onType}
          />
          <p className="mt-1 text-[11px] text-text-faint" data-testid="member-code-helper">
            {memberCodeHelper(shown)}
          </p>
        </div>
      </div>
      <div className="mt-3 rounded border border-border px-2.5 py-2 text-[11px] leading-[1.55] text-text-muted">
        {trustNote(join.operatorName)}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          variant="outline"
          className="border-border text-text-secondary"
          disabled={pending}
          onClick={onDecline}
        >
          {COPY.decline}
        </Button>
        <Button disabled={pending || !check.ok} onClick={() => onApprove(check.code)}>
          {COPY.approve}
        </Button>
      </div>
    </div>
  )
}
