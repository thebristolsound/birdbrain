import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useIsPresent } from 'motion/react'
import { useQuery } from '@tanstack/react-query'
import { Archive, ChevronDown, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { CaseWaybackRef, ExportClass, ExportOptions } from '@shared/types'
import { safeFilename } from '@shared/safeFilename'
import { presets } from '@renderer/lib/motion'
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
import { exportPreflightQueryOptions, useExportMutations } from '@renderer/lib/api/export'
import { caseQueryOptions } from '@renderer/lib/api/cases'
import { EntityContextMenu } from '@renderer/components/contextmenu/EntityContextMenu'
import { waybackCasePinsQueryOptions, useWaybackMutations } from '@renderer/lib/api/wayback'
import { formatSnapshotDelta } from '@shared/wayback'

interface ExportDialogProps {
  caseId: string
  caseName: string
  // Selection scope (#398/#399): when present, only these captures are
  // exported; the dialog's Scope row states it and, for an evidence package,
  // the note beneath says the full Manifest chain still ships. Absent means
  // whole-case.
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

export type ExportPresetId = 'full' | 'working' | 'court'

// The three presets (#399, ADR-0010). `full` is every item; `court` is
// everything except operator notes; `working` is the non-evidentiary class.
// Notes are the only content item that separates full from court — extracted
// text and selector hits deliberately never became package content (R4).
export const EXPORT_PRESETS: Record<
  ExportPresetId,
  { label: string; description: string; selection: ExportSelection }
> = {
  full: {
    label: 'Full evidence bundle',
    description: 'Verifiable package: Manifest, Certification, captures, screenshots and notes',
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
    label: 'Working copy',
    description: 'Non-evidentiary: captures, screenshots and notes — no Certification, no Manifest',
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
  },
  court: {
    label: 'Court exhibit',
    description: 'Evidence package with everything except operator notes',
    selection: {
      exportClass: 'evidence',
      include: {
        captures: true,
        screenshots: true,
        auditTrail: true,
        notes: false,
        annotations: 'burned'
      }
    }
  }
}

const PRESET_IDS = Object.keys(EXPORT_PRESETS) as ExportPresetId[]

// Set-equality auto-detection: the active preset is whichever one the current
// selection exactly equals, falling back to 'custom' (mock 15065-15070).
export function detectPreset(selection: ExportSelection): ExportPresetId | 'custom' {
  const match = PRESET_IDS.find((id) => {
    const preset = EXPORT_PRESETS[id].selection
    return (
      preset.exportClass === selection.exportClass &&
      preset.include.captures === selection.include.captures &&
      preset.include.screenshots === selection.include.screenshots &&
      preset.include.auditTrail === selection.include.auditTrail &&
      preset.include.notes === selection.include.notes &&
      preset.include.annotations === selection.include.annotations
    )
  })
  return match ?? 'custom'
}

export function ExportDialog({ caseId, caseName, selectedCaptureIds, onClose }: ExportDialogProps) {
  const format = 'zip' as const
  const [selection, setSelection] = useState<ExportSelection>(EXPORT_PRESETS.full.selection)
  const [purposeOrAuthority, setPurposeOrAuthority] = useState('')
  const [showChecklist, setShowChecklist] = useState(false)
  const [progress, setProgress] = useState({ step: 'Preparing export…', percent: 0 })
  const [closing, setClosing] = useState(false)
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

  const workingCopy = selection.exportClass === 'working-copy'
  const activePreset = detectPreset(selection)
  const scopedCount = selectedCaptureIds?.length

  // The phase is a reading of the mutation, not a machine kept alongside it. A
  // canceled save dialog resolves rather than throws, so it falls back to the
  // form. A written package closes the dialog, and `closing` holds the progress
  // view through the exit animation: the promise settles before the mutation's
  // own success render, which would otherwise flash the form on the way out.
  const phase: Phase = generate.isPending || closing ? 'exporting' : 'form'
  const exportError = generate.error ? `Error: ${generate.error.message}` : ''

  useEffect(() => {
    const unsubscribe = window.birdbrain.onExportProgress((event) => {
      if (event.caseId === caseId) setProgress({ step: event.step, percent: event.percent })
    })
    return unsubscribe
  }, [caseId])

  const handleExport = () => {
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
        const kind = workingCopy ? 'Working copy' : 'Evidence package'
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
        aria-label="Export case"
        tabIndex={-1}
        className="neu-overlay max-h-[85vh] w-[30rem] overflow-y-auto rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => trapTab(e, panelRef.current)}
        {...presets.modal}
      >
        <AnimatePresence mode="wait">
          {phase === 'exporting' ? (
            <motion.div key="exporting" {...presets.fadeIn}>
              <h2 className="mb-4 text-lg font-semibold text-text-primary">Exporting case</h2>
              <ExportProgress step={progress.step} percent={progress.percent} />
              <p className="mb-4 text-xs text-text-muted" data-testid="export-close-note">
                Closing this window does not stop the export. A notice with the file&apos;s location
                appears when it has been written.
              </p>
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Close
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="form" {...presets.fadeIn}>
              <h2 className="mb-4 text-lg font-semibold text-text-primary">Export case</h2>

              {isDemo && (
                <div
                  data-testid="export-demo-notice"
                  className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
                >
                  Demonstration case — its captures are fixture data seeded by Birdbrain, not
                  collected evidence. The exported package states this.
                </div>
              )}

              {/* Scope row (#398/#399): what this export covers. A Working Copy ships
                  no Manifest, so the chain note is for evidence packages only. */}
              <div className="mb-4">
                <Label className="mb-1">Scope</Label>
                <div className="text-sm text-text-secondary" data-testid="export-scope-row">
                  {scopedCount !== undefined
                    ? `${scopedCount} selected capture${scopedCount === 1 ? '' : 's'}`
                    : `Whole case${preflight ? ` — ${preflight.captureCount} capture${preflight.captureCount === 1 ? '' : 's'}` : ''}`}
                </div>
                {scopedCount !== undefined && !workingCopy && (
                  <div
                    className="mt-1 text-[11px] text-text-muted"
                    data-testid="export-scope-manifest-note"
                  >
                    The full Manifest chain is included.
                  </div>
                )}
              </div>

              {/* Presets */}
              <div className="mb-4">
                <Label className="mb-2">Preset</Label>
                <div className="space-y-1.5" role="radiogroup" aria-label="Export preset">
                  {PRESET_IDS.map((id) => (
                    <label
                      key={id}
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${
                        activePreset === id
                          ? 'border-accent bg-accent-subtle'
                          : 'border-border hover:bg-elevated'
                      }`}
                    >
                      <input
                        type="radio"
                        name="export-preset"
                        checked={activePreset === id}
                        onChange={() => applyPreset(id)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-text-primary">
                          {EXPORT_PRESETS[id].label}
                        </span>
                        <span className="block text-[11px] leading-snug text-text-muted">
                          {EXPORT_PRESETS[id].description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

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
                      // Evidence Package but a Working Copy (#399).
                      <>
                        {(
                          [
                            ['manifest', 'Manifest — full case chain, never a slice'],
                            ['certification', 'Certification']
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
                      </>
                    )}
                    {(
                      [
                        ['captures', 'Captures (page archives)'],
                        ['screenshots', 'Screenshots'],
                        ['notes', 'Operator notes'],
                        // No verification materials exist in a Working Copy,
                        // so the row only renders for evidence exports.
                        ...(workingCopy ? [] : [['auditTrail', 'Integrity verification'] as const])
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

              {/* Class statement: custody summary for an Evidence Package, a
                  non-evidentiary notice for a Working Copy (ruled divergence
                  from the mock's unconditional custody card, recorded on #708). */}
              {workingCopy ? (
                <div
                  data-testid="export-working-copy-notice"
                  className="mb-4 flex gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
                >
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
                  <span>
                    Non-evidentiary working copy: no Certification, no signed Manifest, no
                    verification materials. The export is recorded on the case audit trail and
                    marked as a working copy; the standalone verifier reports it as not a verifiable
                    object.
                  </span>
                </div>
              ) : (
                <div
                  data-testid="export-custody-card"
                  className="mb-4 flex gap-2 rounded border border-border bg-elevated px-3 py-2 text-sm text-text-secondary"
                >
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
                  <span>
                    Evidence package: ships the full signed Manifest chain and the Certification,
                    and appends a signed export entry to the case audit trail. The Certification is
                    signed by the Operator.
                  </span>
                </div>
              )}

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
                    Included in the report as archive.org references, labelled corroboration only.
                    The snapshots themselves are not downloaded or packaged.
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
                <div className="mb-4 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  {preflight.unstampedCaptureCount} capture
                  {preflight.unstampedCaptureCount === 1 ? '' : 's'} will export without RFC 3161
                  trusted time ({preflight.pendingCaptureCount} pending,{' '}
                  {preflight.noneCaptureCount} none). Export will continue.
                </div>
              )}

              {exportError && (
                <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {exportError}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Cancel
                </Button>
                <Button size="sm" data-testid="export-submit" onClick={handleExport}>
                  {exportError ? 'Try again' : 'Export'}
                </Button>
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
