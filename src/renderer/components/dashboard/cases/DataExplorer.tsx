import { useCallback, useMemo, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Search, Upload, X } from 'lucide-react'
import type { ExhibitVerification, InventoryRow } from '@shared/types'
import { Button } from '@renderer/components/ui'
import { captureContentQueryOptions, capturesQueryOptions } from '@renderer/lib/api/captures'
import {
  exhibitInventoryQueryOptions,
  manifestSnapshotQueryOptions,
  useVerifyAll
} from '@renderer/lib/api/exhibits'
import { extractedDataCountQueryOptions } from '@renderer/lib/api/extractedData'
import {
  selectorMatchCountsQueryOptions,
  selectorMatchingCapturesQueryOptions,
  selectorsQueryOptions
} from '@renderer/lib/api/selectors'
import { DataTree } from '@renderer/components/data/DataTree'
import { ArtifactTable, type StagingRowActions } from '@renderer/components/data/ArtifactTable'
import { ArtifactTabs, type ArtifactTab } from '@renderer/components/data/ArtifactTabs'
import { PropertiesTab } from '@renderer/components/data/PropertiesTab'
import { ExtractedTextTab } from '@renderer/components/data/ExtractedTextTab'
import { HeadersTlsTab, hasHeadersOrTls } from '@renderer/components/data/HeadersTlsTab'
import {
  ChainVerdict,
  ManifestLedgerTab,
  ManifestLedgerView
} from '@renderer/components/data/ManifestLedger'
import { IntegrityStrip } from '@renderer/components/data/IntegrityStrip'
import { IndicatorsView } from '@renderer/components/data/IndicatorsView'
import {
  buildDataTree,
  DEFAULT_EXPANDED,
  kindLabel,
  type DataNodeKey
} from '@renderer/components/data/dataTreeModel'
import {
  filterRows,
  integrityCounts,
  rowsForNode,
  toArtifactRow,
  type CaptureFacts,
  type RowContext
} from '@renderer/components/data/dataTableModel'

// The Data screen (#1149, #1150, #803): the inventory and integrity cross-cut
// over every Exhibit kind (X8). A rail of four groups, an artifact table, and
// a per-row tab strip. Everything integrity-shaped here is read off the main
// process — the inventory's anchored flag, the snapshot's verdict, a Capture's
// persisted verify state, this session's `exhibits:verify` results — and never
// computed in this file (X36).

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
  if (key.startsWith('keyword:')) return { title: 'Keyword hit', subtitle: 'matched Exhibits' }
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
  // This session's `exhibits:verify` results, keyed by Exhibit id. Nothing
  // persists for a non-Capture Exhibit yet, so this map is the only place its
  // bucket can come from until Verify runs again.
  const [verifications, setVerifications] = useState<ReadonlyMap<string, ExhibitVerification>>(
    () => new Map()
  )

  const { data: inventory, isLoading } = useQuery(exhibitInventoryQueryOptions(caseId))
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))
  const { data: selectors = [] } = useQuery(selectorsQueryOptions(caseId))
  const { data: matchCounts = {} } = useQuery(selectorMatchCountsQueryOptions(caseId))
  const { data: indicatorCount } = useQuery(extractedDataCountQueryOptions(caseId))
  const { data: snapshot } = useQuery(manifestSnapshotQueryOptions(caseId))
  const { run: verifyAll, progress } = useVerifyAll(caseId)

  const keywordSelectorId = node.startsWith('keyword:') ? node.slice('keyword:'.length) : null
  const { data: keywordCaptureIds } = useQuery(
    selectorMatchingCapturesQueryOptions(caseId, keywordSelectorId ? [keywordSelectorId] : [])
  )

  const rows = useMemo(() => inventory?.rows ?? [], [inventory])
  const captureFacts = useMemo(() => {
    const map = new Map<string, CaptureFacts>()
    for (const capture of captures) {
      map.set(capture.id, { url: capture.url, lastVerifiedStatus: capture.lastVerifiedStatus })
    }
    return map
  }, [captures])
  const captureById = useMemo(() => new Map(captures.map((c) => [c.id, c])), [captures])
  const keywordMatches = useMemo(() => {
    const map = new Map<string, ReadonlySet<string>>()
    if (keywordSelectorId && keywordCaptureIds) {
      map.set(keywordSelectorId, new Set(keywordCaptureIds))
    }
    return map
  }, [keywordSelectorId, keywordCaptureIds])
  const context = useMemo<RowContext>(
    () => ({ captures: captureFacts, verifications, keywordMatches }),
    [captureFacts, verifications, keywordMatches]
  )
  const buckets = useMemo(() => integrityCounts(rows, context), [rows, context])

  const tree = useMemo(
    () =>
      buildDataTree({
        rows,
        expanded,
        results: {
          keywordHits: selectors.length,
          indicators: indicatorCount ?? null,
          integrityExceptions: buckets.exception,
          manifestLedger: snapshot ? snapshot.entries.length : null
        },
        keywordHits: selectors.map((selector) => ({
          selectorId: selector.id,
          label: selector.label || selector.pattern,
          count: matchCounts[selector.id] ?? 0
        }))
      }),
    [rows, expanded, selectors, indicatorCount, buckets.exception, snapshot, matchCounts]
  )

  const tableRows = useMemo(
    () =>
      filterRows(
        rowsForNode(rows, node, captureFacts, { verifications, keywordMatches }).map((row) =>
          toArtifactRow(row, rows, captureFacts)
        ),
        query
      ),
    [rows, node, captureFacts, verifications, keywordMatches, query]
  )

  const selectedRow = rows.find((row) => row.id === selectedId) ?? null
  const selectedCapture =
    selectedRow?.entity === 'exhibit' ? captureById.get(selectedRow.id) : undefined
  const { data: extractedText } = useQuery({
    ...captureContentQueryOptions(selectedCapture?.id ?? '', 'txt'),
    enabled: selectedCapture !== undefined
  })
  const highlightSelector = keywordSelectorId
    ? selectors.find((selector) => selector.id === keywordSelectorId)
    : undefined
  const { title, subtitle } = nodeTitle(node, rows)

  // The Staging Pool's channels arrive with #1148; until then the group
  // renders with its actions visibly inert rather than absent.
  const stagingActions: StagingRowActions | undefined = undefined

  const recordVerification = useCallback((result: ExhibitVerification) => {
    setVerifications((current) => {
      const next = new Map(current)
      next.set(result.exhibitId, result)
      return next
    })
  }, [])

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

  // A tab with no data for the row's kind is absent, not empty (#1150).
  const tabs: ArtifactTab[] = []
  if (selectedRow) {
    if (selectedCapture && typeof extractedText === 'string') {
      tabs.push({
        id: 'text',
        label: 'Extracted Text',
        hint: `${extractedText.split(/\r?\n/).length} lines · extracted at capture`,
        content: (
          <ExtractedTextTab
            text={extractedText}
            highlight={
              highlightSelector
                ? { pattern: highlightSelector.pattern, isRegex: highlightSelector.isRegex }
                : undefined
            }
          />
        )
      })
    }
    if (selectedCapture && hasHeadersOrTls(selectedCapture)) {
      tabs.push({
        id: 'headers',
        label: 'Headers & TLS',
        hint: selectedCapture.httpStatus ? `HTTP ${selectedCapture.httpStatus}` : undefined,
        content: <HeadersTlsTab capture={selectedCapture} />
      })
    }
    if (snapshot && selectedRow.rowType === 'anchored' && selectedRow.manifestSeq !== null) {
      tabs.push({
        id: 'ledger',
        label: 'Manifest Ledger',
        hint: `${snapshot.entries.length} entries`,
        content: (
          <ManifestLedgerTab
            snapshot={snapshot}
            exhibit={{ id: selectedRow.id, contentHash: selectedRow.contentHash }}
          />
        )
      })
    }
    tabs.push({
      id: 'properties',
      label: 'Properties',
      hint: 'file and source metadata',
      content: <PropertiesTab row={selectedRow} rows={rows} capture={selectedCapture} />
    })
  }

  const anchoredExhibitIds = rows
    .filter((row) => row.entity === 'exhibit' && row.rowType === 'anchored')
    .map((row) => row.id)

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
                {(node === 'integrity-exceptions' || node === 'manifest-ledger') && snapshot && (
                  <ChainVerdict snapshot={snapshot} />
                )}
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
              {node === 'manifest-ledger' ? (
                snapshot ? (
                  <ManifestLedgerView snapshot={snapshot} />
                ) : (
                  <div className="p-9 text-center text-xs text-text-faint">Loading the ledger…</div>
                )
              ) : (
                <>
                  {node === 'integrity-exceptions' && (
                    <IntegrityStrip
                      counts={buckets}
                      progress={progress}
                      disabled={anchoredExhibitIds.length === 0}
                      onVerifyAll={() => void verifyAll(anchoredExhibitIds, recordVerification)}
                    />
                  )}
                  <ArtifactTable
                    rows={tableRows}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    stagingActions={stagingActions}
                    emptyMessage={
                      node === 'staging'
                        ? 'Nothing in the pool.'
                        : node === 'integrity-exceptions'
                          ? 'No exceptions among the verified rows.'
                          : query
                            ? 'No files match this search.'
                            : 'No files under this node.'
                    }
                  />
                </>
              )}
            </section>
            {selectedRow && node !== 'manifest-ledger' && (
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
