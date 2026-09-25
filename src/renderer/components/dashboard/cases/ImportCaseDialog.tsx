import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { ShieldCheck, ShieldAlert } from 'lucide-react'
import type { ArchiveInspectReport } from '@shared/types'
import { presets } from '@renderer/lib/motion'
import { useCasesMutations } from '@renderer/lib/queries'
import { Button, trapTab, useModalEscape, useModalFocus } from '@renderer/components/ui'
import { ExportProgress } from '@renderer/components/export/ExportProgress'

interface ImportCaseDialogProps {
  report: ArchiveInspectReport
  onClose: () => void
}

export function ImportCaseDialog({ report, onClose }: ImportCaseDialogProps) {
  const [overrideTamper, setOverrideTamper] = useState(false)
  const [importError, setImportError] = useState('')
  const [importProgress, setImportProgress] = useState({ step: 'Preparing import…', percent: 0 })
  const { importArchive } = useCasesMutations()
  const navigate = useNavigate()

  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  const { verification } = report
  const canImport = verification.overallValid || overrideTamper

  // Mounted only while open, so the modal hooks run with `open` fixed true and
  // hand focus back when the dialog unmounts. Escape follows the overlay
  // click: it cannot abandon an import that is already running.
  useModalFocus(true, panelRef)
  useModalEscape(true, () => {
    if (!importArchive.isPending) onClose()
  })

  // Lands on Cancel rather than the first control, which on a failing archive
  // is the tamper override: one reflexive Space must not tick it.
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  // Always-on subscription (matching CaseSubhead) so a progress event fired
  // immediately after mutateAsync can't be missed. Import events carry no
  // caseId; the dialog only exists while its own import runs.
  useEffect(() => {
    const unsubscribe = window.birdbrain.onArchiveProgress((event) => {
      if (!event.caseId) setImportProgress({ step: event.step, percent: event.percent })
    })
    return unsubscribe
  }, [])

  const handleImport = async () => {
    setImportError('')
    setImportProgress({ step: 'Preparing import…', percent: 0 })
    try {
      const { newCaseId } = await importArchive.mutateAsync({
        archivePath: report.archivePath,
        overrideTamper
      })
      navigate({ to: '/cases/$caseId', params: { caseId: newCaseId } })
      onClose()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={importArchive.isPending ? undefined : onClose}
      {...presets.overlay}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="neu-overlay w-[30rem] rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => trapTab(e, panelRef.current)}
        {...presets.modal}
      >
        <h2 id={titleId} className="mb-4 text-lg font-semibold text-text-primary">
          Import Case Archive
        </h2>

        <div className="mb-4">
          <p className="font-display text-base font-bold text-text-primary">{report.caseName}</p>
          {report.caseDescription && (
            <p className="mt-1 text-sm text-text-secondary">{report.caseDescription}</p>
          )}
          <p className="mt-2 text-xs text-text-muted">
            Exported {new Date(report.exportedAt).toLocaleString()} by{' '}
            {report.sourceOperatorName || 'Unknown operator'} (installation{' '}
            {report.sourceInstallationId})
          </p>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2 text-center">
          <CountCell label="Captures" value={report.counts.captures} />
          <CountCell label="Notes" value={report.counts.notes} />
          <CountCell label="Tags" value={report.counts.tags} />
          <CountCell label="Selectors" value={report.counts.selectors} />
          <CountCell label="Annotations" value={report.counts.annotations} />
          <CountCell label="Extracted data" value={report.counts.extractedData} />
          <CountCell label="Archive refs" value={report.counts.archiveRefs} />
        </div>

        {verification.overallValid ? (
          <div className="mb-4 flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
            <ShieldCheck className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            Archive verified
          </div>
        ) : (
          <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <ShieldAlert className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              Verification failed
            </div>
            <ul className="mb-3 list-inside list-disc space-y-1 text-xs">
              {!verification.chainValid && (
                <li>
                  Custody chain invalid
                  {verification.chainReason ? `: ${verification.chainReason}` : ''}
                </li>
              )}
              {verification.artifactFailureCount > 0 && (
                <li>
                  {verification.artifactFailureCount} artifact
                  {verification.artifactFailureCount === 1 ? '' : 's'} failed hash verification
                </li>
              )}
              {verification.captureHashFailureCount > 0 && (
                <li>
                  {verification.captureHashFailureCount} capture
                  {verification.captureHashFailureCount === 1 ? '' : 's'} failed hash verification
                </li>
              )}
            </ul>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={overrideTamper}
                onChange={(e) => setOverrideTamper(e.target.checked)}
                className="mt-0.5 rounded"
              />
              <span className="text-xs">
                Import anyway — the failed verification will be permanently recorded
              </span>
            </label>
          </div>
        )}

        {importArchive.isPending && (
          <ExportProgress step={importProgress.step} percent={importProgress.percent} />
        )}

        {importError && (
          <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {importError}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            ref={cancelRef}
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={importArchive.isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleImport}
            disabled={!canImport || importArchive.isPending}
          >
            {importArchive.isPending ? 'Importing…' : 'Import case'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function CountCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-elevated px-2 py-2">
      <p className="font-mono text-base font-semibold text-text-primary">{value}</p>
      <p className="text-[10.5px] text-text-muted">{label}</p>
    </div>
  )
}
