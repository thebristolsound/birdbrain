import { useState } from 'react'
import { Plus } from 'lucide-react'
import { suggestMemberCode } from '@shared/memberCode'
import type { SharingInvite } from '@shared/types'
import { Button, Card } from '@renderer/components/ui'
import { sharingErrorCode, useSharingMutations } from '@renderer/lib/api/sharing'
import {
  COPY,
  notSharedBody,
  refusalMessage,
  yourCodeWillBe
} from '@renderer/components/sharing/memberModel'

interface NotSharedCardProps {
  caseId: string
  operatorName: string
  // The first invite shares the Case; the dialog that shows the string opens
  // from here once it exists.
  onCreated?: (invite: SharingInvite) => void
}

// The whole-tab state of a Case nobody has shared (#1514, mock 1b). The code
// shown is the one main would write: the same suggestion, with nothing taken.
export function NotSharedCard({ caseId, operatorName, onCreated }: NotSharedCardProps) {
  const { createInvite } = useSharingMutations()
  const [error, setError] = useState<string | null>(null)
  const code = suggestMemberCode(operatorName, [])

  function invite() {
    setError(null)
    createInvite.mutate(
      { caseId, ownerMemberCode: code },
      {
        onSuccess: (created) => onCreated?.(created),
        onError: (err) =>
          setError(
            refusalMessage(sharingErrorCode(err), err instanceof Error ? err.message : String(err))
          )
      }
    )
  }

  return (
    <Card className="max-w-[376px] p-4" data-testid="not-shared-card">
      <h2 className="font-display text-sm font-bold text-text-primary">{COPY.notSharedTitle}</h2>
      <p className="mt-1.5 text-xs leading-[1.6] text-text-secondary">{notSharedBody(code)}</p>
      <ul className="mt-3 list-disc pl-4 text-[11px] leading-[1.7] text-text-muted">
        {COPY.notSharedPoints.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <div className="mt-3.5 flex items-center gap-2">
        <Button onClick={invite} disabled={createInvite.isPending} className="gap-1.5">
          <Plus size={12} strokeWidth={2.2} aria-hidden="true" />
          {COPY.invite}
        </Button>
        <span className="text-[11px] text-text-faint">
          {yourCodeWillBe('')}
          <span className="font-semibold text-text-secondary">{code}</span>
        </span>
      </div>
      {error ? (
        <p className="mt-2 text-[11px] text-danger-fg" data-testid="invite-error">
          {error}
        </p>
      ) : null}
    </Card>
  )
}
