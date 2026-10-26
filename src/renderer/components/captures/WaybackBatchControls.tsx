import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui'
import { settingsQueryOptions } from '@renderer/lib/api/settings'
import { planLinkBatch, WAYBACK_LINK_BATCH_CAP } from '@shared/waybackLinkBatch'
import type { WaybackLinkBatch } from '@renderer/components/captures/useWaybackLinkBatch'
import {
  batchStatusSentence,
  egressRouteSentence,
  isKnownEgress,
  overCapSentence,
  refusedRowsSentence
} from '@renderer/components/captures/waybackBatchModel'

const LIST_CLASS =
  'max-h-40 overflow-y-auto rounded border border-border bg-canvas px-2 py-1 text-[11px] text-text-secondary'

/**
 * The confirmation of a Wayback batch (plan S3). It lists every address that will be
 * sent, after the address rule, de-duplication and the cap, and Send passes main that
 * list as shown; nothing is sent until Send is pressed.
 */
function ConfirmBatch({
  urls,
  onCancel,
  onConfirm
}: {
  urls: string[]
  onCancel: () => void
  onConfirm: (...args: Parameters<WaybackLinkBatch['start']>) => void
}) {
  const { data: settings, isPending } = useQuery(settingsQueryOptions)
  const plan = useMemo(() => planLinkBatch(urls), [urls])
  const { send, overCap, refused } = plan
  const egress = settings?.egress
  const route = egressRouteSentence(egress)
  const refusedRows = refused.reduce((sum, { rows }) => sum + rows, 0)
  return (
    <DialogContent onClose={onCancel} data-testid="wayback-batch-dialog">
      <DialogHeader>
        <DialogTitle>
          Look up {send.length === 1 ? '1 address' : `${send.length} addresses`} in the Wayback
          Machine?
        </DialogTitle>
        <DialogDescription>
          Each address below is sent to archive.org, which learns that it was asked about.{' '}
          {route ??
            (isPending
              ? 'Reading the Egress setting.'
              : 'The Egress setting could not be read, so nothing can be sent.')}
        </DialogDescription>
      </DialogHeader>
      {send.length > 0 && (
        <ul data-testid="wayback-batch-send" className={LIST_CLASS}>
          {send.map((url) => (
            <li key={url} className="truncate" title={url}>
              {url}
            </li>
          ))}
        </ul>
      )}
      {overCap.length > 0 && (
        <p data-testid="wayback-batch-over-cap" className="text-xs text-text-muted">
          {overCapSentence(WAYBACK_LINK_BATCH_CAP, overCap.length)}
        </p>
      )}
      {refused.length > 0 && (
        <div data-testid="wayback-batch-refused" className="space-y-1">
          <p className="text-xs text-text-muted">{refusedRowsSentence(refusedRows)}</p>
          <ul className={LIST_CLASS}>
            {refused.map(({ url, reason }) => (
              <li key={url} className="truncate" title={url}>
                {url}: {reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" data-testid="wayback-batch-cancel" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          data-testid="wayback-batch-confirm"
          disabled={send.length === 0 || !isKnownEgress(egress)}
          onClick={() => {
            if (isKnownEgress(egress)) onConfirm(send, egress)
          }}
        >
          Send to archive.org
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

/**
 * The Links tab toolbar's "Look up all in Wayback" (#1738), over the rows the search and
 * the External only filter show, with its confirmation and its cancel.
 */
export function WaybackBatchControls({ urls, batch }: { urls: string[]; batch: WaybackLinkBatch }) {
  const [open, setOpen] = useState(false)
  const { running, start, cancel } = batch
  return (
    <>
      {running ? (
        <Button
          variant="outline"
          data-testid="wayback-batch-stop"
          className="h-6 shrink-0 px-2 text-[11px]"
          onClick={cancel}
        >
          Cancel lookups
        </Button>
      ) : (
        <Button
          variant="outline"
          data-testid="wayback-batch-open"
          className="h-6 shrink-0 px-2 text-[11px]"
          disabled={urls.length === 0}
          onClick={() => setOpen(true)}
        >
          Look up all in Wayback
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <ConfirmBatch
          urls={urls}
          onCancel={() => setOpen(false)}
          onConfirm={(send, egress) => {
            setOpen(false)
            start(send, egress)
          }}
        />
      </Dialog>
    </>
  )
}

/** A batch's progress while it runs, and what it reports when it ends. */
export function WaybackBatchStatus({ batch }: { batch: WaybackLinkBatch }) {
  const status = batchStatusSentence(batch, batch.outcome)
  if (!status && !batch.startError) return null
  return (
    <p
      data-testid="wayback-batch-status"
      role="status"
      className="shrink-0 border-b border-border px-4 py-1.5 text-[11px] text-text-muted"
    >
      {status}
      {batch.startError && <span className="text-danger-fg">{batch.startError}</span>}
    </p>
  )
}
