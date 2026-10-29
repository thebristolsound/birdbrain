import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { MoreVertical } from 'lucide-react'
import type { Case } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { caseMenuSharingLabel } from '@renderer/components/sharing/memberModel'

// A Case's action menu: Rename, Share this Case… or Members, and Delete
// behind a confirmation. The dashboard card reveals the kebab on hover and
// the Older Cases list keeps it visible (docs/design-handoff/2026-10-28-
// share-a-case/, frame E); both mount this one component so the keyboard
// rules, the confirmation and the focus handling are written once.
interface CaseMenuProps {
  caseData: Case
  alwaysVisible?: boolean
  className?: string
  onRenameStart: () => void
  onDelete: (id: string) => void
}

export function CaseMenu({
  caseData,
  alwaysVisible = false,
  className,
  onRenameStart,
  onDelete
}: CaseMenuProps) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Focus enters the menu on open, as the menu role promises. The delete
  // confirmation swaps the items for Confirm and Cancel; focus lands on Cancel
  // so a second Enter cannot delete a case by momentum.
  useEffect(() => {
    if (!menuOpen) return
    const items = menuItems()
    ;(deleting ? items[items.length - 1] : items[0])?.focus()
  }, [menuOpen, deleting])

  function menuItems(): HTMLElement[] {
    return Array.from(popoverRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
  }

  function close() {
    setMenuOpen(false)
    setDeleting(false)
  }

  function handleMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const items = menuItems()
    const index = items.indexOf(document.activeElement as HTMLElement)
    let next = -1
    if (e.key === 'ArrowDown') next = (index + 1) % items.length
    else if (e.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else if (e.key === 'Tab') {
      close()
      return
    }
    if (next < 0) return
    e.preventDefault()
    items[next]?.focus()
  }

  useEffect(() => {
    if (!menuOpen) return
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key !== 'Escape') return
      setMenuOpen(false)
      setDeleting(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setDeleting(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  const itemClass =
    'w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:bg-elevated hover:text-text-primary'

  return (
    <div ref={menuRef} className={className}>
      <button
        ref={triggerRef}
        data-testid="case-card-menu-btn"
        type="button"
        aria-label={`Actions for ${caseData.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={cn(
          'rounded-md hover:bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent transition-[opacity,background-color]',
          alwaysVisible
            ? 'grid h-6 w-6 place-items-center'
            : 'p-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100'
        )}
        onClick={(e) => {
          e.stopPropagation()
          setMenuOpen(!menuOpen)
          setDeleting(false)
        }}
      >
        <MoreVertical className="h-4 w-4 text-text-muted" />
      </button>

      {menuOpen && (
        <div
          ref={popoverRef}
          role="menu"
          aria-label={`Actions for ${caseData.name}`}
          onKeyDown={handleMenuKey}
          className="absolute right-0 top-8 z-50 w-40 rounded-lg bg-surface border border-border-strong shadow-xl py-1"
        >
          {deleting ? (
            <div className="px-2 py-1.5">
              <p className="text-[11px] text-danger-fg font-bold mb-2">Delete?</p>
              <div className="flex gap-1.5">
                <button
                  role="menuitem"
                  tabIndex={-1}
                  data-testid="case-card-delete-confirm-btn"
                  className="flex-1 text-[10px] font-bold px-2 py-1 rounded bg-danger-surface text-danger-fg border border-danger-line hover:bg-danger-line"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(caseData.id)
                    close()
                  }}
                >
                  Confirm
                </button>
                <button
                  role="menuitem"
                  tabIndex={-1}
                  className="flex-1 text-[10px] font-bold px-2 py-1 rounded bg-elevated text-text-muted hover:bg-elevated"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleting(false)
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                role="menuitem"
                tabIndex={-1}
                data-testid="case-card-rename-btn"
                className={itemClass}
                onClick={(e) => {
                  e.stopPropagation()
                  close()
                  onRenameStart()
                }}
              >
                Rename
              </button>
              <button
                role="menuitem"
                tabIndex={-1}
                data-testid="case-card-members-btn"
                className={itemClass}
                onClick={(e) => {
                  e.stopPropagation()
                  close()
                  navigate({ to: '/cases/$caseId/settings', params: { caseId: caseData.id } })
                }}
              >
                {caseMenuSharingLabel(Boolean(caseData.sharedAt))}
              </button>
              <button
                role="menuitem"
                tabIndex={-1}
                data-testid="case-card-delete-btn"
                className="w-full text-left px-3 py-1.5 text-[11px] text-danger-fg hover:bg-elevated"
                onClick={(e) => {
                  e.stopPropagation()
                  setDeleting(true)
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
