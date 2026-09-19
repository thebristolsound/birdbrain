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

// The row-level routes (#1151): a row click shows the entry's target, and each
// hash cell copies on click. No context menu: it would hold only those.
export interface LedgerRowActions {
  onShowTarget?: (row: LedgerRow) => void
  onCopyHash?: (value: string, label: string) => void
}

// An empty hash is only a statement about the chain when the caller says so
// (`placeholder`): a readable first entry has no previous hash because it is
// the genesis entry, but an unreadable line's empty hashes mean nothing was
// read, so they render as nothing and offer nothing to copy.
function HashCell({
  value,
  label,
  onCopy,
  placeholder
}: {
  value: string
  label: string
  onCopy?: (value: string, label: string) => void
  placeholder?: string
}) {
  if (!value) return <span className="text-text-faint">{placeholder}</span>
  return (
    <button
      type="button"
      className="truncate text-left text-text-faint hover:text-accent"
      title={`${value} — click to copy`}
      onClick={(event) => {
        event.stopPropagation()
        onCopy?.(value, label)
      }}
    >
      {value.slice(0, 12)}
    </button>
  )
}

function LedgerRows({ rows, actions = {} }: { rows: LedgerRow[]; actions?: LedgerRowActions }) {
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
              row.parsed ? 'text-text-muted' : 'text-warning-fg',
              actions.onShowTarget && 'cursor-pointer hover:bg-elevated'
            )}
            style={{ gridTemplateColumns: COLUMNS }}
            data-testid={`ledger-row-${row.index}`}
            data-entry-type={row.type}
            tabIndex={actions.onShowTarget ? 0 : undefined}
            onClick={() => actions.onShowTarget?.(row)}
            onKeyDown={(event) => {
              // Only the row's own Enter: a keydown bubbling from a hash
              // cell is that button's copy, not a Show target.
              if (event.key === 'Enter' && event.target === event.currentTarget) {
                actions.onShowTarget?.(row)
              }
            }}
          >
            <span className="tabular-nums text-text-faint">
              {String(row.index).padStart(4, '0')}
            </span>
            <span className="tabular-nums">{row.time ? formatStamp(row.time) : '—'}</span>
            <span className="text-text-secondary">{row.type}</span>
            <span className="truncate" title={row.target}>
              {row.target}
            </span>
            <HashCell value={row.entryHash} label="entry hash" onCopy={actions.onCopyHash} />
            <HashCell
              value={row.prevHash}
              label="previous hash"
              onCopy={actions.onCopyHash}
              placeholder={row.parsed ? 'genesis' : undefined}
            />
          </div>
        ))
      )}
    </div>
  )
}

// The whole ledger: every entry in sequence, typed by the nine schema-3 types,
// with the verdict and the signer fingerprints from the snapshot (X36).
export function ManifestLedgerView({
  snapshot,
  actions
}: {
  snapshot: CaseManifestSnapshot
  actions?: LedgerRowActions
}) {
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
              title={segment.fingerprint ?? 'unreadable key'}
              data-testid="ledger-signer"
            >
              {describeSigner(segment)}
            </span>
          ))
        )}
      </div>
      <LedgerRows rows={toLedgerRows(snapshot.entries)} actions={actions} />
    </div>
  )
}

// The per-row tab: only the entries that name this Exhibit.
export function ManifestLedgerTab({
  snapshot,
  exhibit,
  actions
}: {
  snapshot: CaseManifestSnapshot
  exhibit: { id: string; contentHash: string }
  actions?: LedgerRowActions
}) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="manifest-ledger-tab">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3.5 py-2">
        <ChainVerdict snapshot={snapshot} />
      </div>
      <LedgerRows rows={rowsNaming(snapshot.entries, exhibit)} actions={actions} />
    </div>
  )
}
