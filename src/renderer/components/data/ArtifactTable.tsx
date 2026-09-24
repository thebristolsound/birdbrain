import { Fragment, type KeyboardEvent, type ReactNode } from 'react'
import { FileWarning } from 'lucide-react'
import { Badge, Button } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import { EntityContextMenu } from '@renderer/components/contextmenu/EntityContextMenu'
import type { EntityMenuTarget } from '@renderer/components/contextmenu/entityMenu'
import {
  capturedTitle,
  formatBytes,
  formatStamp,
  shortHash,
  type ArtifactRow
} from '@renderer/components/data/dataTableModel'

// Inline Commit and Discard for pooled rows (X16, X38), the routes the staged
// menu items accelerate.
export interface StagingRowActions {
  commit: (id: string) => void
  discard: (id: string) => void
  pending: boolean
}

interface ArtifactTableProps {
  rows: ArtifactRow[]
  selectedId: string | null
  onSelect: (id: string) => void
  // Enter on a focused row, or a double-click: the inline route for the
  // menu's Open in viewer (#1151).
  onOpen?: (row: ArtifactRow) => void
  stagingActions?: StagingRowActions
  emptyMessage: string
  menuTargetFor?: (row: ArtifactRow) => EntityMenuTarget | null
}

function MaybeMenu({ target, children }: { target: EntityMenuTarget | null; children: ReactNode }) {
  return target ? (
    <EntityContextMenu target={target}>{children}</EntityContextMenu>
  ) : (
    <Fragment>{children}</Fragment>
  )
}

const COLUMNS =
  'minmax(160px,1.4fr) minmax(90px,.8fr) minmax(80px,.6fr) minmax(64px,72px) minmax(96px,.7fr) minmax(112px,.7fr)'

// NAME, SOURCE, KIND, SIZE, SHA-256, CAPTURED (#1149). Size is the recorded
// size at ingest, never a fresh stat. A row whose file is missing on disk says
// so on the name; a pooled row carries the not-anchored chip.
export function ArtifactTable({
  rows,
  selectedId,
  onSelect,
  onOpen,
  stagingActions,
  emptyMessage,
  menuTargetFor
}: ArtifactTableProps) {
  function onRowKey(event: KeyboardEvent<HTMLDivElement>, row: ArtifactRow) {
    // Only the row's own Enter: a keydown bubbling from the inline Commit or
    // Discard button is that button's activation, not an open.
    if (event.key === 'Enter' && onOpen && event.target === event.currentTarget) {
      event.preventDefault()
      onOpen(row)
    }
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden" data-testid="artifact-table">
      <div
        role="row"
        className="sticky top-0 z-[2] grid h-[var(--d-head)] items-center border-b border-border bg-canvas px-[var(--d-rowpad)] font-display text-[10px] font-semibold uppercase tracking-label text-text-faint"
        style={{ gridTemplateColumns: COLUMNS }}
      >
        <span>Name</span>
        <span>Source</span>
        <span>Kind</span>
        <span className="pr-3.5 text-right">Size</span>
        <span>SHA-256</span>
        <span>Captured</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-9 text-center text-xs text-text-faint">{emptyMessage}</div>
      ) : (
        rows.map((row) => {
          const selected = row.id === selectedId
          return (
            <MaybeMenu key={row.id} target={menuTargetFor?.(row) ?? null}>
              <div
                role="row"
                tabIndex={0}
                aria-selected={selected}
                data-testid={`artifact-row-${row.id}`}
                onClick={() => onSelect(row.id)}
                onDoubleClick={() => onOpen?.(row)}
                onKeyDown={(event) => onRowKey(event, row)}
                className={cn(
                  'grid min-h-[var(--d-row)] w-full cursor-pointer items-center border-b border-border px-[var(--d-rowpad)] text-left',
                  selected ? 'bg-accent-subtle' : 'hover:bg-elevated'
                )}
                style={{ gridTemplateColumns: COLUMNS }}
              >
                <span className="flex min-w-0 items-center gap-1.5 py-1 pr-2.5">
                  {!row.exists && (
                    <span
                      title="File missing on disk"
                      aria-label="File missing on disk"
                      className="grid h-[17px] w-[17px] shrink-0 place-items-center rounded bg-danger-surface text-danger-fg"
                    >
                      <FileWarning size={11} strokeWidth={2} />
                    </span>
                  )}
                  <span
                    className={cn(
                      'min-w-0 truncate font-mono text-xs',
                      selected ? 'text-text-primary' : 'text-text-secondary'
                    )}
                    title={row.name}
                  >
                    {row.name}
                  </span>
                  {row.exhibitNumber !== null && (
                    <span className="shrink-0 font-mono text-[10px] text-text-faint">
                      Exhibit {row.exhibitNumber}
                    </span>
                  )}
                  {row.staged && (
                    <Badge variant="warning" data-testid={`not-anchored-${row.id}`}>
                      not anchored
                    </Badge>
                  )}
                  {!row.staged && !row.anchored && (
                    <Badge variant="outline" data-testid={`unanchored-${row.id}`}>
                      unanchored
                    </Badge>
                  )}
                </span>
                <span className="truncate font-mono text-[11px] text-text-muted" title={row.source}>
                  {row.source}
                </span>
                <span className="truncate text-xs text-text-muted">{row.kind}</span>
                <span className="pr-3.5 text-right text-[11px] tabular-nums text-text-muted">
                  {formatBytes(row.sizeBytes)}
                </span>
                <span className="truncate font-mono text-[11px] text-text-faint" title={row.hash}>
                  {shortHash(row.hash)}
                </span>
                <span className="flex items-center gap-2 truncate text-[11px] tabular-nums text-text-faint">
                  <span className="flex min-w-0 flex-col" title={capturedTitle(row)}>
                    <span className="truncate">{formatStamp(row.capturedAt)}</span>
                    {row.capturedClock !== 'captured' && (
                      <span
                        className="truncate text-[10px]"
                        data-testid={`captured-clock-${row.id}`}
                      >
                        {row.capturedClock}
                      </span>
                    )}
                  </span>
                  {row.staged && (
                    <span
                      className="ml-auto flex shrink-0 gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!stagingActions || stagingActions.pending}
                        title="Commit to the chain"
                        onClick={() => stagingActions?.commit(row.id)}
                        data-testid={`staging-commit-${row.id}`}
                      >
                        Commit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!stagingActions || stagingActions.pending}
                        title="Discard from the pool"
                        onClick={() => stagingActions?.discard(row.id)}
                        data-testid={`staging-discard-${row.id}`}
                      >
                        Discard
                      </Button>
                    </span>
                  )}
                </span>
              </div>
            </MaybeMenu>
          )
        })
      )}
    </div>
  )
}
