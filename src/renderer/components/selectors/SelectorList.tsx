import { useState } from 'react'
import { useSelectors } from '@renderer/hooks/useSelectors'
import { SelectorItem } from './SelectorItem'

interface SelectorListProps {
  caseId: string
}

export function SelectorList({ caseId }: SelectorListProps) {
  const { selectors, create, update, deleteSelector } = useSelectors(caseId)
  const [adding, setAdding] = useState(false)
  const [pattern, setPattern] = useState('')
  const [isRegex, setIsRegex] = useState(false)
  const [label, setLabel] = useState('')
  const [regexError, setRegexError] = useState('')

  const validatePattern = (value: string, regex: boolean) => {
    if (!regex) {
      setRegexError('')
      return
    }
    try {
      new RegExp(value)
      setRegexError('')
    } catch (e) {
      setRegexError((e as Error).message)
    }
  }

  const handlePatternChange = (value: string) => {
    setPattern(value)
    validatePattern(value, isRegex)
  }

  const handleRegexToggle = (checked: boolean) => {
    setIsRegex(checked)
    validatePattern(pattern, checked)
  }

  const handleSave = async () => {
    if (!pattern.trim() || regexError) return
    await create({ caseId, pattern: pattern.trim(), isRegex, label: label.trim() || undefined })
    setPattern('')
    setIsRegex(false)
    setLabel('')
    setAdding(false)
  }

  const handleCancel = () => {
    setPattern('')
    setIsRegex(false)
    setLabel('')
    setRegexError('')
    setAdding(false)
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-200">
          Selectors
          {selectors.length > 0 && (
            <span className="ml-2 text-sm font-normal text-neutral-500">{selectors.length}</span>
          )}
        </h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded bg-neutral-800 px-3 py-1 text-sm text-neutral-300 hover:bg-neutral-700"
          >
            + Add
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-3 space-y-2 rounded border border-neutral-700 bg-neutral-900 p-3">
          <input
            type="text"
            value={pattern}
            onChange={(e) => handlePatternChange(e.target.value)}
            placeholder="Pattern to match..."
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 font-mono text-sm text-neutral-100 outline-none focus:border-amber-600"
            autoFocus
          />
          {regexError && (
            <p className="text-xs text-red-400">{regexError}</p>
          )}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-sm text-neutral-400 cursor-pointer">
              <input
                type="checkbox"
                checked={isRegex}
                onChange={(e) => handleRegexToggle(e.target.checked)}
                className="rounded"
              />
              Regex
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (optional)"
              className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-amber-600"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!pattern.trim() || !!regexError}
              className="rounded bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={handleCancel}
              className="rounded bg-neutral-700 px-3 py-1 text-sm text-neutral-300 hover:bg-neutral-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {selectors.length === 0 && !adding ? (
        <p className="text-sm text-neutral-500">No selectors yet. Add patterns to auto-detect content.</p>
      ) : (
        <div className="space-y-2">
          {selectors.map((sel) => (
            <SelectorItem
              key={sel.id}
              selector={sel}
              onUpdate={async (params) => { await update(params) }}
              onDelete={async (id) => { await deleteSelector(id) }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
