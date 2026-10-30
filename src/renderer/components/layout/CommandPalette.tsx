import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Search, Plus, Clock, Compass, MessageSquareWarning, Users } from 'lucide-react'
import { useAppStore } from '@renderer/stores/appStore'
import { casesQueryOptions, captureCountsQueryOptions } from '@renderer/lib/queries'
import { sharingAvailableQueryOptions } from '@renderer/lib/api/sharing'
import { formatRelativeTimeShort } from '@renderer/lib/formatRelativeTime'
import { shareActionLabel } from '@renderer/components/sharing/memberModel'
import { presets } from '@renderer/lib/motion'
import { trapTab, useModalFocus } from '@renderer/components/ui'
import { startTour } from '@renderer/components/onboarding/startTour'
import { useTimeTick } from '@renderer/hooks/useTimeTick'

function pluralCaptures(n: number): string {
  return `${n} capture${n === 1 ? '' : 's'}`
}

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const now = useTimeTick(60_000)
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as Record<string, string | undefined>
  const activeCaseId = params.caseId

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)

  const { data: cases = [] } = useQuery(casesQueryOptions)
  const { data: captureCounts = {} } = useQuery(captureCountsQueryOptions)
  const { data: sharingAvailable } = useQuery(sharingAvailableQueryOptions)

  // The open Case's sharing row (docs/design-handoff/2026-10-28-share-a-case/,
  // frame D): absent on the dashboard and the wizard, where no Case is open,
  // and where sharing is unavailable.
  const activeCase = cases.find((c) => c.id === activeCaseId)
  const shareRow =
    activeCaseId !== undefined && sharingAvailable === true
      ? {
          caseId: activeCaseId,
          label: shareActionLabel(Boolean(activeCase?.sharedAt)),
          caseName: activeCase?.name ?? ''
        }
      : null

  const filtered = cases.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))

  // The dialog primitive's focus half: the input takes focus as the first
  // control inside, and closing hands focus back to whatever opened the
  // palette. Escape stays with useCommandPalette, which owns the Ctrl+K toggle.
  const openerRef = useModalFocus(open, panelRef)

  // Reset state when palette opens
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [open])

  // Clamp selectedIndex when filtered list changes
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  function selectCase(caseId: string) {
    navigate({ to: '/cases/$caseId/captures', params: { caseId } })
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = filtered[selectedIndex]
      if (target) {
        selectCase(target.id)
      } else if (filtered.length === 0) {
        navigate({ to: '/cases/new' })
        setOpen(false)
      }
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex justify-center bg-black/50"
          style={{ paddingTop: '20vh' }}
          onClick={() => setOpen(false)}
          {...presets.overlay}
        >
          <motion.div
            // No title element to point aria-labelledby at, so the name is a
            // literal, as in WelcomeCard and NoteSelectionPopover. The role is
            // kept for the whole exit animation like ui/dialog.tsx: nothing
            // queries [role="dialog"] any more, and Escape guards read
            // `commandPaletteOpen`, which setOpen(false) flips first (#686).
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            // Focusable for the same reason as the dialog primitive's content:
            // a fallback landing when nothing inside can take focus.
            tabIndex={-1}
            ref={panelRef}
            className="h-fit w-full max-w-lg rounded-xl neu-overlay"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => trapTab(e, panelRef.current)}
            {...presets.modal}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Search className="h-4 w-4 shrink-0 text-text-faint" />
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelectedIndex(0)
                }}
                onKeyDown={handleKeyDown}
                placeholder="Switch case..."
                className="min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-faint outline-none"
              />
              <span className="rounded border border-border-strong bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-faint">
                ESC
              </span>
            </div>

            {/* Case list */}
            <div className="max-h-72 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-text-faint">
                  No cases match &ldquo;{query}&rdquo;
                </div>
              ) : (
                filtered.map((c, i) => {
                  const isActive = c.id === activeCaseId
                  const isSelected = i === selectedIndex
                  const count = (captureCounts as Record<string, number>)[c.id] ?? 0
                  return (
                    <button
                      key={c.id}
                      className={[
                        'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                        isSelected
                          ? 'bg-accent-subtle text-text-primary'
                          : 'text-text-secondary hover:bg-elevated'
                      ].join(' ')}
                      onMouseEnter={() => setSelectedIndex(i)}
                      onClick={() => selectCase(c.id)}
                    >
                      <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                        {isActive ? (
                          <span className="h-2 w-2 rounded-full bg-accent" />
                        ) : (
                          <span className="h-2 w-2 rounded-full border border-border-strong" />
                        )}
                      </div>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                      <div className="flex shrink-0 items-center gap-2 text-xs text-text-faint">
                        <span>{pluralCaptures(count)}</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatRelativeTimeShort(c.createdAt, now)}
                        </span>
                      </div>
                    </button>
                  )
                })
              )}
            </div>

            {/* Create new option */}
            <div className="border-t border-border py-1">
              <button
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-text-secondary transition-colors hover:bg-elevated"
                onClick={() => {
                  navigate({ to: '/cases/new' })
                  setOpen(false)
                }}
              >
                <Plus className="h-4 w-4 shrink-0 text-text-faint" />
                <span className="text-sm">Create new case</span>
              </button>
              {shareRow && (
                <button
                  data-testid="palette-share-case"
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-text-secondary transition-colors hover:bg-elevated"
                  onClick={() => {
                    navigate({ to: '/cases/$caseId/settings', params: { caseId: shareRow.caseId } })
                    setOpen(false)
                  }}
                >
                  <Users className="h-4 w-4 shrink-0 text-text-faint" />
                  <span className="min-w-0 flex-1 truncate text-sm">{shareRow.label}</span>
                  <span className="max-w-[40%] shrink-0 truncate text-xs text-text-faint">
                    {shareRow.caseName}
                  </span>
                </button>
              )}
              <button
                data-testid="palette-join-shared-case"
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-text-secondary transition-colors hover:bg-elevated"
                onClick={() => {
                  navigate({ to: '/cases/new', search: { join: true } })
                  setOpen(false)
                }}
              >
                <Users className="h-4 w-4 shrink-0 text-text-faint" />
                <span className="text-sm">Join a shared Case…</span>
              </button>
              <button
                data-testid="palette-replay-tour"
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-text-secondary transition-colors hover:bg-elevated"
                onClick={() => {
                  // The tour records whatever holds focus as its opener, and
                  // this button is about to unmount: hand it the palette's.
                  openerRef.current?.focus()
                  setOpen(false)
                  startTour('intro')
                }}
              >
                <Compass className="h-4 w-4 shrink-0 text-text-faint" />
                <span className="text-sm">Replay walkthrough</span>
              </button>
              <button
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-text-secondary transition-colors hover:bg-elevated"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('birdbrain:report', { detail: {} }))
                  setOpen(false)
                }}
              >
                <MessageSquareWarning className="h-4 w-4 shrink-0 text-text-faint" />
                <span className="text-sm">Report a problem</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
