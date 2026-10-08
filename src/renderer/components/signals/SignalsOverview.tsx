import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ListPlus } from 'lucide-react'
import { ExportDialog } from '@renderer/components/export/ExportDialog'
import { caseQueryOptions } from '@renderer/lib/api/cases'
import { duplicateTagName, tagCapturesMarkdown } from '@renderer/components/signals/tagMenuActions'
import { SIGNAL_COVERAGE_CAPTURES } from '@shared/constants'
import { capturesQueryOptions } from '@renderer/lib/api/captures'
import {
  exportSelectorMatches,
  selectorCaptureMatrixQueryOptions,
  selectorMatchCountsQueryOptions,
  selectorsQueryOptions,
  updateSelector,
  useSelectorsMutations
} from '@renderer/lib/api/selectors'
import {
  getCapturesForTag,
  tagCaptureMatrixQueryOptions,
  tagUsageCountsForCaseQueryOptions,
  tagsQueryOptions,
  useTagsMutations
} from '@renderer/lib/api/tags'
import { queryKeys } from '@renderer/lib/api/keys'
import { notify } from '@renderer/lib/notify'
import { regexPatternError } from '@shared/selectorPattern'
import { useAppStore } from '@renderer/stores/appStore'
import { CreateSelectorCard } from '@renderer/components/selectors/CreateSelectorCard'
import { AutoCaptureCard } from '@renderer/components/signals/AutoCaptureCard'
import { copyValue } from '@renderer/components/data/copy'
import { AddSelectorRow, type SelectorPrefill } from '@renderer/components/signals/AddSelectorRow'
import { AddTagRow } from '@renderer/components/signals/AddTagRow'
import { BulkImportDrawer } from '@renderer/components/signals/BulkImportDrawer'
import { DeleteSelectorDialog } from '@renderer/components/signals/DeleteSelectorDialog'
import { DeleteTagDialog } from '@renderer/components/signals/DeleteTagDialog'
import { MergeTagDialog } from '@renderer/components/signals/MergeTagDialog'
import { SignalRow } from '@renderer/components/signals/SignalRow'
import { SignalDetailRail } from '@renderer/components/signals/SignalDetailRail'
import {
  buildSelectorSignals,
  buildTagSignals,
  findDuplicateSelector,
  findTagByName,
  nextTagColor,
  type Signal
} from '@renderer/components/signals/signalsModel'

const SECTION_HEADING =
  'font-display text-[10px] font-semibold uppercase tracking-[.06em] text-text-faint'
const COVERAGE_CAPTION = `coverage · ${SIGNAL_COVERAGE_CAPTURES} most recent captures →`

const KEYBOARD_LEGEND = [
  ['↑↓', 'move'],
  // The menu item and the editor's label both say edit pattern, and the
  // action changes what the selector matches, not what it is called.
  ['↵', 'edit pattern'],
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

  const { data: caseData } = useQuery(caseQueryOptions(caseId))
  const [exportCaptureIds, setExportCaptureIds] = useState<string[] | null>(null)
  const exportCaseRef = useRef(caseId)
  useEffect(() => {
    exportCaseRef.current = caseId
    setExportCaptureIds(null)
  }, [caseId])
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
  // The selector counterpart (#1549): a selector's delete takes its persisted
  // matches with it, so all three routes stop at a dialog naming it.
  const [pendingSelectorDelete, setPendingSelectorDelete] = useState<{
    id: string
    name: string
    matchCount: number
  } | null>(null)
  const [selectorPrefill, setSelectorPrefill] = useState<SelectorPrefill | null>(null)
  // The tag a merge was started from, by the detail rail's button or by a row's
  // context menu. One dialog for both routes, mounted here rather than in the
  // rail, so the two cannot drift apart.
  const [mergeSource, setMergeSource] = useState<{ id: string; name: string } | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  // Each list is a grid with one Tab stop: the row last focused, else the
  // selected row, else the first. The arrow keys reach the others.
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null)
  function isTabStop(list: Signal[], id: string): boolean {
    const has = (candidate: string | null | undefined) =>
      candidate != null && list.some((signal) => signal.id === candidate)
    const stop = has(focusedRowId) ? focusedRowId : has(selectedId) ? selectedId : list[0]?.id
    return stop === id
  }
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

  // The same refusal bulk import applies (#1549): a second selector on one
  // pattern doubles every count downstream of it. The existing one is selected
  // so the operator lands on what they were about to recreate.
  function refuseDuplicateSelector(pattern: string, isRegex: boolean, exceptId?: string) {
    const others = exceptId ? selectors.filter((s) => s.id !== exceptId) : selectors
    const duplicate = findDuplicateSelector(others, pattern, isRegex)
    if (!duplicate) return false
    notify.info(`‘${pattern}’ is already a selector in this case`)
    setSelectedId(duplicate.id)
    return true
  }

  function handleAddSelector(pattern: string, isRegex: boolean): boolean {
    if (refuseDuplicateSelector(pattern, isRegex)) return false
    // 'manual' (#395): typed into this case by the operator, with no capture or
    // note behind it.
    createSelectorMutation.mutate(
      { caseId, pattern, isRegex, origin: 'manual' },
      { onSuccess: (created) => setSelectedId(created.id) }
    )
    return true
  }

  // A regex that does not compile is saved but matches nothing, which reads as
  // "the term is absent" (#1754). The add row shows its own inline error; the
  // row's rename and regex chip land here.
  function refuseInvalidRegex(pattern: string): boolean {
    const reason = regexPatternError(pattern)
    if (!reason) return false
    notify.info(`‘${pattern}’ is not a valid regular expression: ${reason}`)
    return true
  }

  async function handleRenameSelector(signal: Signal, value: string) {
    if (signal.isRegex && refuseInvalidRegex(value)) return
    if (refuseDuplicateSelector(value, signal.isRegex, signal.id)) return
    await updateSelector({ id: signal.id, pattern: value })
    refreshSelectors()
  }

  // Checked here rather than left to the UNIQUE constraint, which reaches the
  // operator as the generic could-not-create toast with a bug-report action
  // (#1549, the operator half of #811). A name a stale list missed still falls
  // through to that toast.
  function refuseTakenTagName(name: string, exceptId?: string): boolean {
    if (!findTagByName(tags, name, exceptId)) return false
    notify.info(`A tag named ‘${name}’ already exists`)
    return true
  }

  function handleAddTag(name: string): boolean {
    if (refuseTakenTagName(name)) return false
    createTag.mutate({ name, color: nextTagColor(tags.length) })
    return true
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

  // Duplicate opens the add row on this pattern rather than writing a copy: an
  // identical selector is exactly what the row refuses, so the operator edits
  // it into the new one first.
  function duplicateSelector(signal: Signal) {
    setSelectorPrefill((previous) => ({
      pattern: signal.sub,
      isRegex: signal.isRegex,
      seq: (previous?.seq ?? 0) + 1
    }))
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

  async function duplicateTag(signal: Signal) {
    try {
      const created = await createTag.mutateAsync({
        name: duplicateTagName(
          signal.name,
          tags.map((tag) => tag.name)
        ),
        color: tags.find((tag) => tag.id === signal.id)?.color
      })
      setSelectedId(created.id)
    } catch (cause) {
      notify.error("Couldn't duplicate the tag", { cause })
    }
  }

  async function exportTag(signal: Signal, markdown: boolean) {
    try {
      const taggedCaptures = await getCapturesForTag(caseId, signal.id)
      if (exportCaseRef.current !== caseId) return
      if (taggedCaptures.length === 0) {
        notify.info('This tag has no captures in this case')
        return
      }
      if (markdown) {
        await navigator.clipboard.writeText(tagCapturesMarkdown(signal.name, taggedCaptures))
        notify.success('Copied tagged captures as markdown')
      } else {
        setExportCaptureIds(taggedCaptures.map((capture) => capture.id))
      }
    } catch (cause) {
      notify.error("Couldn't export the tag's captures", { cause })
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
        tabStop={isTabStop(list, signal.id)}
        onFocusWithin={() => setFocusedRowId(signal.id)}
        onSelect={() => setSelectedId(signal.id)}
        onFocusSibling={(direction) => focusSibling(list, signal.id, direction, signal.kind)}
        onToggleEnabled={() => {
          if (signal.kind !== 'selector') return
          void updateSelector({ id: signal.id, enabled: !signal.enabled }).then(refreshSelectors)
        }}
        onToggleRegex={() => {
          if (signal.kind !== 'selector') return
          if (!signal.isRegex && refuseInvalidRegex(signal.sub)) return
          void updateSelector({ id: signal.id, isRegex: !signal.isRegex }).then(refreshSelectors)
        }}
        onRename={(value) => {
          if (signal.kind === 'selector') void handleRenameSelector(signal, value)
          else if (!refuseTakenTagName(value, signal.id)) {
            updateTag.mutate({ id: signal.id, name: value })
          }
        }}
        onDelete={() => {
          // Both kinds ask first. Tags are app-global, so the tag dialog warns
          // about every case (#957); a selector's delete takes its persisted
          // matches with it (#1549).
          if (signal.kind === 'tag') setPendingTagDelete({ id: signal.id, name: signal.name })
          else {
            setPendingSelectorDelete({ id: signal.id, name: signal.name, matchCount: signal.count })
          }
        }}
        onShowMatches={() => showSelectorMatches(signal)}
        onDuplicate={() => duplicateSelector(signal)}
        onCopyPattern={() => void copyValue(signal.sub, 'pattern')}
        onExportMatches={() => void exportSignalMatches(signal)}
        onFilterCaptures={() => filterCapturesByTag(signal)}
        onDuplicateTag={() => void duplicateTag(signal)}
        onExportTag={() => void exportTag(signal, false)}
        onCopyTagMarkdown={() => void exportTag(signal, true)}
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
                prefill={selectorPrefill}
                onAdd={handleAddSelector}
                onFocusList={() =>
                  selectorSignals[0] && rowRefs.current.get(selectorSignals[0].id)?.focus()
                }
              />

              <div
                role={selectorSignals.length ? 'grid' : undefined}
                aria-label={selectorSignals.length ? 'Selectors' : undefined}
                className="flex max-h-80 flex-col gap-0.5 overflow-y-auto"
              >
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
                onAdd={handleAddTag}
                onFocusList={() => tagSignals[0] && rowRefs.current.get(tagSignals[0].id)?.focus()}
              />

              <div
                data-testid="signals-tag-list"
                role={tagSignals.length ? 'grid' : undefined}
                aria-label={tagSignals.length ? 'Tags' : undefined}
                className="flex max-h-[260px] flex-col gap-0.5 overflow-y-auto"
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

      {exportCaptureIds && (
        <ExportDialog
          caseId={caseId}
          caseName={caseData?.name ?? 'Case'}
          selectedCaptureIds={exportCaptureIds}
          onClose={() => setExportCaptureIds(null)}
        />
      )}

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

      {pendingSelectorDelete && (
        <DeleteSelectorDialog
          caseId={caseId}
          open
          onOpenChange={(next) => {
            if (!next) setPendingSelectorDelete(null)
          }}
          selector={pendingSelectorDelete}
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
