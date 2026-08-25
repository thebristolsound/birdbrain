import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui'
import { tagsQueryOptions, useTagsMutations } from '@renderer/lib/api/tags'
import { TAG_PALETTE } from '@renderer/components/signals/signalsModel'

interface MergeTagDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The tag being merged away. */
  source: { id: string; name: string }
  /** Called with the surviving tag's id after a successful merge. */
  onMerged?: (targetId: string) => void
}

// Merge-tags confirm step (#828): pick the surviving tag, then commit with a
// button that names the deletion. The consequence copy says "in every case"
// because tags are app-global — the operator invoked this from one case's
// Signals screen, but the merge rewrites tag links in cases they are not
// looking at, and the dialog is the only place that gets said before the
// write. Nothing happens until the commit button is pressed; picking a target
// is not consent to the delete.
//
// This dialog is the unit #701's tag context menu consumes once its per-kind
// action registry lands (ruling R13): the registry's 'Merge into…' entry opens
// it the same way the rail button below does.
export function MergeTagDialog({ open, onOpenChange, source, onMerged }: MergeTagDialogProps) {
  const { data: tags = [] } = useQuery(tagsQueryOptions)
  const { merge } = useTagsMutations()
  const [targetId, setTargetId] = useState<string | null>(null)

  const targets = tags.filter((tag) => tag.id !== source.id)
  const target = targets.find((tag) => tag.id === targetId)

  function close() {
    setTargetId(null)
    onOpenChange(false)
  }

  async function handleMerge() {
    if (!targetId) return
    try {
      await merge.mutateAsync({ sourceId: source.id, targetId })
    } catch {
      // The mutation cache already toasted it; the dialog stays open with the
      // pick intact so the operator can retry or cancel.
      return
    }
    onMerged?.(targetId)
    close()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent onClose={close} data-testid="merge-tag-dialog">
        <DialogHeader>
          <DialogTitle>Merge &lsquo;{source.name}&rsquo; into another tag</DialogTitle>
          <DialogDescription>
            Every capture and note tagged &lsquo;{source.name}&rsquo; — in every case, not only this
            one — will carry the tag you pick instead, and &lsquo;{source.name}&rsquo; will be
            deleted. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {targets.length === 0 ? (
          <p data-testid="merge-tag-empty" className="text-sm text-text-muted">
            There is no other tag to merge into. Create the surviving tag first.
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label="Merge target"
            className="flex max-h-56 flex-col gap-0.5 overflow-y-auto"
          >
            {targets.map((tag) => (
              <button
                key={tag.id}
                type="button"
                role="radio"
                aria-checked={tag.id === targetId}
                data-testid={`merge-target-${tag.id}`}
                onClick={() => setTargetId(tag.id)}
                className={[
                  'flex items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs',
                  tag.id === targetId
                    ? 'border border-accent/35 bg-accent-subtle text-text-primary'
                    : 'border border-transparent text-text-secondary hover:bg-elevated'
                ].join(' ')}
              >
                <span
                  className="h-[9px] w-[9px] shrink-0 rounded-full"
                  style={{ background: tag.color || TAG_PALETTE[0] }}
                />
                <span className="truncate">{tag.name}</span>
              </button>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            data-testid="merge-tag-commit"
            disabled={!target || merge.isPending}
            onClick={() => void handleMerge()}
          >
            {merge.isPending
              ? 'Merging…'
              : target
                ? `Merge and delete '${source.name}'`
                : 'Pick a tag to merge into'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
