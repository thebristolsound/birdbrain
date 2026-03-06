import { useState } from 'react'
import type { ExportOptions } from '@shared/types'

interface ExportDialogProps {
  caseId: string
  caseName: string
  onClose: () => void
}

export function ExportDialog({ caseId, caseName, onClose }: ExportDialogProps) {
  const [format, setFormat] = useState<'html' | 'pdf'>('html')
  const [investigatorName, setInvestigatorName] = useState('')
  const [include, setInclude] = useState({
    captures: true,
    entities: true,
    aiAnalysis: true,
    screenshots: true,
    auditTrail: true
  })
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState('')

  const handleExport = async () => {
    // Use a default path for now (proper save dialog would need electron dialog IPC)
    const ext = format === 'pdf' ? 'pdf' : 'html'
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[28rem] rounded-lg border border-neutral-700 bg-neutral-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-neutral-100">Export Case</h2>

        {/* Format */}
        <div className="mb-4">
          <label className="mb-1 block text-sm text-neutral-400">Format</label>
          <div className="flex gap-2">
            <button
              onClick={() => setFormat('html')}
              className={`rounded px-4 py-2 text-sm ${format === 'html' ? 'bg-amber-600 text-white' : 'bg-neutral-800 text-neutral-400'}`}
            >
              HTML
            </button>
            <button
              onClick={() => setFormat('pdf')}
              className={`rounded px-4 py-2 text-sm ${format === 'pdf' ? 'bg-amber-600 text-white' : 'bg-neutral-800 text-neutral-400'}`}
            >
              PDF
            </button>
          </div>
        </div>

        {/* Include checkboxes */}
        <div className="mb-4">
          <label className="mb-2 block text-sm text-neutral-400">Include</label>
          <div className="space-y-2">
            {([
              ['captures', 'Captures'],
              ['entities', 'Entities'],
              ['aiAnalysis', 'AI Analysis'],
              ['screenshots', 'Screenshots'],
              ['auditTrail', 'Audit Trail']
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={include[key]}
                  onChange={() => toggleInclude(key)}
                  className="rounded"
                />
                <span className="text-sm text-neutral-300">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Investigator */}
        <div className="mb-4">
          <label className="mb-1 block text-sm text-neutral-400">Investigator Name</label>
          <input
            type="text"
            value={investigatorName}
            onChange={(e) => setInvestigatorName(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-amber-600"
            placeholder="Your name..."
          />
        </div>

        {/* Progress */}
        {progress && (
          <div className="mb-4 rounded bg-neutral-800 px-3 py-2 text-sm text-neutral-400">
            {progress}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200"
          >
            {exporting ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="rounded bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  )
}
