import { useState, useRef, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useAppStore } from '@renderer/stores/appStore'
import { useSearch } from '@renderer/hooks/useSearch'

// Permanently expanded case-wide search, centered in the top bar. Ctrl+F
// focuses it; Ctrl+K stays on the command palette (case switcher).
export function SearchBar() {
  const [query, setQuery] = useState('')
  const { results, searching, search, clear } = useSearch()
  const navigate = useNavigate()
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const selectCapture = useAppStore((s) => s.selectCapture)
  const inputRef = useRef<HTMLInputElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.repeat) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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
    inputRef.current?.blur()
  }

  return (
    <div className="relative w-[400px] shrink-0">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1 focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/25">
        <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        <input
          ref={inputRef}
          type="text"
          data-testid="global-search-input"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && handleClose()}
          className="min-w-0 flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-faint outline-none"
          placeholder="Search this case — titles, URLs, full text, notes…"
        />
        {query ? (
          <button
            onClick={handleClose}
            className="shrink-0 px-1 text-text-muted hover:text-text-secondary"
          >
            &times;
          </button>
        ) : (
          <span className="shrink-0 rounded border border-border-strong bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-faint">
            Ctrl F
          </span>
        )}
      </div>

      {/* Results dropdown */}
      {query && (results.length > 0 || searching) && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded border border-border-strong bg-elevated shadow-lg">
          {searching && <div className="px-3 py-2 text-xs text-text-muted">Searching...</div>}
          {results.map((cap) => (
            <button
              key={cap.id}
              onClick={() => {
                selectCapture(cap.id)
                navigate({
                  to: '/cases/$caseId/captures',
                  params: { caseId: cap.caseId }
                })
                handleClose()
              }}
              className="block w-full px-3 py-2 text-left hover:bg-elevated"
            >
              <div className="truncate text-sm text-text-primary">{cap.title}</div>
              <div className="truncate font-mono text-xs text-text-muted">{cap.url}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
