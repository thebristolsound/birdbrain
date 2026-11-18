import { useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui'
import { AddUrlsBox } from '@renderer/components/captures/AddUrlsBox'

// The dialog that queues background Captures of pasted addresses into a Case. The add button
// above the Capture list opens it, and so does the top bar's capture control.
export function PasteUrlsDialog({
  caseId,
  open,
  onOpenChange
}: {
  caseId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="w-[440px] max-w-[440px]">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-sm">Paste URLs to capture</DialogTitle>
        </DialogHeader>
        <OpeningBox caseId={caseId} onQueued={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

// The box of one opening of the dialog. Its queue can finish after the dialog has closed, and by
// then another opening can be up, so a finish closes the dialog only while this box is still
// on screen.
function OpeningBox({ caseId, onQueued }: { caseId: string; onQueued: () => void }) {
  const onScreen = useRef(true)
  useEffect(() => {
    onScreen.current = true
    return () => {
      onScreen.current = false
    }
  }, [])
  return (
    <AddUrlsBox
      caseId={caseId}
      onQueued={() => {
        if (onScreen.current) onQueued()
      }}
    />
  )
}
