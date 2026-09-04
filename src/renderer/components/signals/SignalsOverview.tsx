import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ListPlus } from 'lucide-react'
import { SIGNAL_COVERAGE_CAPTURES } from '@shared/constants'
import { capturesQueryOptions } from '@renderer/lib/api/captures'
import {
  deleteSelector,
  exportSelectorMatches,
  selectorCaptureMatrixQueryOptions,
  selectorMatchCountsQueryOptions,
  selectorsQueryOptions,
  updateSelector,
  useSelectorsMutations
} from '@renderer/lib/api/selectors'
import {
  tagCaptureMatrixQueryOptions,
  tagUsageCountsForCaseQueryOptions,
  tagsQueryOptions,
  useTagsMutations
} from '@renderer/lib/api/tags'
import { queryKeys } from '@renderer/lib/api/keys'
import { notify } from '@renderer/lib/notify'
import { useAppStore } from '@renderer/stores/appStore'
import { CreateSelectorCard } from '@renderer/components/selectors/CreateSelectorCard'
import { AutoCaptureCard } from '@renderer/components/signals/AutoCaptureCard'
import { AddSelectorRow } from '@renderer/components/signals/AddSelectorRow'
import { AddTagRow } from '@renderer/components/signals/AddTagRow'
import { BulkImportDrawer } from '@renderer/components/signals/BulkImportDrawer'
import { DeleteTagDialog } from '@renderer/components/signals/DeleteTagDialog'
import { MergeTagDialog } from '@renderer/components/signals/MergeTagDialog'
import { SignalRow } from '@renderer/components/signals/SignalRow'
import { SignalDetailRail } from '@renderer/components/signals/SignalDetailRail'
import {
  buildSelectorSignals,
  buildTagSignals,
  nextTagColor,
  type Signal
} from '@renderer/components/signals/signalsModel'

const SECTION_HEADING =
  'font-display text-[10px] font-semibold uppercase tracking-[.06em] text-text-faint'
const COVERAGE_CAPTION = `coverage · ${SIGNAL_COVERAGE_CAPTURES} most recent captures →`

const KEYBOARD_LEGEND = [
  ['↑↓', 'move'],
  ['↵', 'rename'],
  ['space', 'enable'],
  ['⌫', 'delete'],
  ['/…/', 'regex']
] as const

// The Signals screen: one page for everything this case is watching for.
//
// It replaces the separate Selectors and Tags screens (#400, #700). They were
// the same job split across two tabs — "what should this case notice?" — and
// keeping them apart meant an operator had to know which kind of thing they
// wanted before they could look for it.
export function SignalsOverview() {
  const { caseId } = useParams({ from: '/cases/$caseId/signals' })
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const addSelectorFilter = useAppStore((s) => s.addSelectorFilter)
  const addTagFilter = useAppStore((s) => s.addTagFilter)

  const { data: selectors = [] } = useQuery(selectorsQueryOptions(caseId))
  const { data: matchCounts = {} } = useQuery(selectorMatchCountsQueryOptions(caseId))
  const { data: selectorMatrix = {} } = useQuery(selectorCaptureMatrixQueryOptions(caseId))
  const { data: tags = [] } = useQuery(tagsQueryOptions)
  const { data: tagCounts = {} } = useQuery(tagUsageCountsForCaseQueryOptions(caseId))
  const { data: tagMatrix = {} } = useQuery(tagCaptureMatrixQueryOptions(caseId))
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))

  const { create: createTag, update: updateTag } = useTagsMutations(caseId)
  const { create: createSelectorMutation } = useSelectorsMutations(caseId)

  // A Mention chip names its target in the store before it navigates (#716).
  // Read once as the initial value rather than subscribed, then cleared below:
  // it is a hand-off, not a stored selection. Leaving it set is what makes a
  // note chip open the previously-selected note instead of its own (#772), and
  // this screen would inherit the same defect.
  const [selectedId, setSelectedId] = useState<string | null>(
    () => useAppStore.getState().selectedSignalId
  )
  const [bulkOpen, setBulkOpen] = useState(false)
  // The tag a delete is waiting on confirmation for (#957). Naming one is not
  // consent: nothing is written until DeleteTagDialog's own button.
  const [pendingTagDelete, setPendingTagDelete] = useState<{ id: string; name: string } | null>(
    null
  )
  // The tag a merge was started from, by the detail rail's button or by a row's
  // context menu. One dialog for both routes, mounted here rather than in the
  // rail, so the two cannot drift apart.
  const [mergeSource, setMergeSource] = useState<{ id: string; name: string } | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const selectorInputRef = useRef<HTMLInputElement>(null)
  const tagInputRef = useRef<HTMLInputElement>(null)

  const recentCaptures = useMemo(
    // listCaptures is newest-first, and the matrices are bounded by the same
    // number on the same ordering, so these are the cells the strip draws.
    () => captures.slice(0, SIGNAL_COVERAGE_CAPTURES),
    [captures]
  )

  useEffect(() => {
    if (useAppStore.getState().selectedSignalId) useAppStore.getState().setSelectedSignalId(null)
  }, [])

  const selectorSignals = useMemo(
    () => buildSelectorSignals(selectors, matchCounts, selectorMatrix),
    [selectors, matchCounts, selectorMatrix]
  )
  const tagSignals = useMemo(
    () => buildTagSignals(tags, tagCounts, tagMatrix),
    [tags, tagCounts, tagMatrix]
  )
  const allSignals = useMemo(
    () => [...selectorSignals, ...tagSignals],
    [selectorSignals, tagSignals]
  )
  const selected = allSignals.find((signal) => signal.id === selectedId) ?? allSignals[0] ?? null

  const totalMatches = Object.values(matchCounts).reduce((a, b) => a + b, 0)

  function refreshSelectors() {
    queryClient.invalidateQueries({ queryKey: queryKeys.selectors(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.selectorMatchCounts(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.selectorCaptureMatrix(caseId) })
  }

  function registerRow(id: string) {
    return (element: HTMLDivElement | null) => {
      if (element) rowRefs.current.set(id, element)
      else rowRefs.current.delete(id)
    }
  }

  // Arrow keys walk one card's rows. Off the top of the list, focus returns to
  // that card's add row, so the whole card is reachable without the mouse.
  function focusSibling(list: Signal[], id: string, direction: -1 | 1, kind: Signal['kind']) {
    const index = list.findIndex((signal) => signal.id === id)
    const next = list[index + direction]
    if (next) {
      rowRefs.current.get(next.id)?.focus()
      return
    }
    if (direction === -1) {
      const input = kind === 'tag' ? tagInputRef.current : selectorInputRef.current
      input?.focus()
    }
  }

  async function handleAddSelector(pattern: string, isRegex: boolean) {
    // 'manual' (#395): typed into this case by the operator, with no capture or
    // note behind it.
    const created = await createSelectorMutation.mutateAsync({
      caseId,
      pattern,
      isRegex,
      origin: 'manual'
    })
    setSelectedId(created.id)
  }

  async function handleRenameSelector(signal: Signal, value: string) {
    await updateSelector({ id: signal.id, pattern: value })
    refreshSelectors()
  }

  async function handleExportAll() {
    setExporting(true)
    try {
      await exportSelectorMatches(caseId)
    } catch (err) {
      console.error('Export matches failed:', err)
    } finally {
      setExporting(false)
    }
  }

  // The row-menu actions that are the detail rail's buttons, called with the
  // right-clicked signal rather than the selected one. Both kinds narrow the
  // captures list before navigating (#918); they are separate handlers because
  // the two menus name the action differently.
  function showSelectorMatches(signal: Signal) {
    addSelectorFilter(signal.id)
    navigate({ to: '/cases/$caseId/captures', params: { caseId } })
  }

  function filterCapturesByTag(signal: Signal) {
    addTagFilter(signal.id)
    navigate({ to: '/cases/$caseId/captures', params: { caseId } })
  }

  async function exportSignalMatches(signal: Signal) {
    try {
      await exportSelectorMatches(caseId, signal.id)
    } catch (cause) {
      // The export is not a mutation, so nothing else reports it: without this
      // a failed write is indistinguishable from a file the operator never
      // finds.
      notify.error("Couldn't export the selector's matches", { cause })
    }
  }

  function renderRows(list: Signal[], emptyCopy: string) {
    if (list.length === 0) {
      return <div className="px-0.5 py-2.5 text-[11px] text-text-faint">{emptyCopy}</div>
    }
    return list.map((signal) => (
      <SignalRow
        key={signal.id}
        signal={signal}
        captures={recentCaptures}
        selected={selected?.id === signal.id}
        registerRow={registerRow(signal.id)}
        onSelect={() => setSelectedId(signal.id)}
        onFocusSibling={(direction) => focusSibling(list, signal.id, direction, signal.kind)}
        onToggleEnabled={() => {
          if (signal.kind !== 'selector') return
          void updateSelector({ id: signal.id, enabled: !signal.enabled }).then(refreshSelectors)
        }}
        onToggleRegex={() => {
          if (signal.kind !== 'selector') return
          void updateSelector({ id: signal.id, isRegex: !signal.isRegex }).then(refreshSelectors)
        }}
        onRename={(value) => {
          if (signal.kind === 'tag') updateTag.mutate({ id: signal.id, name: value })
          else void handleRenameSelector(signal, value)
        }}
        onDelete={() => {
          // Tags are app-global, so this reaches every case and asks first
          // (#957). A selector belongs to this case and is unchanged.
          if (signal.kind === 'tag') setPendingTagDelete({ id: signal.id, name: signal.name })
          else void deleteSelector(signal.id).then(refreshSelectors)
        }}
        onShowMatches={() => showSelectorMatches(signal)}
        onExportMatches={() => void exportSignalMatches(signal)}
        onFilterCaptures={() => filterCapturesByTag(signal)}
        onSetColor={(color) => updateTag.mutate({ id: signal.id, color })}
        onMerge={() => setMergeSource({ id: signal.id, name: signal.name })}
      />
    ))
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="signals-overview">
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto p-[var(--d-pad)]">
          <div className="flex flex-col gap-[var(--d-gap)]">
            <AutoCaptureCard caseId={caseId} />

            <section className="flex flex-col rounded-md border border-border bg-card p-[var(--d-card)]">
              <div className="mb-2.5 flex items-center gap-2">
                <span className={SECTION_HEADING}>Selectors</span>
                <button
                  type="button"
                  data-testid="bulk-add-btn"
                  onClick={() => setBulkOpen((v) => !v)}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-text-muted hover:text-accent"
                >
                  <ListPlus className="h-[11px] w-[11px]" strokeWidth={2} />
                  Bulk import
                </button>
                <span className="flex-1" />
                <button
                  type="button"
                  data-testid="export-matches-btn"
                  onClick={handleExportAll}
                  disabled={totalMatches === 0 || exporting}
                  title={
                    totalMatches === 0
                      ? 'No selector matches to export'
                      : 'Export every selector match in this case to CSV'
                  }
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-text-muted hover:text-accent disabled:opacity-50"
                >
                  <Download className="h-[11px] w-[11px]" strokeWidth={2} />
                  {exporting ? 'Exporting…' : 'Export all'}
                </button>
                <span className="text-[10px] text-text-faint">{COVERAGE_CAPTION}</span>
              </div>

              {bulkOpen && (
                <BulkImportDrawer
                  caseId={caseId}
                  existingSelectors={selectors}
                  onClose={() => setBulkOpen(false)}
                />
              )}

              <AddSelectorRow
                ref={selectorInputRef}
                onAdd={(pattern, isRegex) => void handleAddSelector(pattern, isRegex)}
                onFocusList={() =>
                  selectorSignals[0] && rowRefs.current.get(selectorSignals[0].id)?.focus()
                }
              />

              <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
                {renderRows(
                  selectorSignals,
                  'No selectors yet — type a pattern above to add the first.'
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2.5 px-0.5 pt-2.5 text-[10px] text-text-faint">
                {KEYBOARD_LEGEND.map(([key, action]) => (
                  <span key={key} className="flex items-center gap-1">
                    <kbd className="rounded border border-border px-1 py-px font-mono text-[10px]">
                      {key}
                    </kbd>
                    {action}
                  </span>
                ))}
              </div>

              {/* The inline row above is the fast path. This keeps the label
                  field and the Foreground Match Preview, which the design's row
                  has no room for and which nothing else on the screen offers —
                  testing a pattern before it starts matching evidence is not a
                  capability to drop with the old screen. */}
              <div className="mt-2.5">
                <CreateSelectorCard
                  isOpen={advancedOpen}
                  onToggle={() => setAdvancedOpen((v) => !v)}
                  onCreated={() => {
                    setAdvancedOpen(false)
                    refreshSelectors()
                  }}
                  caseId={caseId}
                />
              </div>
            </section>

            <section className="flex flex-col rounded-md border border-border bg-card p-[var(--d-card)]">
              <div className="mb-2.5 flex items-center gap-2">
                <span className={SECTION_HEADING}>Tags</span>
                <span className="flex-1" />
                <span className="text-[10px] text-text-faint">{COVERAGE_CAPTION}</span>
              </div>

              <AddTagRow
                ref={tagInputRef}
                nextColor={nextTagColor(tags.length)}
                onAdd={(name) => createTag.mutate({ name, color: nextTagColor(tags.length) })}
                onFocusList={() => tagSignals[0] && rowRefs.current.get(tagSignals[0].id)?.focus()}
              />

              <div
                data-testid="signals-tag-list"
                className="flex max-h-64 flex-col gap-0.5 overflow-y-auto"
              >
                {renderRows(tagSignals, 'No tags yet — name one above to add the first.')}
              </div>
            </section>
          </div>
        </div>

        <SignalDetailRail
          caseId={caseId}
          signal={selected}
          captures={recentCaptures}
          totalCaptures={captures.length}
          onToggleEnabled={(signal) => {
            void updateSelector({ id: signal.id, enabled: !signal.enabled }).then(refreshSelectors)
          }}
          onMerge={(signal) => setMergeSource({ id: signal.id, name: signal.name })}
        />
      </div>

      {/* Mounted only while a delete is pending, so the dialog holds no state
          between two different tags. */}
      {pendingTagDelete && (
        <DeleteTagDialog
          open
          onOpenChange={(next) => {
            if (!next) setPendingTagDelete(null)
          }}
          tag={pendingTagDelete}
        />
      )}

      {/* Mounted only while open, for the same reason and because the dialog
          fetches the tag list when it mounts. A merge deletes the source tag;
          selecting the survivor keeps the rail on the tag the operator's links
          now live under, instead of falling back to whatever is first. */}
      {mergeSource && (
        <MergeTagDialog
          open
          onOpenChange={(next) => {
            if (!next) setMergeSource(null)
          }}
          source={mergeSource}
          onMerged={setSelectedId}
        />
      )}
    </div>
  )
}
