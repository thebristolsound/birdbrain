import { Button, Card, SectionLabel } from '@renderer/components/ui'
import { COPY } from '@renderer/components/sharing/memberModel'

// "Create a new Case from my copy" (#1514, mock 1a). No channel makes a Case
// from a replica yet, so the action is drawn disabled; the copy ships so the
// screen says the recovery path exists.
export function RecoveryCard() {
  return (
    <Card className="border-danger-line p-4" data-testid="recovery-card">
      <SectionLabel className="mb-3 text-danger-fg">{COPY.recoveryHeading}</SectionLabel>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-text-primary">{COPY.recoveryTitle}</div>
          <p className="mt-1 text-[11px] leading-[1.55] text-text-muted">{COPY.recoveryBody}</p>
        </div>
        <Button
          variant="outline"
          disabled
          className="shrink-0 border-danger-line text-danger-fg"
          title="Not available in this build"
        >
          {COPY.recoveryAction}
        </Button>
      </div>
    </Card>
  )
}
