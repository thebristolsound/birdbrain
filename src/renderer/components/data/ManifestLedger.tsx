import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import type { CaseManifestSnapshot } from '@shared/manifestSnapshot'
import { cn } from '@renderer/lib/utils'
import {
  describeSigner,
  summarizeVerdict,
  toLedgerRows,
  rowsNaming,
  type LedgerRow,
  type VerdictTone
} from '@renderer/components/data/ledgerModel'
import { formatStamp } from '@renderer/components/data/dataTableModel'

const TONE_CLASSES: Record<VerdictTone, string> = {
  intact: 'border-success-line bg-success-surface text-success-fg',
  broken: 'border-danger-line bg-danger-surface text-danger-fg',
  unsupported: 'border-warning-line bg-warning-surface text-warning-fg',
  empty: 'border-border bg-elevated text-text-muted'
}

const TONE_ICONS: Record<VerdictTone, typeof ShieldCheck> = {
  intact: ShieldCheck,
  broken: ShieldAlert,
  unsupported: ShieldQuestion,
  empty: ShieldQuestion
}

// The verdict chip. `unsupported` is its own outcome with its own colour and
// wording (X25): a verifier too old to read the chain never reads as tamper.
export function ChainVerdict({ snapshot }: { snapshot: CaseManifestSnapshot }) {
  const verdict = summarizeVerdict(snapshot.chain, snapshot.head)
  const Icon = TONE_ICONS[verdict.tone]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-semibold',
        TONE_CLASSES[verdict.tone]
      )}
      data-testid="chain-verdict"
      data-tone={verdict.tone}
    >
      <Icon size={11} strokeWidth={1.9} />
      {verdict.text}
    </span>
  )
}

const COLUMNS = '56px minmax(120px,140px) minmax(90px,120px) minmax(160px,1fr) 110px 110px'

function LedgerRows({ rows }: { rows: LedgerRow[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="ledger-rows">
      <div
        className="sticky top-0 z-[2] grid h-[var(--d-head)] items-center border-b border-border bg-canvas px-[var(--d-rowpad)] font-display text-[10px] font-semibold uppercase tracking-label text-text-faint"
        style={{ gridTemplateColumns: COLUMNS }}
      >
        <span>Seq</span>
        <span>Time</span>
        <span>Type</span>
        <span>Target</span>
        <span>Entry hash</span>
        <span>Previous</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-9 text-center text-xs text-text-faint">No entries.</div>
      ) : (
        rows.map((row) => (
          <div
            key={row.index}
            className={cn(
              'grid min-h-[var(--d-row)] items-center border-b border-border px-[var(--d-rowpad)] font-mono text-[11px]',
              row.parsed ? 'text-text-muted' : 'text-warning-fg'
            )}
            style={{ gridTemplateColumns: COLUMNS }}
            data-testid={`ledger-row-${row.index}`}
            data-entry-type={row.type}
          >
            <span className="tabular-nums text-text-faint">
              {String(row.index).padStart(4, '0')}
            </span>
            <span className="tabular-nums">{row.time ? formatStamp(row.time) : '—'}</span>
            <span className="text-text-secondary">{row.type}</span>
            <span className="truncate" title={row.target}>
              {row.target}
            </span>
            <span className="truncate text-text-faint" title={row.entryHash}>
              {row.entryHash.slice(0, 12)}
            </span>
            <span className="truncate text-text-faint" title={row.prevHash}>
              {row.prevHash ? row.prevHash.slice(0, 12) : 'genesis'}
            </span>
          </div>
        ))
      )}
    </div>
  )
}

// The whole ledger: every entry in sequence, typed by the nine schema-3 types,
// with the verdict and the signer fingerprints from the snapshot (X36).
export function ManifestLedgerView({ snapshot }: { snapshot: CaseManifestSnapshot }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="manifest-ledger-view">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3.5 py-2 text-[11px] text-text-faint">
        <ChainVerdict snapshot={snapshot} />
        {snapshot.signers.length === 0 ? (
          <span data-testid="ledger-signers">Signers not attributed on this chain.</span>
        ) : (
          snapshot.signers.map((segment) => (
            <span
              key={`${segment.fromIndex}-${segment.toIndex}`}
              className="font-mono"
              data-testid="ledger-signer"
            >
              {describeSigner(segment)}
            </span>
          ))
        )}
      </div>
      <LedgerRows rows={toLedgerRows(snapshot.entries)} />
    </div>
  )
}

// The per-row tab: only the entries that name this Exhibit.
export function ManifestLedgerTab({
  snapshot,
  exhibit
}: {
  snapshot: CaseManifestSnapshot
  exhibit: { id: string; contentHash: string }
}) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="manifest-ledger-tab">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3.5 py-2">
        <ChainVerdict snapshot={snapshot} />
      </div>
      <LedgerRows rows={rowsNaming(snapshot.entries, exhibit)} />
    </div>
  )
}
