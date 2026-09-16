import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui'
import { useStagingMutations } from '@renderer/lib/api/staging'

interface DiscardStagedDialogProps {
  caseId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The pooled file being discarded. */
  file: { id: string; name: string }
}

// Discard confirms (X38). The pool is outside the chain, so nothing records
// a discard (X29): the file is gone with no entry saying it ever arrived,
// which is exactly why the operator is asked first. The discard is owned here
// rather than by the screen, so neither the inline button nor the menu can
// reach the mutation without this step.
export function DiscardStagedDialog({
  caseId,
  open,
  onOpenChange,
  file
}: DiscardStagedDialogProps) {
  const { discard } = useStagingMutations(caseId)

  async function handleDiscard() {
    try {
      await discard.mutateAsync([file.id])
    } catch {
      // Toasted by the mutation cache; the dialog stays open to retry or cancel.
      return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} data-testid="discard-staged-dialog">
        <DialogHeader>
          <DialogTitle>Discard &lsquo;{file.name}&rsquo; from the pool?</DialogTitle>
          <DialogDescription>
            The file is deleted from the Staging Pool. It was never anchored, so nothing in the case
            manifest will record that it arrived or that it was discarded. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            data-testid="discard-staged-cancel"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            data-testid="discard-staged-confirm"
            disabled={discard.isPending}
            onClick={() => void handleDiscard()}
          >
            {discard.isPending ? 'Discarding…' : 'Discard'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
