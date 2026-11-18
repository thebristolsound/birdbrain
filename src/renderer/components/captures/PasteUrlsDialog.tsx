import { useEffect, useRef, useState } from 'react'
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
  // Each opening of the dialog has a number. A queue started in one opening can finish after
  // the dialog has closed, and by then it can be open again, even before the closing animation
  // has let go of the old content. So a finished queue closes the dialog only if the dialog is
  // open and is still on the opening the queue started in.
  const [wasOpen, setWasOpen] = useState(open)
  const [opening, setOpening] = useState(0)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setOpening(opening + 1)
  }
  const now = useRef({ open, opening })
  useEffect(() => {
    now.current = { open, opening }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="w-[440px] max-w-[440px]">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-sm">Paste URLs to capture</DialogTitle>
        </DialogHeader>
        <AddUrlsBox
          caseId={caseId}
          onQueued={() => {
            if (now.current.open && now.current.opening === opening) onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
