import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { ExportOptions } from '@shared/types'
import { presets } from '@renderer/lib/motion'
import { useTheater } from '@renderer/hooks/useTheater'
import { useCompletionCelebration } from '@renderer/hooks/useCompletionCelebration'

interface ExportDialogProps {
  caseId: string
  caseName: string
  onClose: () => void
}

export function ExportDialog({ caseId, caseName, onClose }: ExportDialogProps) {
  const format = 'html' as const
  const [investigatorName, setInvestigatorName] = useState('')
  const [include, setInclude] = useState({
    captures: true,
    screenshots: true,
    auditTrail: true
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
      await window.birdbrain.export.generateReport(caseId, options)
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
          <label className="mb-2 block text-sm text-text-muted">Include</label>
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
          </div>
        </div>

        {/* Investigator */}
        <div className="mb-4">
          <label className="mb-1 block text-sm text-text-muted">Investigator Name</label>
          <input
            type="text"
            value={investigatorName}
            onChange={(e) => setInvestigatorName(e.target.value)}
            className="w-full rounded border border-border-strong bg-elevated px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
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
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:text-text-primary"
          >
            {exporting ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
