import { useState, useEffect } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import type { Selector } from '@shared/types'

export function SelectorFilterBar() {
  const activeCaseId = useAppStore((s) => s.activeCaseId)
  const activeSelectorFilters = useAppStore((s) => s.activeSelectorFilters)
  const removeSelectorFilter = useAppStore((s) => s.removeSelectorFilter)
  const clearSelectorFilters = useAppStore((s) => s.clearSelectorFilters)
  const [selectors, setSelectors] = useState<Selector[]>([])

  useEffect(() => {
    if (activeCaseId) {
      window.birdbrain.selectors.list(activeCaseId).then(setSelectors)
    }
  }, [activeCaseId])

  if (activeSelectorFilters.length === 0) return null

  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-slate-900/50 px-3 py-2">
      <span className="text-xs text-slate-500">Filtered by:</span>
      {activeSelectorFilters.map((id) => {
        const sel = selectors.find((s) => s.id === id)
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-full bg-indigo-600/20 px-2.5 py-0.5 text-xs text-indigo-400"
          >
            {sel?.label || sel?.pattern || id.slice(0, 8)}
            <button
              onClick={() => removeSelectorFilter(id)}
              className="ml-0.5 text-indigo-500 hover:text-indigo-300"
            >
              &times;
            </button>
          </span>
        )
      })}
      <button
        onClick={clearSelectorFilters}
        className="text-xs text-slate-500 hover:text-slate-300"
      >
        Clear all
      </button>
    </div>
  )
}
