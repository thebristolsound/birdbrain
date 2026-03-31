import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import { useSearch } from '@renderer/hooks/useSearch'

export function SearchBar() {
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const { results, searching, search, clear } = useSearch()
  const selectCase = useAppStore((s) => s.selectCase)
  const navigateToCapture = useAppStore((s) => s.navigateToCapture)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const inputRef = useRef<HTMLInputElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus()
    }
  }, [expanded])

  const handleChange = (value: string) => {
    setQuery(value)
    setSearchQuery(value)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      search(value)
    }, 300)
  }

  const handleClose = () => {
    setQuery('')
    setSearchQuery('')
    clear()
    setExpanded(false)
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center gap-2 rounded px-3 py-1 text-sm text-slate-500 hover:text-slate-300"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        Search...
      </button>
    )
  }

  return (
    <div className="relative max-w-md">
      <div className="flex items-center rounded border border-white/[0.08] bg-slate-800 focus-within:border-indigo-500/40 focus-within:ring-2 focus-within:ring-indigo-500/25">
        <svg
          className="ml-2 h-4 w-4 text-slate-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && handleClose()}
          className="flex-1 bg-transparent px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 outline-none"
          placeholder="Search captures..."
        />
        {query && (
          <button onClick={handleClose} className="px-2 text-slate-500 hover:text-slate-300">
            &times;
          </button>
        )}
      </div>

      {/* Results dropdown */}
      {query && (results.length > 0 || searching) && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded border border-white/[0.08] bg-slate-800 shadow-lg">
          {searching && <div className="px-3 py-2 text-xs text-slate-500">Searching...</div>}
          {results.map((cap) => (
            <button
              key={cap.id}
              onClick={() => {
                selectCase(cap.caseId)
                navigateToCapture(cap.id)
                handleClose()
              }}
              className="block w-full px-3 py-2 text-left hover:bg-white/[0.06]"
            >
              <div className="truncate text-sm text-slate-200">{cap.title}</div>
              <div className="truncate font-mono text-xs text-slate-500">{cap.url}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
