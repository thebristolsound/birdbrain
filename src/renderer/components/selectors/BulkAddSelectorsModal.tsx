import { type ChangeEvent, useMemo, useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { motion } from 'motion/react'
import type { Selector } from '@shared/types'
import { useSelectorsMutations } from '@renderer/lib/queries'
import { presets } from '@renderer/lib/motion'

interface BulkAddSelectorsModalProps {
  caseId: string
  existingSelectors: Selector[]
  onClose: () => void
  onCreated: (created: Selector[]) => void
}

interface ParseResult {
  unique: string[]
  blankCount: number
  withinPasteDuplicates: number
  existingDuplicates: number
}

function parseInput(raw: string, existingSelectors: Selector[], isRegex: boolean): ParseResult {
  const lines = raw.split(/\r?\n/)
  let blankCount = 0
  const seen = new Set<string>()
  const unique: string[] = []
  let withinPasteDuplicates = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      blankCount++
      continue
    }
    // Regex patterns are case-sensitive; text patterns dedupe case-insensitively.
    const key = isRegex ? trimmed : trimmed.toLowerCase()
    if (seen.has(key)) {
      withinPasteDuplicates++
      continue
    }
    seen.add(key)
    unique.push(trimmed)
  }

  // Now check against existing selectors (match on pattern + isRegex).
  const existingKeys = new Set(
    existingSelectors
      .filter((s) => s.isRegex === isRegex)
      .map((s) => (isRegex ? s.pattern : s.pattern.toLowerCase()))
  )

  const newPatterns: string[] = []
  let existingDuplicates = 0
  for (const pattern of unique) {
    const key = isRegex ? pattern : pattern.toLowerCase()
    if (existingKeys.has(key)) {
      existingDuplicates++
    } else {
      newPatterns.push(pattern)
    }
  }

  return {
    unique: newPatterns,
    blankCount,
    withinPasteDuplicates,
    existingDuplicates
  }
}

export function BulkAddSelectorsModal({
  caseId,
  existingSelectors,
  onClose,
  onCreated
}: BulkAddSelectorsModalProps) {
  const [text, setText] = useState('')
  const [isRegex, setIsRegex] = useState(false)
  const [labelPrefix, setLabelPrefix] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { bulkCreate } = useSelectorsMutations(caseId)

  const parsed = useMemo(
    () => parseInput(text, existingSelectors, isRegex),
    [text, existingSelectors, isRegex]
  )

  async function handleFilePick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const contents = await file.text()
    setText((prev) => (prev.trim() ? `${prev}\n${contents}` : contents))
    // Reset the input so selecting the same file again still fires change.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit() {
    if (parsed.unique.length === 0) return
    setSubmitting(true)
    try {
      const selectors = parsed.unique.map((pattern, i) => ({
        pattern,
        isRegex,
        label: labelPrefix.trim() ? `${labelPrefix.trim()} ${i + 1}` : undefined
      }))
      const created = await bulkCreate.mutateAsync({ caseId, selectors })
      onCreated(created)
      onClose()
    } catch (err) {
      console.error('Bulk create failed:', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      {...presets.overlay}
    >
      <motion.div
        data-testid="bulk-add-modal"
        className="neu-card w-[32rem] max-w-[90vw] rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
        {...presets.modal}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Bulk Add Selectors</h2>
            <p className="text-xs text-text-muted">
              One pattern per line. Blank lines are ignored.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-faint hover:bg-elevated hover:text-text-primary"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <textarea
          data-testid="bulk-add-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder={'alice@example.com\nbob@example.com\n555-867-5309'}
          className="mb-3 w-full rounded-lg border border-border-strong bg-canvas px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-faint focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/25"
        />

        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-secondary hover:bg-elevated">
            <Upload className="h-3.5 w-3.5" />
            Upload .txt / .csv
            <input
              ref={fileInputRef}
              data-testid="bulk-add-file"
              type="file"
              accept=".txt,.csv"
              onChange={handleFilePick}
              className="hidden"
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              data-testid="bulk-add-regex-toggle"
              type="checkbox"
              checked={isRegex}
              onChange={(e) => setIsRegex(e.target.checked)}
            />
            Treat all as regex
          </label>

          <input
            data-testid="bulk-add-label-prefix"
            type="text"
            value={labelPrefix}
            onChange={(e) => setLabelPrefix(e.target.value)}
            placeholder="Label prefix (optional)"
            className="flex-1 min-w-[8rem] rounded-lg border border-border-strong bg-canvas px-3 py-1.5 text-xs text-text-primary placeholder:text-text-faint focus:border-accent/40 focus:outline-none"
          />
        </div>

        <div
          data-testid="bulk-add-preview"
          className="mb-4 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-secondary"
        >
          <span data-testid="bulk-add-new-count" className="font-semibold text-accent">
            {parsed.unique.length}
          </span>{' '}
          new,{' '}
          <span data-testid="bulk-add-dup-count">
            {parsed.withinPasteDuplicates + parsed.existingDuplicates}
          </span>{' '}
          duplicates skipped, <span data-testid="bulk-add-blank-count">{parsed.blankCount}</span>{' '}
          blank lines skipped
          {parsed.existingDuplicates > 0 && (
            <span className="ml-1 text-text-muted">
              ({parsed.existingDuplicates} already exist in this case)
            </span>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            data-testid="bulk-add-submit"
            onClick={handleSubmit}
            disabled={parsed.unique.length === 0 || submitting}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {submitting ? 'Creating...' : `Create All (${parsed.unique.length})`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
