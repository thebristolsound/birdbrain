import { useState, useEffect } from 'react'
import { Plus, Trash2, Crosshair } from 'lucide-react'
import type { Selector } from '@shared/types'
import { useAppStore } from '@renderer/stores/appStore'

export function SelectorsOverview() {
  const activeCaseId = useAppStore((s) => s.activeCaseId)
  const addSelectorFilter = useAppStore((s) => s.addSelectorFilter)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const [selectors, setSelectors] = useState<Selector[]>([])
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [pattern, setPattern] = useState('')
  const [isRegex, setIsRegex] = useState(false)
  const [label, setLabel] = useState('')
  const [regexError, setRegexError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (activeCaseId) {
      loadSelectors(activeCaseId)
    }
  }, [activeCaseId])

  async function loadSelectors(caseId: string) {
    setLoading(true)
    try {
      const [result, counts] = await Promise.all([
        window.birdbrain.selectors.list(caseId),
        window.birdbrain.selectors.matchCounts(caseId)
      ])
      setSelectors(result)
      setMatchCounts(counts)
    } catch (err) {
      console.error('Failed to load selectors:', err)
    } finally {
      setLoading(false)
    }
  }

  async function toggleEnabled(sel: Selector) {
    await window.birdbrain.selectors.update({ id: sel.id, enabled: !sel.enabled })
    if (activeCaseId) await loadSelectors(activeCaseId)
  }

  async function handleDelete(id: string) {
    await window.birdbrain.selectors.delete(id)
    if (activeCaseId) await loadSelectors(activeCaseId)
  }

  function validateRegex(value: string): boolean {
    if (!isRegex) return true
    try {
      new RegExp(value)
      setRegexError(null)
      return true
    } catch (err) {
      setRegexError(err instanceof Error ? err.message : 'Invalid regex')
      return false
    }
  }

  async function handleCreate() {
    if (!activeCaseId || !pattern.trim()) return
    if (!validateRegex(pattern)) return

    setCreating(true)
    try {
      await window.birdbrain.selectors.create({
        caseId: activeCaseId,
        pattern: pattern.trim(),
        isRegex,
        label: label.trim() || undefined
      })
      setPattern('')
      setLabel('')
      setIsRegex(false)
      setShowForm(false)
      setRegexError(null)
      await loadSelectors(activeCaseId)
    } catch (err) {
      console.error('Failed to create selector:', err)
    } finally {
      setCreating(false)
    }
  }

  function handleSelectorClick(selectorId: string) {
    addSelectorFilter(selectorId)
    setActiveTab('captures')
  }

  if (loading) {
    return <div className="text-slate-500">Loading selectors...</div>
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-100">
          Selectors
          <span className="ml-2 text-lg font-normal text-slate-500">{selectors.length}</span>
        </h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          {showForm ? (
            'Cancel'
          ) : (
            <>
              <Plus className="h-4 w-4" />
              New Selector
            </>
          )}
        </button>
      </div>

      {showForm && (
        <div className="neu-card rounded-2xl p-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Pattern</label>
            <input
              type="text"
              value={pattern}
              onChange={(e) => {
                setPattern(e.target.value)
                if (isRegex) validateRegex(e.target.value)
              }}
              placeholder={isRegex ? 'e.g. \\b\\d{3}-\\d{3}-\\d{4}\\b' : 'e.g. John Doe'}
              className="w-full rounded-xl border border-white/[0.08] bg-black px-3 py-1.5 font-mono text-sm text-slate-200 placeholder-slate-600 focus:border-indigo-500/40 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
              }}
            />
            {regexError && (
              <p className="mt-1 text-xs text-red-400">{regexError}</p>
            )}
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-400">Label (optional)</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Phone numbers"
                className="w-full rounded-xl border border-white/[0.08] bg-black px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-indigo-500/40 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
                }}
              />
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-1.5 pb-1.5 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={isRegex}
                  onChange={(e) => {
                    setIsRegex(e.target.checked)
                    if (e.target.checked && pattern) validateRegex(pattern)
                    else setRegexError(null)
                  }}
                  className="rounded"
                />
                Regex
              </label>
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={!pattern.trim() || !!regexError || creating}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create Selector'}
          </button>
        </div>
      )}

      {selectors.length === 0 ? (
        <p className="text-sm text-slate-500">No selectors found. Create one to start matching captures.</p>
      ) : (
        <div className="neu-card rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02] text-left text-slate-400">
                <th className="px-4 py-2 font-medium">Pattern</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Label</th>
                <th className="px-4 py-2 font-medium">Matches</th>
                <th className="px-4 py-2 font-medium">Enabled</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {selectors.map((sel) => (
                <tr
                  key={sel.id}
                  className="cursor-pointer border-b border-white/[0.06] hover:bg-white/[0.03]"
                  onClick={() => handleSelectorClick(sel.id)}
                  title="Click to filter captures"
                >
                  <td className="px-4 py-2 font-mono text-slate-200">{sel.pattern}</td>
                  <td className="px-4 py-2">
                    {sel.isRegex ? (
                      <span className="rounded-md border border-indigo-500/20 bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-mono font-medium text-indigo-300">
                        regex
                      </span>
                    ) : (
                      <span className="text-slate-500">string</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-500">{sel.label || '\u2014'}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      (matchCounts[sel.id] || 0) > 0
                        ? 'bg-indigo-500/20 text-indigo-300'
                        : 'bg-slate-800 text-slate-500'
                    }`}>
                      {matchCounts[sel.id] || 0}
                    </span>
                  </td>
                  <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={sel.enabled}
                      onClick={() => toggleEnabled(sel)}
                      className={`relative inline-flex h-[18px] w-[34px] items-center rounded-full transition-colors ${
                        sel.enabled ? 'bg-indigo-600' : 'bg-slate-600'
                      }`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                        sel.enabled ? 'translate-x-[16px]' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </td>
                  <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleDelete(sel.id)}
                      className="rounded-lg p-1 text-slate-600 hover:bg-red-500/10 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
