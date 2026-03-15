import { useState, useEffect } from 'react'
import type { Selector, Case } from '@shared/types'

interface SelectorWithCase extends Selector {
  caseName: string
}

export function SelectorsOverview() {
  const [allSelectors, setAllSelectors] = useState<SelectorWithCase[]>([])
  const [cases, setCases] = useState<Case[]>([])
  const [filterCaseId, setFilterCaseId] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const caseList = await window.birdbrain.cases.list()
      setCases(caseList)

      const all: SelectorWithCase[] = []
      for (const c of caseList) {
        const selectors = await window.birdbrain.selectors.list(c.id)
        for (const s of selectors) {
          all.push({ ...s, caseName: c.name })
        }
      }
      setAllSelectors(all)
    } catch (err) {
      console.error('Failed to load selectors:', err)
    } finally {
      setLoading(false)
    }
  }

  const filtered = filterCaseId
    ? allSelectors.filter((s) => s.caseId === filterCaseId)
    : allSelectors

  async function toggleEnabled(sel: SelectorWithCase) {
    await window.birdbrain.selectors.update({ id: sel.id, enabled: !sel.enabled })
    await loadData()
  }

  async function handleDelete(id: string) {
    await window.birdbrain.selectors.delete(id)
    await loadData()
  }

  if (loading) {
    return <div className="text-neutral-500">Loading selectors...</div>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-100">
          All Selectors
          <span className="ml-2 text-lg font-normal text-neutral-500">{filtered.length}</span>
        </h1>
        <select
          value={filterCaseId}
          onChange={(e) => setFilterCaseId(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 outline-none"
        >
          <option value="">All cases</option>
          {cases.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-500">No selectors found.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-900 text-left text-neutral-400">
                <th className="px-4 py-2 font-medium">Pattern</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Case</th>
                <th className="px-4 py-2 font-medium">Label</th>
                <th className="px-4 py-2 font-medium">Enabled</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((sel) => (
                <tr key={sel.id} className="border-b border-neutral-800/50 hover:bg-neutral-900/50">
                  <td className="px-4 py-2 font-mono text-neutral-200">{sel.pattern}</td>
                  <td className="px-4 py-2">
                    {sel.isRegex ? (
                      <span className="rounded bg-blue-600/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
                        regex
                      </span>
                    ) : (
                      <span className="text-neutral-500">string</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-neutral-400">{sel.caseName}</td>
                  <td className="px-4 py-2 text-neutral-500">{sel.label || '—'}</td>
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={sel.enabled}
                      onChange={() => toggleEnabled(sel)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => handleDelete(sel.id)}
                      className="text-neutral-600 hover:text-red-400"
                    >
                      &times;
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
