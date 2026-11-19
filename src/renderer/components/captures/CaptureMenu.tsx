import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@renderer/components/ui'
import { PasteUrlsDialog } from '@renderer/components/captures/PasteUrlsDialog'
import { useAppStore } from '@renderer/stores/appStore'

interface CaptureMenuProps {
  caseId: string
}

// The add button in the capture list header. It opens the paste-URLs dialog, which queues
// background Captures into the Case.
export function CaptureMenu({ caseId }: CaptureMenuProps) {
  const [showPasteUrls, setShowPasteUrls] = useState(false)

  // A background recapture emits a 'received' event at the start of its job and a
  // terminal 'stored'/'failed' event when it finishes; the store keeps the
  // 'received' entry alive for the whole run. Scope by supersedesCaptureId (the
  // exact capture being recaptured), not URL — recapture creates same-URL
  // siblings. Select the derived boolean so Zustand's Object.is check skips
  // unrelated event updates.
  const isRecapturing = useAppStore((s) =>
    s.captureEvents.some(
      (e) =>
        e.type === 'received' &&
        e.source === 'recapture' &&
        e.supersedesCaptureId === s.selectedCaptureId
    )
  )

  return (
    <div className="relative flex items-center gap-2">
      {isRecapturing && (
        <span data-testid="recapture-in-progress" className="shrink-0 text-[11px] text-text-muted">
          Recapturing…
        </span>
      )}
      {/* Icon-only, per the design: the rebuilt list header is a single row and
          a labelled button does not fit beside sort, filter and the view
          toggle at the list column's 316px default. */}
      <Button
        size="icon"
        aria-label="Paste URLs to capture"
        title="Paste URLs to capture"
        data-testid="capture-menu-btn"
        onClick={() => setShowPasteUrls(true)}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
      </Button>

      <PasteUrlsDialog caseId={caseId} open={showPasteUrls} onOpenChange={setShowPasteUrls} />
    </div>
  )
}
