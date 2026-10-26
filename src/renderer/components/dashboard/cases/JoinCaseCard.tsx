import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LoaderCircle, TriangleAlert, WifiOff, X } from 'lucide-react'
import type { SharingJoinStep } from '@shared/types'
import { Button, Card, Label, Textarea } from '@renderer/components/ui'
import { settingsQueryOptions } from '@renderer/lib/api/settings'
import { NetworkNotice } from '@renderer/components/sharing/NetworkNotice'
import { useTimeTick } from '@renderer/hooks/useTimeTick'
import {
  invitePreviewQueryOptions,
  sharingErrorCode,
  useSharingMutations
} from '@renderer/lib/api/sharing'
import {
  COPY,
  expiryPhrase,
  joinFailure,
  joinWaitingTitle
} from '@renderer/components/sharing/memberModel'

export function JoinCaseCard({
  onBack,
  onJoined
}: {
  onBack: () => void
  onJoined: (caseId: string) => void
}) {
  const [invite, setInvite] = useState('')
  const [failure, setFailure] = useState<unknown>(null)
  const [step, setStep] = useState<SharingJoinStep>('connecting')
  const { data: settings } = useQuery(settingsQueryOptions)
  const preview = useQuery(invitePreviewQueryOptions(invite.trim()))
  const { join } = useSharingMutations()
  const nowMs = useTimeTick(30_000)
  const inputId = useId()
  const owner = preview.data?.ownerName ?? 'the Owner'
  const error = failure ?? preview.error
  const problem = error
    ? joinFailure(
        sharingErrorCode(error),
        owner,
        preview.data?.expiresAt ?? null,
        nowMs,
        error instanceof Error ? error.message : String(error)
      )
    : null

  useEffect(() => {
    if (!join.isPending || !preview.data) return
    const { caseId } = preview.data
    return window.birdbrain.onSharingJoinProgress((event) => {
      if (event.caseId === caseId) setStep(event.step)
    })
  }, [join.isPending, preview.data])

  function startJoin() {
    setFailure(null)
    setStep('connecting')
    join.mutate(invite.trim(), {
      onSuccess: ({ caseId }) => onJoined(caseId),
      onError: setFailure
    })
  }

  const FailureIcon =
    problem?.icon === 'wifi-off' ? WifiOff : problem?.icon === 'x' ? X : TriangleAlert
  return (
    <Card className="mx-auto w-full max-w-[480px] p-6" data-testid="join-case-card">
      <h2 className="font-display text-lg font-extrabold text-text-primary">{COPY.joinTitle}</h2>
      <p className="mt-1 text-xs text-text-muted">{COPY.joinSubtitle}</p>
      <div className="mt-3">
        <NetworkNotice egress={settings?.egress.kind ?? 'unavailable'} />
      </div>
      {join.isPending ? (
        <div role="status" className="mt-5 flex gap-3 rounded border border-border bg-elevated p-4">
          <LoaderCircle size={16} className="animate-spin text-text-muted" />
          <div>
            <p className="text-xs font-medium text-text-primary">
              {step === 'waiting'
                ? joinWaitingTitle(owner)
                : step === 'connecting'
                  ? 'Connecting…'
                  : 'Receiving the Case…'}
            </p>
            {step === 'waiting' && (
              <p className="mt-1 text-[11px] text-text-muted">{COPY.joinWaitingBody}</p>
            )}
          </div>
        </div>
      ) : (
        <>
          <Label htmlFor={inputId} className="mt-5 mb-2 block text-xs">
            Invite
          </Label>
          <Textarea
            id={inputId}
            value={invite}
            autoFocus
            className="h-[76px] resize-none font-mono text-[11px]"
            onChange={(event) => {
              setInvite(event.target.value)
              setFailure(null)
            }}
          />
          {preview.data && (
            <>
              <dl className="mt-3 grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 rounded border border-border bg-elevated p-3 text-xs">
                <dt className="text-text-muted">{COPY.joinFrom}</dt>
                <dd>{owner}</dd>
                <dt className="text-text-muted">{COPY.joinValidUntil}</dt>
                <dd>{expiryPhrase(preview.data.expiresAt, nowMs)}</dd>
              </dl>
              <p className="mt-2 text-[11px] text-text-faint">{COPY.joinCaution}</p>
            </>
          )}
          {problem && (
            <div role="alert" className="mt-3 flex gap-2 rounded border border-border p-3">
              <FailureIcon
                size={14}
                className={
                  problem.tone === 'danger'
                    ? 'text-danger-fg'
                    : problem.tone === 'warning'
                      ? 'text-warning-fg'
                      : 'text-text-muted'
                }
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{problem.title}</p>
                <p className="mt-1 text-[11px] text-text-muted">{problem.body}</p>
              </div>
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  if (problem.action === 'paste-another') {
                    setInvite('')
                    setFailure(null)
                  } else if (problem.action === 'close') onBack()
                  else startJoin()
                }}
              >
                {problem.actionLabel}
              </Button>
            </div>
          )}
        </>
      )}
      <div className="mt-5 flex justify-between">
        <Button variant="outline" disabled={join.isPending} onClick={onBack}>
          {COPY.back}
        </Button>
        <Button
          disabled={!preview.data || !!problem || join.isPending || preview.isFetching}
          onClick={startJoin}
        >
          {COPY.join}
        </Button>
      </div>
    </Card>
  )
}
