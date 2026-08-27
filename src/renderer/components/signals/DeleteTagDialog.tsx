import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui'
import { useTagsMutations } from '@renderer/lib/api/tags'

interface DeleteTagDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The tag being deleted. */
  tag: { id: string; name: string }
}

// Delete-tag confirm step (#957). Merge already confirms, and delete is the
// more destructive of the two — it drops the tag's capture and note links with
// nothing to carry them instead — so the unguarded path was the wrong way
// round. The consequence copy borrows the merge dialog's shape because it is
// the same fact: tags are app-global, so a delete invoked from one case's
// Signals screen reaches cases the operator is not looking at.
//
// The delete is owned here rather than by the screen, so there is no route to
// the mutation that skips this dialog.
export function DeleteTagDialog({ open, onOpenChange, tag }: DeleteTagDialogProps) {
  const { remove } = useTagsMutations()

  async function handleDelete() {
    try {
      await remove.mutateAsync(tag.id)
    } catch {
      // The mutation cache already toasted it; the dialog stays open so the
      // operator can retry or cancel.
      return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} data-testid="delete-tag-dialog">
        <DialogHeader>
          <DialogTitle>Delete &lsquo;{tag.name}&rsquo;?</DialogTitle>
          <DialogDescription>
            Every capture and note tagged &lsquo;{tag.name}&rsquo; — in every case, not only this
            one — will lose the tag, and &lsquo;{tag.name}&rsquo; will be deleted. The captures and
            notes themselves are not deleted. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            variant="outline"
            data-testid="delete-tag-cancel"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            data-testid="delete-tag-confirm"
            disabled={remove.isPending}
            onClick={() => void handleDelete()}
          >
            {remove.isPending ? 'Deleting…' : `Delete '${tag.name}'`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
