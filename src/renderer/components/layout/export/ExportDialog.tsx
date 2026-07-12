import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { ExportOptions } from '@shared/types'
import { presets } from '@renderer/lib/motion'
import { useTheater } from '@renderer/hooks/useTheater'
import { useCompletionCelebration } from '@renderer/hooks/useCompletionCelebration'
import { Button, Input, Label } from '@renderer/components/ui'
import { useGenerateReport } from '@renderer/lib/api/export'

interface ExportDialogProps {
  caseId: string
  caseName: string
  onClose: () => void
}

export function ExportDialog({ caseId, caseName, onClose }: ExportDialogProps) {
  const format = 'html' as const
  const [investigatorName, setInvestigatorName] = useState('')
  const [include, setInclude] = useState<ExportOptions['include']>({
    captures: true,
    screenshots: true,
    auditTrail: true,
    annotations: 'burned'
  })
  const [exporting, setExporting] = useState(false)
  const [exportComplete, setExportComplete] = useState(false)
  const [exportError, setExportError] = useState('')

  const theater = useTheater({
    stages: ['Preparing report...', 'Packaging captures...', 'Writing file...'],
    minDuration: 800,
    done: exportComplete
  })

  const { celebrate, celebrationProps } = useCompletionCelebration({ style: 'ripple' })
  const generateReport = useGenerateReport()

  const handleExport = async () => {
    const ext = 'html'
    const safeName = caseName.replace(/[^a-zA-Z0-9-_]/g, '_')
    const outputPath = `${safeName}_report.${ext}`

    const options: ExportOptions = {
      format,
      include,
      investigatorName: investigatorName || 'Investigator',
      outputPath
    }

    setExporting(true)
    setExportComplete(false)
    setExportError('')
    try {
      await generateReport.mutateAsync({ caseId, options })
      setExportComplete(true)
      celebrate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setExportError(`Error: ${message}`)
    } finally {
      setExporting(false)
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
        className="neu-card w-[28rem] rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
        {...presets.modal}
      >
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
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={include[key]}
                  onChange={() => toggleInclude(key)}
                  className="rounded"
                />
                <span className="text-sm text-text-secondary">{label}</span>
              </label>
            ))}
            <label className="flex items-center gap-2 cursor-pointer">
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
              <span className="text-sm text-text-secondary">Burn annotations into screenshots</span>
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

        {/* Progress / Status */}
        {(exporting || exportComplete) && (
          <AnimatePresence mode="wait">
            <motion.div
              key={theater.stage}
              {...presets.fadeIn}
              className="mb-4 rounded bg-elevated px-3 py-2 text-sm text-center"
            >
              {theater.isComplete ? (
                <motion.span {...celebrationProps} className="text-emerald-500 font-medium">
                  Export complete!
                </motion.span>
              ) : (
                <span className="text-text-muted">{theater.stage}</span>
              )}
            </motion.div>
          </AnimatePresence>
        )}

        {exportError && (
          <div className="mb-4 rounded bg-elevated px-3 py-2 text-sm text-red-400">
            {exportError}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {exporting ? 'Close' : 'Cancel'}
          </Button>
          <Button size="sm" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting...' : 'Export'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
