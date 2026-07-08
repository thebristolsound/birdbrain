import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button
} from 'birdbrain-ui'

// Dialog is controlled and positions its overlay/panel with `fixed`. A
// transformed, clipped wrapper becomes the containing block for those fixed
// children, so the open state renders inside the card instead of escaping to
// the viewport.
const stage: React.CSSProperties = {
  position: 'relative',
  width: 480,
  height: 360,
  transform: 'translateZ(0)',
  overflow: 'hidden',
  borderRadius: 16
}

export const ConfirmDelete = () => (
  <div style={stage}>
    <Dialog open onOpenChange={() => {}}>
      <DialogContent onClose={() => {}}>
        <DialogHeader>
          <DialogTitle>Delete case?</DialogTitle>
          <DialogDescription>
            This permanently removes “Operation Nightjar” and its 42 captures.
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost">Cancel</Button>
          <Button variant="destructive">Delete case</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
)
