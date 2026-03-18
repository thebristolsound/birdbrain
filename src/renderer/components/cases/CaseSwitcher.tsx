import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import { useCases } from '@renderer/hooks/useCases'

export function CaseSwitcher() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const activeCaseId = useAppStore((s) => s.activeCaseId)
  const sessionActive = useAppStore((s) => s.sessionActive)
  const selectCase = useAppStore((s) => s.selectCase)
  const { cases, loading } = useCases()

  const activeCase = cases.find((c) => c.id === activeCaseId)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (loading) {
    return <span className="text-sm font-semibold text-neutral-400">Loading…</span>
  }

  if (!activeCase) return null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1 text-sm font-semibold text-neutral-100 hover:text-white"
      >
        {activeCase.name}
        <span className="text-xs text-neutral-500">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-neutral-700 bg-neutral-800 py-1 shadow-xl">
          {cases.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                selectCase(c.id)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-700 ${
                c.id === activeCaseId ? 'bg-neutral-700/50 text-white' : 'text-neutral-300'
              }`}
            >
              {sessionActive && c.id === activeCaseId && (
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              )}
              <span className="truncate">{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
