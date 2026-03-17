import { useState, useEffect } from 'react'
import type { Selector } from '@shared/types'
import { useAppStore } from '@renderer/stores/appStore'

export function SelectorsOverview() {
  const activeCaseId = useAppStore((s) => s.activeCaseId)
  const [selectors, setSelectors] = useState<Selector[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (activeCaseId) {
      loadSelectors(activeCaseId)
    }
  }, [activeCaseId])

  async function loadSelectors(caseId: string) {
    setLoading(true)
    try {
      const result = await window.birdbrain.selectors.list(caseId)
      setSelectors(result)
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

  if (loading) {
    return <div className="text-neutral-500">Loading selectors...</div>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-100">
          Selectors
          <span className="ml-2 text-lg font-normal text-neutral-500">{selectors.length}</span>
        </h1>
      </div>

      {selectors.length === 0 ? (
        <p className="text-sm text-neutral-500">No selectors found.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-900 text-left text-neutral-400">
                <th className="px-4 py-2 font-medium">Pattern</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Label</th>
                <th className="px-4 py-2 font-medium">Enabled</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {selectors.map((sel) => (
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
