import { useState, useRef, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Search, StickyNote } from 'lucide-react'
import type { FieldHit } from '@shared/types'
import { fieldLabel } from '@shared/searchFields'
import { useAppStore } from '@renderer/stores/appStore'
import { useSearch } from '@renderer/hooks/useSearch'
import { accelerator } from '@renderer/lib/accelerator'

interface SearchBarProps {
  caseId: string
}

const GROUP_HEADING =
  'border-t border-border px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-text-faint'

// Names the Exhibit a result came from: its citation, and the first 12 characters of its
// Content Hash (docs/plans/2026-10-09-case-retrieval-first-slice.md, D6).
function ExhibitTag({ citation, contentHash }: { citation?: string; contentHash: string }) {
  return (
    <>
      {citation ? (
        <span
          title="Exhibit Number"
          className="shrink-0 rounded border border-border-strong px-1 font-mono text-[10px] leading-[15px] text-text-secondary"
        >
          {citation}
        </span>
      ) : null}
      <span title="Content Hash" className="shrink-0 font-mono text-[10px] text-text-faint">
        {contentHash.slice(0, 12)}
      </span>
    </>
  )
}

// One group per field, in the order the first hit of each arrived.
function groupByField(hits: FieldHit[]): Array<[string, FieldHit[]]> {
  const groups = new Map<string, FieldHit[]>()
  for (const hit of hits) groups.set(hit.field, [...(groups.get(hit.field) ?? []), hit])
  return [...groups]
}

// Permanently expanded case-wide search, centered in the top bar. Ctrl+F
// focuses it; Ctrl+K stays on the command palette (case switcher).
export function SearchBar({ caseId }: SearchBarProps) {
  const [query, setQuery] = useState('')
  // True between a keystroke and the debounced search it schedules, so the
  // empty state never flashes for a query that has not been sent yet.
  const [pending, setPending] = useState(false)
  const { results, noteResults, fieldResults, searching, failed, search, clear } = useSearch(caseId)
  const navigate = useNavigate()
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const selectCapture = useAppStore((s) => s.selectCapture)
  const setViewerHit = useAppStore((s) => s.setViewerHit)
  const setActiveViewerTab = useAppStore((s) => s.setActiveViewerTab)
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
    setPending(true)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      setPending(false)
      search(value)
    }, 300)
  }

  const handleClose = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setPending(false)
    setQuery('')
    setSearchQuery('')
    clear()
    inputRef.current?.blur()
  }

  const busy = pending || searching
  const fieldHits = fieldResults?.hits ?? []
  const unavailable = fieldResults?.unavailable ?? []

  // A header hit opens the Text tab at its span, and a link hit the Links tab at its
  // row (D7).
  const openFieldHit = (hit: FieldHit) => {
    selectCapture(hit.exhibitId)
    setViewerHit(hit)
    setActiveViewerTab(hit.locator.source === 'text' ? 'text' : 'links')
    navigate({ to: '/cases/$caseId/captures', params: { caseId: hit.caseId } })
    handleClose()
  }

  return (
    <div data-testid="global-search" className="@container/search relative w-full">
      <div className="flex items-center gap-2 rounded-lg border border-input bg-card px-2.5 py-1 focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/25">
        <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        <input
          ref={inputRef}
          type="text"
          data-testid="global-search-input"
          aria-label="Search case captures"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && handleClose()}
          className="min-w-0 flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-faint outline-none"
          placeholder="Search this case…"
        />
        {query ? (
          <button
            onClick={handleClose}
            aria-label="Clear search"
            className="shrink-0 px-1 text-text-muted hover:text-text-secondary"
          >
            &times;
          </button>
        ) : (
          <span className="hidden shrink-0 rounded border border-border-strong bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-faint @3xs/search:inline">
            {accelerator('F', { join: ' ' })}
          </span>
        )}
      </div>

      {/* Results dropdown */}
      {query.trim() && (
        <div
          data-testid="global-search-results"
          className="absolute left-0 right-0 top-full z-50 mt-1 min-w-[400px] max-h-64 overflow-y-auto rounded border border-border-strong bg-elevated shadow-lg"
        >
          {busy && <div className="px-3 py-2 text-xs text-text-muted">Searching...</div>}
          {!busy && failed && (
            <div className="px-3 py-2 text-xs text-text-muted">
              Search could not run on this text
            </div>
          )}
          {!busy &&
            !failed &&
            results.length === 0 &&
            noteResults.length === 0 &&
            fieldHits.length === 0 &&
            unavailable.length === 0 && (
              <div className="px-3 py-2 text-xs text-text-muted">No matches in this case</div>
            )}
          {results.map((cap) => (
            <button
              key={cap.id}
              onClick={() => {
                selectCapture(cap.id)
                setViewerHit(null)
                navigate({
                  to: '/cases/$caseId/captures',
                  params: { caseId: cap.caseId }
                })
                handleClose()
              }}
              className="block w-full px-3 py-2 text-left hover:bg-elevated"
            >
              <div className="truncate text-sm text-text-primary">{cap.title}</div>
              <div className="flex min-w-0 items-center gap-1.5">
                <ExhibitTag citation={cap.exhibitCitation} contentHash={cap.hash} />
                <span className="truncate font-mono text-xs text-text-muted">{cap.url}</span>
              </div>
            </button>
          ))}
          {groupByField(fieldHits).map(([field, hits]) => (
            <div key={field} data-testid="global-search-field-group">
              <div className={GROUP_HEADING}>{fieldLabel(field)}</div>
              {hits.map((hit) => (
                <button
                  key={hit.fieldId}
                  onClick={() => openFieldHit(hit)}
                  className="block w-full px-3 py-2 text-left hover:bg-elevated"
                >
                  <div className="truncate font-mono text-xs text-text-primary">{hit.preview}</div>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <ExhibitTag citation={hit.exhibitCitation} contentHash={hit.contentHash} />
                    <span className="truncate text-xs text-text-muted">{hit.title}</span>
                    {hit.occurrences > 1 && (
                      <span className="shrink-0 text-[10px] text-text-faint">
                        &times;{hit.occurrences}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ))}
          {fieldResults?.truncated && (
            <div className="px-3 py-1.5 text-[11px] text-text-faint">
              Only the first {fieldHits.length} link and header matches are listed.
            </div>
          )}
          {unavailable.length > 0 && (
            <div
              data-testid="global-search-unavailable"
              className="px-3 py-1.5 text-[11px] text-text-faint"
            >
              Link and header matches unavailable, changed after indexing: Exhibit{' '}
              {unavailable.map((u) => u.exhibitCitation).join(', ')}
            </div>
          )}
          {noteResults.length > 0 && <div className={GROUP_HEADING}>Notes</div>}
          {noteResults.map((note) => (
            <button
              key={note.id}
              onClick={() => {
                navigate({
                  to: '/cases/$caseId/notes',
                  params: { caseId: note.caseId }
                })
                handleClose()
              }}
              className="block w-full px-3 py-2 text-left hover:bg-elevated"
            >
              <div className="flex items-center gap-1.5 truncate text-sm text-text-primary">
                <StickyNote className="h-3 w-3 shrink-0 text-text-muted" />
                <span className="truncate">{note.title || 'Untitled note'}</span>
              </div>
              <div className="truncate text-xs text-text-muted">{note.body}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
