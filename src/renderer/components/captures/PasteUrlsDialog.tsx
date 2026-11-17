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
        <AddUrlsBox caseId={caseId} onQueued={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
