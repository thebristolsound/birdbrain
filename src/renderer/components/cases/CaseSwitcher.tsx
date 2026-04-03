import { useState, useRef, useEffect } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import { casesQueryOptions } from '@renderer/lib/queries'

export function CaseSwitcher() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const activeCaseId = (params as { caseId?: string }).caseId ?? null
  const sessionActive = useAppStore((s) => s.sessionActive)
  const { data: cases = [], isLoading } = useQuery(casesQueryOptions)

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

  if (isLoading) {
    return <span className="text-sm font-semibold text-text-muted">Loading...</span>
  }

  if (!activeCase) return null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1 text-sm font-semibold text-text-primary hover:text-white"
      >
        {activeCase.name}
        <span className="text-xs text-text-muted">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-border-strong bg-elevated py-1 shadow-xl">
          {cases.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                navigate({ to: '/cases/$caseId', params: { caseId: c.id } })
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-elevated ${
                c.id === activeCaseId ? 'bg-accent-subtle text-white' : 'text-text-secondary'
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
