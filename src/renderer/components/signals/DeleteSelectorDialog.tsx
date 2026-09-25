import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui'
import { useSelectorsMutations } from '@renderer/lib/api/selectors'

interface DeleteSelectorDialogProps {
  caseId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The selector being deleted, with how many captures it has matched. */
  selector: { id: string; name: string; matchCount: number }
}

function matchConsequence(count: number): string {
  if (count === 0) return 'It has not matched any captures yet.'
  const captures = count === 1 ? '1 capture' : `${count} captures`
  return `Its matches on ${captures} in this case are deleted with it.`
}

// Delete-selector confirm step (#1549), the selector half of #957. A delete
// cascades the selector's persisted matches, which the case-wide counts and the
// match CSV are read from, and there is no trash to bring them back — so the
// row button, Backspace and the menu all stop here first, as the tag rows do.
//
// The delete is owned here rather than by the screen, so there is no route to
// the mutation that skips this dialog.
export function DeleteSelectorDialog({
  caseId,
  open,
  onOpenChange,
  selector
}: DeleteSelectorDialogProps) {
  const { remove } = useSelectorsMutations(caseId)

  async function handleDelete() {
    try {
      await remove.mutateAsync(selector.id)
    } catch {
      // The mutation cache already toasted it; the dialog stays open so the
      // operator can retry or cancel.
      return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} data-testid="delete-selector-dialog">
        <DialogHeader>
          <DialogTitle>Delete &lsquo;{selector.name}&rsquo;?</DialogTitle>
          <DialogDescription>
            {matchConsequence(selector.matchCount)} The captures themselves are not deleted. This
            cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            variant="outline"
            data-testid="delete-selector-cancel"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            data-testid="delete-selector-confirm"
            disabled={remove.isPending}
            onClick={() => void handleDelete()}
          >
            {remove.isPending ? 'Deleting…' : `Delete '${selector.name}'`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
