import { ShieldCheck } from 'lucide-react'
import { Button } from '@renderer/components/ui'
import type { IntegrityBucket } from '@renderer/components/data/dataTableModel'
import type { VerifyAllProgress } from '@renderer/lib/api/exhibits'

interface IntegrityStripProps {
  counts: Record<IntegrityBucket, number>
  progress: VerifyAllProgress | null
  onVerifyAll: () => void
  disabled: boolean
}

// The three X37 buckets over every anchored row, and "Verify all". The
// unverified count is deliberately visible: a Case with zero exceptions and
// forty unverified rows has not been looked at, and a strip that showed only
// the exceptions would read as clean.
export function IntegrityStrip({ counts, progress, onVerifyAll, disabled }: IntegrityStripProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-4 border-b border-border bg-surface px-3.5 py-2 text-[11px]"
      data-testid="integrity-strip"
    >
      <span className="text-success-fg" data-testid="bucket-verified">
        {counts.verified} verified
      </span>
      <span className="text-danger-fg" data-testid="bucket-exception">
        {counts.exception} tampered, missing or chain-broken
      </span>
      <span className="text-text-muted" data-testid="bucket-unverified">
        {counts.unverified} unverified
      </span>
      <div className="flex-1" />
      {progress && (
        <span className="font-mono text-text-faint" data-testid="verify-all-progress">
          {progress.done} / {progress.total}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={onVerifyAll}
        disabled={disabled || progress !== null}
        data-testid="verify-all"
      >
        <ShieldCheck size={12} strokeWidth={1.8} />
        {progress ? 'Verifying…' : 'Verify all'}
      </Button>
    </div>
  )
}
