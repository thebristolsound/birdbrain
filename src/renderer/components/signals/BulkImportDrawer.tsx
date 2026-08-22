import { useMemo, useState } from 'react'
import type { Selector } from '@shared/types'
import { useSelectorsMutations } from '@renderer/lib/api/selectors'
import { parseBulkPatterns } from '@renderer/components/signals/signalsModel'

interface BulkImportDrawerProps {
  caseId: string
  existingSelectors: Selector[]
  onClose: () => void
}

// The bulk-import drawer, inline above the add row rather than the modal it
// replaces.
//
// The live new/duplicate/blank counts are kept, and so are the modal's test
// ids. The design's drawer shows only a static "Duplicates are skipped" line,
// but the counts tell an operator pasting an IoC feed how much of it this case
// already holds — which is the question they are pasting to answer — and they
// cost no extra space. Recorded as a deliberate superset on #400.
export function BulkImportDrawer({ caseId, existingSelectors, onClose }: BulkImportDrawerProps) {
  const [text, setText] = useState('')
  const [isRegex, setIsRegex] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const { bulkCreate } = useSelectorsMutations(caseId)

  const parsed = useMemo(
    () => parseBulkPatterns(text, existingSelectors, isRegex),
    [text, existingSelectors, isRegex]
  )

  async function handleImport() {
    if (parsed.unique.length === 0) return
    setSubmitting(true)
    try {
      await bulkCreate.mutateAsync({
        caseId,
        // A pasted list is operator-authored — nothing here traces back to a
        // capture — so every item carries 'manual' (#395). Per item, not per
        // request: the bulk channel stamps each row on its own.
        selectors: parsed.unique.map((pattern) => ({ pattern, isRegex, origin: 'manual' as const }))
      })
      onClose()
    } catch (err) {
      console.error('Bulk import failed:', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      data-testid="bulk-add-modal"
      className="mb-2 rounded-md border border-dashed border-border-strong bg-surface p-3"
    >
      <textarea
        data-testid="bulk-add-textarea"
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="One pattern per line — wrap in /…/ for regex. Paste straight from a spreadsheet or IoC feed."
        className="box-border w-full resize-y rounded border border-border bg-canvas px-[10px] py-2 font-mono text-[11px] text-text-primary outline-none placeholder:text-text-faint"
      />

      <label className="mt-2 flex items-center gap-2 text-[10px] text-text-muted">
        <input
          data-testid="bulk-add-regex-toggle"
          type="checkbox"
          checked={isRegex}
          onChange={(event) => setIsRegex(event.target.checked)}
        />
        Treat all as regex
      </label>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span data-testid="bulk-add-preview" className="text-[10px] text-text-faint">
          <span data-testid="bulk-add-new-count" className="font-semibold text-accent">
            {parsed.unique.length}
          </span>{' '}
          new ·{' '}
          <span data-testid="bulk-add-dup-count">
            {parsed.withinPasteDuplicates + parsed.existingDuplicates}
          </span>{' '}
          duplicates skipped · <span data-testid="bulk-add-blank-count">{parsed.blankCount}</span>{' '}
          blank · matching runs immediately after import
        </span>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-7 rounded px-[11px] text-xs font-medium text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="bulk-add-submit"
            onClick={handleImport}
            disabled={parsed.unique.length === 0 || submitting}
            className="h-7 rounded bg-accent px-[11px] text-xs font-medium text-white disabled:opacity-50"
          >
            {submitting ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}
