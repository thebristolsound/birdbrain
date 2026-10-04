import { Fragment, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
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
  // Modifier-click toggles a row in or out of the multi-selection (#1552),
  // leaving the single selection that drives the strip where it was.
  multiSelectedIds?: ReadonlySet<string>
  onToggleMulti?: (id: string) => void
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

// The mock's six tracks (#1552).
const COLUMNS =
  'minmax(120px,1fr) minmax(56px,84px) minmax(60px,110px) minmax(48px,72px) minmax(70px,118px) minmax(66px,112px)'

// NAME, SOURCE, KIND, SIZE, SHA-256, CAPTURED (#1149). Size is the recorded
// size at ingest, never a fresh stat. A row whose file is missing on disk says
// so on the name; a pooled row carries the not-anchored chip and, since the
// CAPTURED track is too narrow for them, its Commit and Discard buttons.
export function ArtifactTable({
  rows,
  selectedId,
  onSelect,
  multiSelectedIds,
  onToggleMulti,
  onOpen,
  stagingActions,
  emptyMessage,
  menuTargetFor
}: ArtifactTableProps) {
  const tableRef = useRef<HTMLDivElement>(null)
  // Roving tab stop: one row is reachable by Tab and the arrow keys walk the
  // rest, so a long table costs one press. The stop follows focus, so Tab
  // leaves from the row the operator is on and re-entry lands there again;
  // until a row has been focused it is the selected row, else the first.
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const has = (id: string | null) => id !== null && rows.some((r) => r.id === id)
  const tabStopId = has(focusedId)
    ? focusedId
    : has(selectedId)
      ? selectedId
      : (rows[0]?.id ?? null)

  function moveRowFocus(event: KeyboardEvent<HTMLDivElement>): boolean {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key) || event.target !== event.currentTarget) return false
    const items = Array.from(
      tableRef.current?.querySelectorAll<HTMLElement>('[data-artifact-row]') ?? []
    )
    const index = items.indexOf(event.currentTarget)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : Math.min(items.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))
    event.preventDefault()
    items[next]?.focus()
    return true
  }

  function onRowKey(event: KeyboardEvent<HTMLDivElement>, row: ArtifactRow) {
    if (moveRowFocus(event)) return
    // Only the row's own Enter: a keydown bubbling from the inline Commit or
    // Discard button is that button's activation, not an open.
    if (event.key === 'Enter' && onOpen && event.target === event.currentTarget) {
      event.preventDefault()
      onOpen(row)
    }
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden" data-testid="artifact-table">
      <div ref={tableRef} role="grid" aria-label="Artifacts" aria-rowcount={rows.length + 1}>
        <div
          role="row"
          className="sticky top-0 z-[2] grid h-[var(--d-head)] items-center border-b border-l-2 border-border border-l-transparent bg-canvas px-[var(--d-rowpad)] font-display text-[10px] font-semibold uppercase tracking-label text-text-faint"
          style={{ gridTemplateColumns: COLUMNS }}
        >
          <span role="columnheader">Name</span>
          <span role="columnheader">Source</span>
          <span role="columnheader">Kind</span>
          <span role="columnheader" className="pr-3.5 text-right">
            Size
          </span>
          <span role="columnheader">SHA-256</span>
          <span role="columnheader">Captured</span>
        </div>
        {rows.map((row) => {
          const selected = row.id === selectedId
          const multi = multiSelectedIds?.has(row.id) ?? false
          return (
            <MaybeMenu key={row.id} target={menuTargetFor?.(row) ?? null}>
              <div
                role="row"
                tabIndex={row.id === tabStopId ? 0 : -1}
                data-artifact-row
                aria-selected={selected || multi}
                data-multi-selected={multi || undefined}
                data-testid={`artifact-row-${row.id}`}
                onClick={(event) => {
                  if ((event.metaKey || event.ctrlKey) && onToggleMulti) onToggleMulti(row.id)
                  else onSelect(row.id)
                }}
                onDoubleClick={() => onOpen?.(row)}
                onFocus={() => setFocusedId(row.id)}
                onKeyDown={(event) => onRowKey(event, row)}
                className={cn(
                  'grid min-h-[var(--d-row)] w-full cursor-pointer items-center border-b border-l-2 border-border px-[var(--d-rowpad)] text-left',
                  selected
                    ? 'border-l-accent bg-accent-subtle'
                    : multi
                      ? 'border-l-accent bg-accent/[0.09]'
                      : 'border-l-transparent hover:bg-elevated'
                )}
                style={{ gridTemplateColumns: COLUMNS }}
              >
                <span role="gridcell" className="flex min-w-0 items-center gap-1.5 py-1 pr-2.5">
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
                <span
                  role="gridcell"
                  className="truncate font-mono text-[11px] text-text-muted"
                  title={row.sourceDetail}
                >
                  {row.source}
                </span>
                <span role="gridcell" className="truncate text-xs text-text-muted">
                  {row.kind}
                </span>
                <span
                  role="gridcell"
                  className="pr-3.5 text-right text-[11px] tabular-nums text-text-muted"
                >
                  {formatBytes(row.sizeBytes)}
                </span>
                <span
                  role="gridcell"
                  className="truncate font-mono text-[11px] text-text-faint"
                  title={row.hash}
                >
                  {shortHash(row.hash)}
                </span>
                <span
                  role="gridcell"
                  className="flex min-w-0 flex-col text-[11px] tabular-nums text-text-faint"
                  title={capturedTitle(row)}
                >
                  <span className="truncate">{formatStamp(row.capturedAt)}</span>
                  {row.capturedClock !== 'captured' && (
                    <span className="truncate text-[10px]" data-testid={`captured-clock-${row.id}`}>
                      {row.capturedClock}
                    </span>
                  )}
                </span>
              </div>
            </MaybeMenu>
          )
        })}
      </div>
      {rows.length === 0 && (
        <div className="p-9 text-center text-xs text-text-faint">{emptyMessage}</div>
      )}
    </div>
  )
}
