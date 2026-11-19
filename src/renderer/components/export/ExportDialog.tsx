import { useEffect, useId, useRef, useState } from 'react'
import { motion, AnimatePresence, useIsPresent } from 'motion/react'
import { useQuery } from '@tanstack/react-query'
import { Archive, ChevronDown, CircleAlert, Clock } from 'lucide-react'
import type { CaseWaybackRef, ExportClass, ExportOptions } from '@shared/types'
import { safeFilename } from '@shared/safeFilename'
import { presets } from '@renderer/lib/motion'
import { cn } from '@renderer/lib/utils'
import {
  Button,
  Input,
  Label,
  trapTab,
  useModalEscape,
  useModalFocus
} from '@renderer/components/ui'
import { ExportProgress } from '@renderer/components/export/ExportProgress'
import { notifyExportWritten } from '@renderer/components/export/exportNotice'
import { useCaseExport } from '@renderer/components/export/useCaseExport'
import { exportPreflightQueryOptions, useExportMutations } from '@renderer/lib/api/export'
import { caseQueryOptions } from '@renderer/lib/api/cases'
import { EntityContextMenu } from '@renderer/components/contextmenu/EntityContextMenu'
import { waybackCasePinsQueryOptions, useWaybackMutations } from '@renderer/lib/api/wayback'
import { formatSnapshotDelta } from '@shared/wayback'

interface ExportDialogProps {
  caseId: string
  caseName: string
  // Selection scope (#398/#399): when present, only these Captures are exported; the title
  // gives their count and, for an Evidence Package, the scope row says the full Manifest chain
  // still ships. Absent means the whole Case.
  selectedCaptureIds?: string[]
  onClose: () => void
}

type Phase = 'form' | 'exporting'

// What the operator has selected: the export class plus the item set. The two
// travel together because the class decides which items exist at all.
export interface ExportSelection {
  exportClass: ExportClass
  include: ExportOptions['include']
}

export type ExportPresetId = 'full' | 'working'

// The two choices that write a zip (ADR-0010). `full` is an Evidence Package with every item;
// `working` is the Working Copy. Operator notes are the one item an Evidence Package may leave
// out and still be that choice, so they are its checkbox, not a choice of their own.
export const EXPORT_PRESETS: Record<
  ExportPresetId,
  { label: string; fileType: string; description: string; selection: ExportSelection }
> = {
  full: {
    label: 'Evidence Package',
    fileType: '.zip',
    description: 'For handing over. A recipient can check its integrity.',
    selection: {
      exportClass: 'evidence',
      include: {
        captures: true,
        screenshots: true,
        auditTrail: true,
        notes: true,
        annotations: 'burned'
      }
    }
  },
  working: {
    label: 'Working Copy',
    fileType: '.zip',
    description: 'For your own use. No Certification, and a recipient cannot check it.',
    selection: {
      exportClass: 'working-copy',
      include: {
        captures: true,
        screenshots: true,
        auditTrail: false,
        notes: true,
        annotations: 'burned'
      }
    }
  }
}

const PRESET_IDS = Object.keys(EXPORT_PRESETS) as ExportPresetId[]

// The checked choice is whichever one the current selection equals, falling back to 'custom'.
// An Evidence Package with or without Operator notes is the same choice.
export function detectPreset(selection: ExportSelection): ExportPresetId | 'custom' {
  const match = PRESET_IDS.find((id) => {
    const preset = EXPORT_PRESETS[id].selection
    return (
      preset.exportClass === selection.exportClass &&
      preset.include.captures === selection.include.captures &&
      preset.include.screenshots === selection.include.screenshots &&
      preset.include.auditTrail === selection.include.auditTrail &&
      (id === 'full' || preset.include.notes === selection.include.notes) &&
      preset.include.annotations === selection.include.annotations
    )
  })
  return match ?? 'custom'
}

const captureCount = (count: number): string => `${count} ${count === 1 ? 'Capture' : 'Captures'}`

const CHOICE_CLASS = 'rounded-lg border px-3 py-2'
const CHOICE_ON = 'border-accent bg-accent-subtle'
const CHOICE_OFF = 'border-border hover:bg-elevated'

function ChoiceText({
  label,
  fileType,
  description,
  descriptionId,
  dimmed = false
}: {
  label: string
  fileType: string
  description: string
  descriptionId?: string
  dimmed?: boolean
}) {
  return (
    <span className="min-w-0">
      <span className={cn('flex items-baseline gap-1.5', dimmed && 'opacity-60')}>
        <span className="text-sm font-medium text-text-primary">{label}</span>
        <span className="font-mono text-[10px] text-text-muted">{fileType}</span>
      </span>
      <span id={descriptionId} className="block text-[11px] leading-snug text-text-muted">
        {description}
      </span>
    </span>
  )
}

export function ExportDialog({ caseId, caseName, selectedCaptureIds, onClose }: ExportDialogProps) {
  const format = 'zip' as const
  const [selection, setSelection] = useState<ExportSelection>(EXPORT_PRESETS.full.selection)
  // The Case Archive is a third choice beside the two zips. It has no item set, so it is kept
  // apart from the selection.
  const [archiveChosen, setArchiveChosen] = useState(false)
  const [archiveRun, setArchiveRun] = useState(false)
  const [purposeOrAuthority, setPurposeOrAuthority] = useState('')
  const [showChecklist, setShowChecklist] = useState(false)
  const [progress, setProgress] = useState({ step: 'Preparing export…', percent: 0 })
  const [closing, setClosing] = useState(false)
  const archiveReasonId = useId()
  // Parents pass a plain setter, so a run that finishes after Close would otherwise
  // close whichever export window the operator has opened since.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const panelRef = useRef<HTMLDivElement>(null)
  // Mounted only while open, so presence stands in for `open`: it turns false
  // when the export menu's AnimatePresence starts the exit, which hands focus
  // back then rather than when the exit ends. Outside a presence it stays
  // true, and the hand-back happens on unmount instead.
  const present = useIsPresent()

  // Focus, Tab and Escape only. Escape does what Cancel and Close already do
  // in both phases: close.
  useModalFocus(present, panelRef)
  useModalEscape(present, onClose)
  // Land on the panel, not on its first control: that is the checked preset
  // radio, where one arrow key turns an evidence export into a Working Copy.
  // A passive effect, so the hook above has already recorded the opener.
  useEffect(() => {
    if (present) panelRef.current?.focus()
  }, [present])

  // A failed preflight leaves `data` undefined, which reads the same as "no
  // warning to show" — the same silent fallback the mount effect had, minus
  // the alive flag, since an unmounted query cannot write to state.
  const { data: preflight } = useQuery(exportPreflightQueryOptions(caseId, selectedCaptureIds))
  // For the demonstration-case notice (#405): a demo case must say so before
  // the operator exports it. A failed read shows no notice, same as preflight.
  const { data: caseData } = useQuery(caseQueryOptions(caseId))
  const isDemo = caseData?.isDemo ?? false
  // Pinned archive.org references that will ship in the report as corroboration
  // (#401). Scoped with the capture selection, since a pin on a capture the
  // operator did not select will not be in the package.
  const { data: casePins } = useQuery(waybackCasePinsQueryOptions(caseId))
  const pinnedRefs = (casePins ?? []).filter(
    (ref) => !selectedCaptureIds || selectedCaptureIds.includes(ref.captureId)
  )

  const { generate } = useExportMutations()
  // A Case Archive export is kept by its Case, outside this dialog, so it outlives a Close.
  const archive = useCaseExport(caseId)

  const workingCopy = selection.exportClass === 'working-copy'
  const activePreset = detectPreset(selection)
  const scopedCount = selectedCaptureIds?.length
  // A Case Archive holds the whole Case, so a selection cannot be exported as one.
  const archiveUnavailable = scopedCount !== undefined
  const subject = scopedCount !== undefined ? captureCount(scopedCount) : caseName
  const title = `Export ${subject}`

  // `archiveRun` holds the progress view from the press of Export until this dialog has acted on
  // how the run ended: the Case's own state clears a turn before that, which would show the form.
  const archiveExporting = archiveRun || (archiveChosen && archive.isExporting)
  // The phase is a reading of the mutation, not a machine kept alongside it. A
  // canceled save dialog resolves rather than throws, so it falls back to the
  // form. A written package closes the dialog, and `closing` holds the progress
  // view through the exit animation: the promise settles before the mutation's
  // own success render, which would otherwise flash the form on the way out.
  const phase: Phase = generate.isPending || archiveExporting || closing ? 'exporting' : 'form'
  const shownProgress = (archiveExporting && archive.progress) || progress
  const failure = archiveChosen ? archive.archiveError : (generate.error?.message ?? '')
  const exportError = failure ? `Error: ${failure}` : ''

  useEffect(() => {
    const unsubscribe = window.birdbrain.onExportProgress((event) => {
      if (event.caseId === caseId) setProgress({ step: event.step, percent: event.percent })
    })
    return unsubscribe
  }, [caseId])

  const handleArchiveExport = () => {
    setArchiveRun(true)
    // The completion notice and a failure are the Case's to raise and to keep. This only
    // decides what the dialog does next, if it is still open.
    void archive.startArchive().then((outcome) => {
      if (!mounted.current) return
      if (outcome !== 'written') {
        setArchiveRun(false)
        return
      }
      setProgress({ step: 'Case Archive saved', percent: 100 })
      setClosing(true)
      onClose()
    })
  }

  const handleExport = () => {
    if (archiveChosen) {
      handleArchiveExport()
      return
    }
    const safeName = safeFilename(caseName, 'case')
    // The default filename already tells the two classes apart on disk.
    const outputPath = workingCopy ? `${safeName}_working_copy.zip` : `${safeName}_evidence.zip`

    const options: ExportOptions = {
      format,
      exportClass: selection.exportClass,
      include: selection.include,
      ...(purposeOrAuthority.trim() ? { purposeOrAuthority: purposeOrAuthority.trim() } : {}),
      outputPath,
      ...(selectedCaptureIds ? { captureIds: selectedCaptureIds } : {})
    }

    setProgress({ step: 'Preparing export…', percent: 0 })
    // The promise, not mutate's per-call onSuccess: React Query drops that
    // callback once the dialog unmounts, and Close mid-run unmounts it. The
    // promise still settles, so the completion notice reaches an operator who
    // closed the dialog while the package was being written.
    generate
      .mutateAsync({ caseId, options })
      .then(({ canceled, filePath }) => {
        if (canceled || !filePath) return
        const kind = workingCopy ? 'Working Copy' : 'Evidence Package'
        notifyExportWritten('Export written', `${kind} · ${filePath}`, filePath)
        if (!mounted.current) return
        setClosing(true)
        onClose()
      })
      // A failure is already surfaced: inline below while the dialog is open,
      // and by the app-wide mutation error toast whether or not it is.
      .catch(() => undefined)
  }

  const applyPreset = (id: ExportPresetId) => {
    setArchiveChosen(false)
    setSelection(EXPORT_PRESETS[id].selection)
  }

  const toggleInclude = (key: 'captures' | 'screenshots' | 'auditTrail' | 'notes') => {
    setSelection((prev) => ({
      ...prev,
      include: { ...prev.include, [key]: !prev.include[key] }
    }))
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      {...presets.overlay}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        // One name for both phases: each phase swaps its own heading in.
        aria-label={title}
        tabIndex={-1}
        className="neu-overlay flex max-h-[85vh] w-[30rem] flex-col overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => trapTab(e, panelRef.current)}
        {...presets.modal}
      >
        <AnimatePresence mode="wait">
          {phase === 'exporting' ? (
            <motion.div key="exporting" className="p-6" {...presets.fadeIn}>
              <h2 className="mb-4 break-words text-sm font-semibold text-text-primary">
                {`Exporting ${subject}`}
              </h2>
              <ExportProgress step={shownProgress.step} percent={shownProgress.percent} />
              <p className="mb-4 text-xs text-text-muted" data-testid="export-close-note">
                The export continues if you close this.
              </p>
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Close
                </Button>
              </div>
            </motion.div>
          ) : (
            // The heading and the actions stay in view; only the form between them scrolls.
            <motion.div key="form" className="flex min-h-0 flex-col" {...presets.fadeIn}>
              <div className="shrink-0 border-b border-border px-6 pb-4 pt-6">
                <h2 className="break-words text-sm font-semibold text-text-primary">{title}</h2>
                {/* Scope row (#398/#399): what this export covers. A Working Copy ships no
                    Manifest, so the chain note is for an Evidence Package only. */}
                <p className="mt-1.5 text-xs text-text-muted" data-testid="export-scope-row">
                  {scopedCount !== undefined
                    ? `Selection from ${caseName}`
                    : `Whole Case${preflight ? ` · ${captureCount(preflight.captureCount)}` : ''}`}
                </p>
                {scopedCount !== undefined && !workingCopy && (
                  <p
                    className="mt-1 text-[11px] text-text-muted"
                    data-testid="export-scope-manifest-note"
                  >
                    The full Manifest chain is included.
                  </p>
                )}
              </div>

              <div
                data-testid="export-form-scroll"
                className="min-h-0 flex-1 overflow-y-auto px-6 pt-4"
              >
                {isDemo && (
                  <p
                    data-testid="export-demo-notice"
                    className="mb-4 flex gap-2 text-sm text-danger-fg"
                  >
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
                    <span>
                      Demonstration Case: fixture data, not evidence. The package says so.
                    </span>
                  </p>
                )}

                <div className="mb-4">
                  <Label className="mb-2">Export as</Label>
                  <div className="space-y-1.5" role="radiogroup" aria-label="Export as">
                    {PRESET_IDS.map((id) => {
                      const { label, fileType, description } = EXPORT_PRESETS[id]
                      const checked = !archiveChosen && activePreset === id
                      return (
                        <div
                          key={id}
                          className={cn(CHOICE_CLASS, checked ? CHOICE_ON : CHOICE_OFF)}
                        >
                          <label className="flex cursor-pointer items-start gap-2">
                            <input
                              type="radio"
                              name="export-preset"
                              checked={checked}
                              onChange={() => applyPreset(id)}
                              className="mt-0.5"
                            />
                            <ChoiceText
                              label={label}
                              fileType={fileType}
                              description={description}
                            />
                          </label>
                          {id === 'full' && checked && (
                            <label className="mt-2 flex cursor-pointer items-center gap-2 pl-5 text-xs text-text-secondary">
                              <input
                                type="checkbox"
                                checked={!selection.include.notes}
                                onChange={() => toggleInclude('notes')}
                                className="rounded"
                              />
                              Leave out Operator notes
                            </label>
                          )}
                        </div>
                      )
                    })}
                    <div className={cn(CHOICE_CLASS, archiveChosen ? CHOICE_ON : CHOICE_OFF)}>
                      <label
                        className={cn(
                          'flex items-start gap-2',
                          archiveUnavailable ? 'cursor-not-allowed' : 'cursor-pointer'
                        )}
                      >
                        <input
                          type="radio"
                          name="export-preset"
                          checked={archiveChosen}
                          disabled={archiveUnavailable}
                          aria-describedby={archiveUnavailable ? archiveReasonId : undefined}
                          onChange={() => setArchiveChosen(true)}
                          className="mt-0.5"
                        />
                        <ChoiceText
                          label="Case Archive"
                          fileType=".birdbrain"
                          description={
                            archiveUnavailable
                              ? 'For the whole Case only. Not available for a selection.'
                              : 'The whole Case, to import into another installation.'
                          }
                          descriptionId={archiveReasonId}
                          dimmed={archiveUnavailable}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                {/* A Case Archive has no contents to choose, no Certification to carry a purpose
                    and no Trusted Time statement, so none of the three shows for it. */}
                {!archiveChosen && (
                  <>
                    {/* Item checklist, collapsed until customised */}
                    <div className="mb-4">
                      <button
                        type="button"
                        onClick={() => setShowChecklist((v) => !v)}
                        aria-expanded={showChecklist || activePreset === 'custom'}
                        className="flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
                      >
                        <ChevronDown
                          className={`h-3 w-3 transition-transform ${
                            showChecklist || activePreset === 'custom' ? '' : '-rotate-90'
                          }`}
                          strokeWidth={2}
                        />
                        {activePreset === 'custom' ? 'Custom selection' : 'Customise contents'}
                      </button>
                      {(showChecklist || activePreset === 'custom') && (
                        <div className="mt-2 space-y-2 pl-1">
                          {!workingCopy && (
                            // Evidence Package invariants: always on, never
                            // deselectable — a package without them is not an
                            // Evidence Package but a Working Copy (#399). Page
                            // archives join them: the evidence zip ships every one
                            // whatever the toggle says (#844), and the pinned
                            // snapshot promise below needs the report's capture
                            // modules the toggle would drop (#887).
                            <>
                              {(
                                [
                                  ['manifest', 'Manifest (always the full chain)'],
                                  ['certification', 'Certification'],
                                  ['captures', 'Captures (page archives)']
                                ] as const
                              ).map(([key, label]) => (
                                <label key={key} className="flex items-center gap-2 opacity-80">
                                  <input
                                    type="checkbox"
                                    checked
                                    disabled
                                    aria-label={label}
                                    className="rounded"
                                  />
                                  <span className="text-sm text-text-secondary">
                                    {label}
                                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-text-faint">
                                      always included
                                    </span>
                                  </span>
                                </label>
                              ))}
                              <p
                                className="text-[11px] text-text-muted"
                                data-testid="export-captures-invariant-note"
                              >
                                Always in an Evidence Package
                              </p>
                            </>
                          )}
                          {(
                            [
                              // The Working Copy zip honours this toggle; the
                              // evidence class renders it always-on above.
                              ...(workingCopy
                                ? [['captures', 'Captures (page archives)'] as const]
                                : []),
                              ['screenshots', 'Screenshots'],
                              ['notes', 'Operator notes'],
                              // No verification materials exist in a Working Copy,
                              // so the row only renders for evidence exports.
                              ...(workingCopy
                                ? []
                                : [['auditTrail', 'Integrity verification'] as const])
                            ] as ReadonlyArray<
                              readonly ['captures' | 'screenshots' | 'notes' | 'auditTrail', string]
                            >
                          ).map(([key, label]) => (
                            <label key={key} className="flex cursor-pointer items-center gap-2">
                              <input
                                type="checkbox"
                                checked={selection.include[key]}
                                onChange={() => toggleInclude(key)}
                                className="rounded"
                              />
                              <span className="text-sm text-text-secondary">{label}</span>
                            </label>
                          ))}
                          <label className="flex cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selection.include.annotations === 'burned'}
                              onChange={(e) =>
                                setSelection((prev) => ({
                                  ...prev,
                                  include: {
                                    ...prev.include,
                                    annotations: e.target.checked ? 'burned' : 'none'
                                  }
                                }))
                              }
                              className="rounded"
                            />
                            <span className="text-sm text-text-secondary">
                              Burn annotations into screenshots
                            </span>
                          </label>
                        </div>
                      )}
                    </div>

                    {/* Pinned Wayback snapshots: what the report will carry as
                        corroboration references, stated before the operator exports
                        rather than discovered in the document afterwards. Evidence
                        Package only — a Working Copy is built by buildWorkingCopyZip
                        and has no report to carry them, so promising one here would
                        describe a document the operator is not about to get (#399). */}
                    {!workingCopy && pinnedRefs.length > 0 && (
                      <div className="mb-4" data-testid="export-pinned-wayback">
                        <Label className="mb-2">Pinned Wayback snapshots</Label>
                        <div className="flex flex-col overflow-hidden rounded-md border border-border [&>div:last-child>div]:border-b-0">
                          {pinnedRefs.map((ref) => (
                            <PinnedSnapshot key={ref.id} snapshot={ref} />
                          ))}
                        </div>
                        <p className="mt-1.5 text-[11px] text-text-muted">
                          Listed as archive.org references. Snapshots are not packaged.
                        </p>
                      </div>
                    )}

                    {/* Purpose or authority — rendered on the Certification for an
                        Evidence Package and recorded in the Working Copy marker. */}
                    <div className="mb-4">
                      <Label>Purpose or authority</Label>
                      <Input
                        type="text"
                        value={purposeOrAuthority}
                        onChange={(e) => setPurposeOrAuthority(e.target.value)}
                        placeholder="e.g. Disclosure under CPS request 2026/114"
                      />
                    </div>

                    {preflight && preflight.unstampedCaptureCount > 0 && (
                      <p
                        data-testid="export-trusted-time-notice"
                        className="mb-4 flex gap-2 text-sm text-warning-fg"
                      >
                        <Clock className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
                        <span>
                          {captureCount(preflight.unstampedCaptureCount)} will export without RFC
                          3161 trusted time ({preflight.pendingCaptureCount} pending,{' '}
                          {preflight.noneCaptureCount} none).
                        </span>
                      </p>
                    )}
                  </>
                )}
              </div>

              <div className="shrink-0 border-t border-border px-6 py-4">
                {/* Beside the button that retries it, so a failure is never scrolled out of view. */}
                {exportError && (
                  <p data-testid="export-error" className="mb-3 flex gap-2 text-sm text-danger-fg">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
                    <span className="min-w-0 break-words">{exportError}</span>
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-[11px] text-text-muted">
                    The export continues if you close this.
                  </span>
                  <Button variant="ghost" size="sm" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button size="sm" data-testid="export-submit" onClick={handleExport}>
                    {exportError ? 'Try again' : 'Export'}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}

function PinnedSnapshot({ snapshot }: { snapshot: CaseWaybackRef }) {
  const { unpin } = useWaybackMutations(snapshot.captureId)
  return (
    <EntityContextMenu
      target={{
        kind: 'snapshot',
        label: snapshot.snapshotTimestamp,
        exportRow: true,
        actions: { unpin: () => unpin.mutate(snapshot.id) }
      }}
    >
      <div
        data-testid="export-pinned-wayback-row"
        className="flex items-center gap-2 border-b border-border px-3 py-2"
      >
        <Archive className="h-3 w-3 shrink-0 text-text-muted" />
        <span className="shrink-0 text-xs tabular-nums text-text-secondary">
          {new Date(snapshot.snapshotTimestamp).toISOString().replace('T', ' ').slice(0, 16)} UTC
        </span>
        <span className="ml-auto min-w-0 truncate text-[11px] text-text-faint">
          {formatSnapshotDelta(snapshot.snapshotTimestamp, snapshot.captureTimestamp) ?? ''}
        </span>
      </div>
    </EntityContextMenu>
  )
}
