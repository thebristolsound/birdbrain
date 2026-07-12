import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { ExportOptions, ExportPreflight } from '@shared/types'
import { presets } from '@renderer/lib/motion'
import { useCompletionCelebration } from '@renderer/hooks/useCompletionCelebration'
import { Button, Input, Label } from '@renderer/components/ui'
import {
  preflightExport,
  subscribeExportProgress,
  useGenerateReport
} from '@renderer/lib/api/export'
import { ExportProgress } from '@renderer/components/export/ExportProgress'
import { ExportComplete } from '@renderer/components/export/ExportComplete'

interface ExportDialogProps {
  caseId: string
  caseName: string
  onClose: () => void
}

type Phase = 'form' | 'exporting' | 'complete'

export function ExportDialog({ caseId, caseName, onClose }: ExportDialogProps) {
  const format = 'zip' as const
  const [investigatorName, setInvestigatorName] = useState('')
  const [include, setInclude] = useState<ExportOptions['include']>({
    captures: true,
    screenshots: true,
    auditTrail: true,
    annotations: 'burned'
  })
  const [phase, setPhase] = useState<Phase>('form')
  const [progress, setProgress] = useState({ step: 'Preparing export…', percent: 0 })
  const [filePath, setFilePath] = useState('')
  const [exportError, setExportError] = useState('')
  const [preflight, setPreflight] = useState<ExportPreflight | null>(null)

  const { celebrate, celebrationProps } = useCompletionCelebration({ style: 'ripple' })
  const generateReport = useGenerateReport()

  useEffect(() => {
    let alive = true
    preflightExport(caseId)
      .then((summary) => {
        if (alive) setPreflight(summary)
      })
      .catch(() => {
        if (alive) setPreflight(null)
      })
    return () => {
      alive = false
    }
  }, [caseId])

  useEffect(() => {
    const unsubscribe = subscribeExportProgress((event) => {
      if (event.caseId === caseId) setProgress({ step: event.step, percent: event.percent })
    })
    return unsubscribe
  }, [caseId])

  const handleExport = async () => {
    const ext = 'zip'
    const safeName = caseName.replace(/[^a-zA-Z0-9-_]/g, '_')
    const outputPath = `${safeName}_evidence.${ext}`

    const options: ExportOptions = {
      format,
      include,
      investigatorName: investigatorName || 'Investigator',
      outputPath
    }

    setExportError('')
    setProgress({ step: 'Preparing export…', percent: 0 })
    setPhase('exporting')
    try {
      const result = await generateReport.mutateAsync({ caseId, options })
      if (result.canceled) {
        setPhase('form')
        return
      }
      setFilePath(result.filePath ?? '')
      setPhase('complete')
      celebrate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setExportError(`Error: ${message}`)
      setPhase('form')
    }
  }

  const toggleInclude = (key: keyof typeof include) => {
    setInclude((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      {...presets.overlay}
    >
      <motion.div
        className="neu-overlay w-[28rem] rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
        {...presets.modal}
      >
        <AnimatePresence mode="wait">
          {phase === 'complete' ? (
            <motion.div key="complete" {...presets.fadeIn}>
              <ExportComplete
                filePath={filePath}
                onClose={onClose}
                celebrationProps={celebrationProps}
              />
            </motion.div>
          ) : phase === 'exporting' ? (
            <motion.div key="exporting" {...presets.fadeIn}>
              <h2 className="mb-4 text-lg font-semibold text-text-primary">Exporting case</h2>
              <ExportProgress step={progress.step} percent={progress.percent} />
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Close
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="form" {...presets.fadeIn}>
              <h2 className="mb-4 text-lg font-semibold text-text-primary">Export Case</h2>

              {/* Include checkboxes */}
              <div className="mb-4">
                <Label className="mb-2">Include</Label>
                <div className="space-y-2">
                  {(
                    [
                      ['captures', 'Captures'],
                      ['screenshots', 'Screenshots'],
                      ['auditTrail', 'Audit Trail']
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={include[key]}
                        onChange={() => toggleInclude(key)}
                        className="rounded"
                      />
                      <span className="text-sm text-text-secondary">{label}</span>
                    </label>
                  ))}
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={include.annotations === 'burned'}
                      onChange={(e) =>
                        setInclude((prev) => ({
                          ...prev,
                          annotations: e.target.checked ? 'burned' : 'none'
                        }))
                      }
                      className="rounded"
                    />
                    <span className="text-sm text-text-secondary">
                      Burn annotations into screenshots
                    </span>
                  </label>
                </div>
              </div>

              {/* Investigator */}
              <div className="mb-4">
                <Label>Investigator Name</Label>
                <Input
                  type="text"
                  value={investigatorName}
                  onChange={(e) => setInvestigatorName(e.target.value)}
                  placeholder="Your name..."
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
                <Button size="sm" onClick={handleExport}>
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
