import { useState } from 'react'
import { motion } from 'motion/react'
import type { ExportOptions } from '@shared/types'
import { presets } from '@renderer/lib/motion'

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
  const [progress, setProgress] = useState('')

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
    setProgress('Generating report...')
    try {
      await window.birdbrain.export.generateReport(caseId, options)
      setProgress(`Report saved as ${outputPath}`)
    } catch (err) {
      setProgress(`Error: ${err}`)
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

        {/* Progress */}
        {progress && (
          <div className="mb-4 rounded bg-elevated px-3 py-2 text-sm text-text-muted">
            {progress}
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
