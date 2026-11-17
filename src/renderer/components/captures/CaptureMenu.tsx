import { useEffect, useState } from 'react'
import { Plus, ClipboardList, RefreshCcw } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger
} from '@renderer/components/ui'
import { AddUrlsBox } from '@renderer/components/captures/AddUrlsBox'
import { capturesQueryOptions, useRecaptureMutations } from '@renderer/lib/queries'
import { useAppStore } from '@renderer/stores/appStore'
import { ContactStoppedError } from '@renderer/lib/vpnWarning'

interface CaptureMenuProps {
  caseId: string
}

// Case-level capture actions, shown in the capture list header:
// paste-URLs bulk capture (the old AddUrlsBox) and recapture of the
// currently selected capture (the old viewer breadcrumb button).
export function CaptureMenu({ caseId }: CaptureMenuProps) {
  const [showPasteUrls, setShowPasteUrls] = useState(false)
  const [recaptureError, setRecaptureError] = useState<string | null>(null)

  const selectedCaptureId = useAppStore((s) => s.selectedCaptureId)
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))
  const selectedCapture = captures.find((c) => c.id === selectedCaptureId) ?? null
  const { enqueue } = useRecaptureMutations(caseId)

  // A background recapture emits a 'received' event at the start of its job and a
  // terminal 'stored'/'failed' event when it finishes; the store keeps the
  // 'received' entry alive for the whole run. The enqueue mutation's isPending
  // only covers the millisecond IPC hand-off, so drive the in-progress UI off the
  // live event instead. Scope by supersedesCaptureId (the exact capture being
  // recaptured), not URL — recapture creates same-URL siblings. Select the
  // derived boolean so Zustand's Object.is check skips unrelated event updates.
  const isRecapturing = useAppStore((s) =>
    selectedCapture
      ? s.captureEvents.some(
          (e) =>
            e.type === 'received' &&
            e.source === 'recapture' &&
            e.supersedesCaptureId === selectedCapture.id
        )
      : false
  )

  // A recapture failure is only meaningful for the capture it was fired from.
  useEffect(() => setRecaptureError(null), [selectedCaptureId])

  function handleRecapture() {
    if (!selectedCapture) return
    setRecaptureError(null)
    enqueue.mutate(
      { urls: [selectedCapture.url], supersedesCaptureId: selectedCapture.id },
      {
        onSuccess: (result) => setRecaptureError(result.rejected[0]?.reason ?? null),
        onError: (err) => {
          // Stopped at the VPN warning: nothing was sent, and nothing failed.
          if (err instanceof ContactStoppedError) return
          setRecaptureError(err instanceof Error ? err.message : 'Recapture failed')
        }
      }
    )
  }

  return (
    <div className="relative flex items-center gap-2">
      {isRecapturing && (
        <span data-testid="recapture-in-progress" className="shrink-0 text-[11px] text-text-muted">
          Recapturing…
        </span>
      )}
      {recaptureError && !isRecapturing && (
        <span
          data-testid="recapture-error"
          title={recaptureError}
          className="shrink-0 text-[11px] text-danger-fg"
        >
          Recapture failed
        </span>
      )}
      {/* Icon-only, per the design: the rebuilt list header is a single row and
          a labelled split button does not fit beside sort, filter and the view
          toggle at the list column's 316px default. */}
      <Menu>
        <MenuTrigger asChild>
          <Button
            size="icon"
            aria-label="New capture"
            title="New capture"
            data-testid="capture-menu-btn"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem data-testid="capture-menu-paste-urls" onSelect={() => setShowPasteUrls(true)}>
            <ClipboardList className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.8} />
            Paste URLs to capture…
          </MenuItem>
          <MenuItem
            data-testid="recapture-btn"
            disabled={!selectedCapture || enqueue.isPending || isRecapturing}
            title={
              !selectedCapture
                ? 'Select a capture first'
                : isRecapturing
                  ? 'Recapture in progress…'
                  : 'Recapture this page in the background'
            }
            onSelect={handleRecapture}
          >
            <RefreshCcw
              className={`h-3.5 w-3.5 shrink-0 text-text-muted ${isRecapturing ? 'animate-spin' : ''}`}
              strokeWidth={1.8}
            />
            {isRecapturing ? 'Recapturing…' : 'Recapture current page'}
          </MenuItem>
        </MenuContent>
      </Menu>

      <Dialog open={showPasteUrls} onOpenChange={setShowPasteUrls}>
        <DialogContent onClose={() => setShowPasteUrls(false)} className="w-[440px] max-w-[440px]">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-sm">Paste URLs to capture</DialogTitle>
          </DialogHeader>
          <AddUrlsBox caseId={caseId} onQueued={() => setShowPasteUrls(false)} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
