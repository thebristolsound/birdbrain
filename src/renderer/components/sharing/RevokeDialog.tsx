import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle
} from '@renderer/components/ui'
import { exhibitInventoryQueryOptions } from '@renderer/lib/api/exhibits'
import { sharingErrorCode, useSharingMutations } from '@renderer/lib/api/sharing'
import {
  COPY,
  refusalMessage,
  revokeBody,
  revokeTitle
} from '@renderer/components/sharing/memberModel'

export interface RevokeTarget {
  installationId: string
  code: string
  name: string
}

interface RevokeDialogProps {
  caseId: string
  open: boolean
  // Kept by the parent through the close animation, so the text does not
  // vanish before the dialog does.
  target: RevokeTarget | null
  onOpenChange: (open: boolean) => void
}

// "Revoke S. Idris?" (#1514, mock 1g). The Exhibit count is the member's rows
// in the inventory, told apart by the citation prefix main resolved: the
// inventory row carries no author field, and the Case has more than one
// member whenever this dialog can open, so every citation is prefixed.
export function RevokeDialog({ caseId, open, target, onOpenChange }: RevokeDialogProps) {
  const titleId = useId()
  const { revoke } = useSharingMutations()
  const [error, setError] = useState<string | null>(null)
  const { data: inventory } = useQuery({
    ...exhibitInventoryQueryOptions(caseId),
    enabled: open && target !== null
  })
  const code = target?.code ?? ''
  const exhibits = (inventory?.rows ?? []).filter(
    (row) =>
      row.rowType === 'anchored' && row.entity === 'exhibit' && row.citation.startsWith(`${code}-`)
  ).length

  function close() {
    setError(null)
    onOpenChange(false)
  }

  function confirm() {
    if (!target) return
    revoke.mutate(
      { caseId, installationId: target.installationId },
      {
        onSuccess: close,
        onError: (err) =>
          setError(
            refusalMessage(sharingErrorCode(err), err instanceof Error ? err.message : String(err))
          )
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent onClose={close} aria-labelledby={titleId} className="max-w-[400px] p-4">
        <DialogTitle id={titleId} className="font-display text-sm font-bold">
          {revokeTitle(target?.name ?? '')}
        </DialogTitle>
        <DialogDescription className="mt-2 text-xs leading-[1.6] text-text-secondary">
          {revokeBody(target?.name ?? '', code, exhibits)}
        </DialogDescription>
        <p className="mt-2 text-[11px] text-text-muted">{COPY.revokeNote}</p>
        {error ? (
          <p className="mt-2 text-[11px] text-danger-fg" data-testid="revoke-error">
            {error}
          </p>
        ) : null}
        <DialogFooter className="mt-3.5 gap-2">
          <Button variant="outline" className="border-border text-text-secondary" onClick={close}>
            {COPY.cancel}
          </Button>
          <Button variant="destructive" disabled={revoke.isPending} onClick={confirm}>
            {COPY.revoke}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
