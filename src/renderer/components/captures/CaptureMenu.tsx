import { useEffect, useRef, useState } from 'react'
import { Plus, ChevronDown, ClipboardList, RefreshCcw } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui'
import { AddUrlsBox } from '@renderer/components/captures/AddUrlsBox'
import { capturesQueryOptions, useRecaptureMutations } from '@renderer/lib/queries'
import { useAppStore } from '@renderer/stores/appStore'

interface CaptureMenuProps {
  caseId: string
}

// Case-level capture actions, shown in the capture list header:
// paste-URLs bulk capture (the old AddUrlsBox) and recapture of the
// currently selected capture (the old viewer breadcrumb button).
export function CaptureMenu({ caseId }: CaptureMenuProps) {
  const [open, setOpen] = useState(false)
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

  const menuRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (menuRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function handleRecapture() {
    if (!selectedCapture) return
    setOpen(false)
    setRecaptureError(null)
    enqueue.mutate(
      { urls: [selectedCapture.url], supersedesCaptureId: selectedCapture.id },
      {
        onSuccess: (result) => setRecaptureError(result.rejected[0]?.reason ?? null),
        onError: (err) => setRecaptureError(err instanceof Error ? err.message : 'Recapture failed')
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
          className="shrink-0 text-[11px] text-red-500"
        >
          Recapture failed
        </span>
      )}
      <Button
        ref={anchorRef}
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="capture-menu-btn"
        className="gap-1.5"
      >
        <Plus className="h-3 w-3" strokeWidth={2} />
        Capture
        <ChevronDown className="h-3 w-3" strokeWidth={1.8} />
      </Button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border-strong bg-card py-1 shadow-xl"
        >
          <button
            role="menuitem"
            data-testid="capture-menu-paste-urls"
            onClick={() => {
              setOpen(false)
              setShowPasteUrls(true)
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary hover:bg-elevated"
          >
            <ClipboardList className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.8} />
            Paste URLs to capture…
          </button>
          <button
            role="menuitem"
            data-testid="recapture-btn"
            disabled={!selectedCapture || enqueue.isPending || isRecapturing}
            title={
              !selectedCapture
                ? 'Select a capture first'
                : isRecapturing
                  ? 'Recapture in progress…'
                  : 'Recapture this page in the background'
            }
            onClick={handleRecapture}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary hover:bg-elevated disabled:opacity-50"
          >
            <RefreshCcw
              className={`h-3.5 w-3.5 shrink-0 text-text-muted ${isRecapturing ? 'animate-spin' : ''}`}
              strokeWidth={1.8}
            />
            {isRecapturing ? 'Recapturing…' : 'Recapture current page'}
          </button>
          <div className="mt-1 border-t border-border px-3 py-1.5 text-[10px] text-text-faint">
            Both run in the background queue
          </div>
        </div>
      )}

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
