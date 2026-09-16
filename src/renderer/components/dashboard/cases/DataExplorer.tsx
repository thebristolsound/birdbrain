import { useMemo, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Search, Upload, X } from 'lucide-react'
import { Button } from '@renderer/components/ui'
import { capturesQueryOptions } from '@renderer/lib/api/captures'
import {
  exhibitInventoryQueryOptions,
  manifestSnapshotQueryOptions
} from '@renderer/lib/api/exhibits'
import { extractedDataCountQueryOptions } from '@renderer/lib/api/extractedData'
import { selectorsQueryOptions } from '@renderer/lib/api/selectors'
import { DataTree } from '@renderer/components/data/DataTree'
import { ArtifactTable, type StagingRowActions } from '@renderer/components/data/ArtifactTable'
import { ArtifactTabs, type ArtifactTab } from '@renderer/components/data/ArtifactTabs'
import { PropertiesTab } from '@renderer/components/data/PropertiesTab'
import { IndicatorsView } from '@renderer/components/data/IndicatorsView'
import {
  buildDataTree,
  DEFAULT_EXPANDED,
  kindLabel,
  type DataNodeKey
} from '@renderer/components/data/dataTreeModel'
import {
  filterRows,
  rowsForNode,
  toArtifactRow,
  type CaptureFacts
} from '@renderer/components/data/dataTableModel'
import type { InventoryRow } from '@shared/types'

// The Data screen (#1149, #803): the inventory and integrity cross-cut over
// every Exhibit kind (X8). A rail of four groups, an artifact table, and a
// per-row tab strip. Everything integrity-shaped here is read off the main
// process — the inventory's anchored flag, the snapshot's verdict, a Capture's
// persisted verify state — and never computed in this file (X36).

function nodeTitle(key: DataNodeKey, rows: InventoryRow[]): { title: string; subtitle: string } {
  if (key === 'data-sources')
    return { title: 'All data sources', subtitle: 'every Exhibit and Derived File in the case' }
  if (key === 'staging')
    return { title: 'Staging', subtitle: 'pooled files, not anchored (ADR-0024)' }
  if (key === 'views' || key === 'file-types')
    return { title: 'File types', subtitle: 'grouped by stored file type' }
  if (key === 'results') return { title: 'Results', subtitle: 'derived findings' }
  if (key === 'keyword-hits') return { title: 'Keyword hits', subtitle: 'per Selector' }
  if (key === 'integrity-exceptions')
    return { title: 'Integrity exceptions', subtitle: 'files whose last verify did not pass' }
  if (key === 'manifest-ledger')
    return { title: 'Manifest ledger', subtitle: 'the hash chain across the case' }
  if (key.startsWith('kind:'))
    return { title: kindLabel(key.slice('kind:'.length)), subtitle: 'by kind' }
  if (key.startsWith('file-type:'))
    return { title: key.slice('file-type:'.length), subtitle: 'file type view' }
  if (key.startsWith('exhibit:')) {
    const id = key.slice('exhibit:'.length)
    const row = rows.find((r) => r.entity === 'exhibit' && r.id === id)
    return row && row.entity === 'exhibit'
      ? { title: row.name, subtitle: `Exhibit ${row.exhibitNumber}` }
      : { title: 'Exhibit', subtitle: '' }
  }
  if (key.startsWith('derived:')) {
    const id = key.slice('derived:'.length)
    const row = rows.find((r) => r.entity === 'derived-file' && r.id === id)
    return row && row.entity === 'derived-file'
      ? { title: row.derivation, subtitle: 'Derived File' }
      : { title: 'Derived File', subtitle: '' }
  }
  return { title: key, subtitle: '' }
}

export function DataExplorer() {
  const { caseId } = useParams({ from: '/cases/$caseId/data' })
  const [node, setNode] = useState<DataNodeKey>('data-sources')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(DEFAULT_EXPANDED)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: inventory, isLoading } = useQuery(exhibitInventoryQueryOptions(caseId))
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))
  const { data: selectors = [] } = useQuery(selectorsQueryOptions(caseId))
  const { data: indicatorCount } = useQuery(extractedDataCountQueryOptions(caseId))
  const { data: snapshot } = useQuery(manifestSnapshotQueryOptions(caseId))

  const rows = useMemo(() => inventory?.rows ?? [], [inventory])
  const captureFacts = useMemo(() => {
    const map = new Map<string, CaptureFacts>()
    for (const capture of captures) {
      map.set(capture.id, { url: capture.url, lastVerifiedStatus: capture.lastVerifiedStatus })
    }
    return map
  }, [captures])
  const captureById = useMemo(() => new Map(captures.map((c) => [c.id, c])), [captures])

  const tree = useMemo(
    () =>
      buildDataTree({
        rows,
        expanded,
        results: {
          keywordHits: selectors.length,
          indicators: indicatorCount ?? null,
          // The same selector the node's table uses, so the count and the
          // rows cannot disagree.
          integrityExceptions: rowsForNode(rows, 'integrity-exceptions', captureFacts).length,
          manifestLedger: snapshot ? snapshot.entries.length : null
        }
      }),
    [rows, expanded, selectors.length, indicatorCount, captureFacts, snapshot]
  )

  const tableRows = useMemo(
    () =>
      filterRows(
        rowsForNode(rows, node, captureFacts).map((row) => toArtifactRow(row, rows, captureFacts)),
        query
      ),
    [rows, node, captureFacts, query]
  )

  // Resolved from the table as filtered, so a row the search has hidden does
  // not keep its strip open.
  const selectedRow = tableRows.find((row) => row.id === selectedId)?.raw ?? null
  const { title, subtitle } = nodeTitle(node, rows)

  // The Staging Pool's channels arrive with #1148; until then the group
  // renders with its actions visibly inert rather than absent.
  const stagingActions: StagingRowActions | undefined = undefined

  function toggle(key: DataNodeKey) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        Loading case data...
      </div>
    )
  }

  const tabs: ArtifactTab[] = selectedRow
    ? [
        {
          id: 'properties',
          label: 'Properties',
          hint: 'file and source metadata',
          content: (
            <PropertiesTab
              row={selectedRow}
              rows={rows}
              capture={
                selectedRow.entity === 'exhibit' ? captureById.get(selectedRow.id) : undefined
              }
            />
          )
        }
      ]
    : []

  return (
    <div className="flex h-full min-h-0" data-testid="data-explorer">
      <aside className="flex w-[276px] shrink-0 flex-col border-r border-border bg-surface">
        <div className="border-b border-border p-2.5">
          <div className="flex items-center gap-1.5 rounded border border-border-strong bg-canvas px-2 py-[5px]">
            <Search size={13} className="shrink-0 text-text-muted" />
            <input
              type="text"
              aria-label="Search files, exhibits, kinds and hashes"
              placeholder="Search files, exhibits, hashes…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-faint"
              data-testid="data-search"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery('')}
                className="grid h-4 w-4 shrink-0 place-items-center rounded text-text-muted hover:bg-elevated"
              >
                <X size={11} strokeWidth={2.2} />
              </button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DataTree
            nodes={tree}
            selected={node}
            onSelect={(key) => {
              setNode(key)
              setSelectedId(null)
            }}
            onToggle={toggle}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {node === 'indicators' ? (
          <IndicatorsView caseId={caseId} />
        ) : (
          <>
            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex h-[38px] shrink-0 items-center gap-2.5 border-b border-border bg-surface px-3.5">
                <span
                  className="font-display text-xs font-bold text-text-primary"
                  data-testid="data-node-title"
                >
                  {title}
                </span>
                <span
                  className="min-w-0 truncate text-[11px] text-text-faint"
                  data-testid="data-node-subtitle"
                >
                  {subtitle}
                </span>
                <div className="flex-1" />
                {node === 'staging' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={!stagingActions}
                    title={
                      stagingActions
                        ? 'Add files to the Staging Pool'
                        : 'Arrives with the Staging Pool (#1148)'
                    }
                    data-testid="staging-upload"
                  >
                    <Upload size={12} strokeWidth={1.8} />
                    Upload
                  </Button>
                )}
              </div>
              <ArtifactTable
                rows={tableRows}
                selectedId={selectedId}
                onSelect={setSelectedId}
                stagingActions={stagingActions}
                emptyMessage={
                  node === 'staging'
                    ? 'Nothing in the pool.'
                    : query
                      ? 'No files match this search.'
                      : 'No files under this node.'
                }
              />
            </section>
            {selectedRow && (
              <ArtifactTabs
                title={selectedRow.name}
                subtitle={selectedRow.path ?? 'no file recorded'}
                tabs={tabs}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
