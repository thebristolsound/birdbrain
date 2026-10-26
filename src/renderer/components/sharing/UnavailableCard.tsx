import { Button, Card } from '@renderer/components/ui'
import { useCasesMutations } from '@renderer/lib/api/cases'
import { COPY } from '@renderer/components/sharing/memberModel'

// The whole-tab state when the peer-to-peer binding does not load (#1514,
// mock 1b). No Invite: the one way to work with a peer here is an archive.
export function UnavailableCard({ caseId }: { caseId: string }) {
  const { exportArchive } = useCasesMutations()
  return (
    <Card className="max-w-[376px] p-4" data-testid="unavailable-card">
      <h2 className="font-display text-sm font-bold text-text-primary">{COPY.unavailableTitle}</h2>
      <p className="mt-1.5 text-xs leading-[1.6] text-text-secondary">{COPY.unavailableBody}</p>
      <p className="mt-2.5 text-[11px] leading-[1.55] text-text-muted">{COPY.unavailableNote}</p>
      <div className="mt-3.5 flex gap-2">
        <Button
          variant="outline"
          disabled={exportArchive.isPending}
          onClick={() => exportArchive.mutate(caseId)}
        >
          {COPY.exportArchive}
        </Button>
      </div>
    </Card>
  )
}
