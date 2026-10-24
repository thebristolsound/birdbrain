import { useMutation } from '@tanstack/react-query'
import { Button } from '@renderer/components/ui'
import { checkForUpdate } from '@renderer/lib/api/updates'
import { COPY, type PausedStrip } from '@renderer/components/sharing/memberModel'

// Under a row paused on a newer Birdbrain (ruling 2 of 2026-10-10): what
// happened, where that member's chain stopped on this replica, and the one
// thing that resumes it.
export function NewerVersionStrip({ strip }: { strip: PausedStrip }) {
  const check = useMutation({ mutationFn: checkForUpdate, meta: { action: 'check for updates' } })
  return (
    <div
      className="mx-4 mb-2.5 ml-[72px] flex items-start gap-2.5 rounded border border-danger-line bg-danger-surface px-2.5 py-2"
      data-testid="newer-version-strip"
    >
      <p className="min-w-0 flex-1 text-[11px] leading-[1.55] text-text-secondary">
        <span className="font-medium text-text-primary">{strip.lead}</span>
        {strip.text.slice(strip.lead.length)}
      </p>
      <Button
        variant="outline"
        size="xs"
        className="h-6 shrink-0 whitespace-nowrap border-border bg-card px-2 text-[11px] text-text-secondary"
        disabled={check.isPending}
        onClick={() => check.mutate()}
      >
        {COPY.checkForUpdates}
      </Button>
    </div>
  )
}
