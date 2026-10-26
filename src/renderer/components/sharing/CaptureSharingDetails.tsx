import { useId, useState } from 'react'
import { FileX } from 'lucide-react'
import type { Capture } from '@shared/types'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  Label
} from '@renderer/components/ui'
import { sharingErrorCode, useSharingMutations } from '@renderer/lib/api/sharing'
import {
  COPY,
  excludeBody,
  excludeTitle,
  exclusionBanner,
  formatDateTime,
  mergeReceiving,
  refusalMessage
} from '@renderer/components/sharing/memberModel'
import { formatSeq } from '@renderer/components/data/ledgerModel'
import {
  captureAttribution,
  type CaptureSharing
} from '@renderer/components/sharing/useCaptureSharing'

export function CaptureSharingDetails({
  capture,
  sharing
}: {
  capture: Capture
  sharing: CaptureSharing
}) {
  const author = captureAttribution(capture, sharing.members)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const reasonId = useId()
  const { excludeExhibit } = useSharingMutations()
  if (!sharing.members || sharing.members.members.length === 0) return null
  const fact = sharing.exclusions?.get(capture.id)
  const banner = fact ? exclusionBanner(fact) : null
  const received =
    !author || author.isSelf || capture.manifestIndex === undefined
      ? null
      : mergeReceiving(sharing.snapshot, author.member.installationId, capture.manifestIndex)
  const close = () => {
    setOpen(false)
    setReason('')
    setError(null)
  }
  return (
    <div className="mt-3 text-[11px] text-text-muted" data-testid="capture-sharing-details">
      {author && (
        <p>
          {author.title}
          {author.isSelf ? '' : ', their machine'} · {formatDateTime(capture.timestamp)}
          {received &&
            ` · received by you ${formatDateTime(received.timestamp)} in merge #${formatSeq(received.index)}`}
        </p>
      )}
      {banner ? (
        <div
          className="mt-2 flex gap-2 rounded border border-border bg-elevated p-2.5"
          data-testid="capture-exclusion-banner"
        >
          <FileX size={14} className="shrink-0" />
          <p>
            <span className="font-medium">{banner.lead}</span>
            {capture.lastVerifiedStatus === 'verified' && sharing.snapshot?.chain.valid
              ? capture.lastVerifiedAt
                ? banner.body.replace(
                    COPY.excludedIntegrity,
                    `At the last verification on ${formatDateTime(capture.lastVerifiedAt)}, the entry, bytes, and hash verified.`
                  )
                : banner.body
              : banner.body.replace(` ${COPY.excludedIntegrity}`, '')}
            <span className="ml-1 font-mono">{banner.ref}</span>
          </p>
        </div>
      ) : (
        sharing.members?.isOwner && (
          <Button variant="outline" size="xs" className="mt-2" onClick={() => setOpen(true)}>
            {COPY.excludeAction}
          </Button>
        )
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value && !excludeExhibit.isPending) close()
        }}
      >
        <DialogContent
          className="max-w-[400px] p-4"
          onClose={() => {
            if (!excludeExhibit.isPending) close()
          }}
        >
          <DialogTitle>{excludeTitle(capture.exhibitCitation ?? '')}</DialogTitle>
          <DialogDescription className="mt-2 text-xs leading-relaxed">
            {excludeBody(author?.member.operatorName ?? 'the author')}
          </DialogDescription>
          <Label htmlFor={reasonId} className="mt-3 mb-1 block text-xs">
            {COPY.reasonLabel} <span className="text-text-faint">{COPY.reasonOptional}</span>
          </Label>
          <Input id={reasonId} value={reason} onChange={(event) => setReason(event.target.value)} />
          {error && (
            <p role="alert" className="mt-2 text-xs text-danger-fg">
              {error}
            </p>
          )}
          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" disabled={excludeExhibit.isPending} onClick={close}>
              {COPY.cancel}
            </Button>
            <Button
              disabled={excludeExhibit.isPending}
              onClick={() =>
                excludeExhibit.mutate(
                  {
                    caseId: capture.caseId,
                    exhibitId: capture.id,
                    reason: reason.trim() || undefined
                  },
                  {
                    onSuccess: close,
                    onError: (err) =>
                      setError(
                        refusalMessage(
                          sharingErrorCode(err),
                          err instanceof Error ? err.message : String(err)
                        )
                      )
                  }
                )
              }
            >
              {COPY.excludeAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
