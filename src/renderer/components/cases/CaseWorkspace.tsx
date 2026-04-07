import { useEffect } from 'react'
import { useParams, Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import {
  casesQueryOptions,
  capturesQueryOptions,
  noteCountQueryOptions,
  tagCountForCaseQueryOptions
} from '@renderer/lib/queries'
import { useSelectorFilters } from '@renderer/hooks/useSelectorFilters'
import { presets } from '@renderer/lib/motion'
import { LayoutDashboard, Layers, Crosshair, StickyNote, Tag } from 'lucide-react'
import { CAPTURE_SERVER_BASE_URL } from '@shared/constants'

type CaseTab = 'overview' | 'captures' | 'selectors' | 'notes' | 'tags'

const tabs: { id: CaseTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'captures', label: 'Captures', icon: Layers },
  { id: 'selectors', label: 'Selectors', icon: Crosshair },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'tags', label: 'Tags', icon: Tag }
]

function tabPath(tab: CaseTab): string {
  switch (tab) {
    case 'overview':
      return '/cases/$caseId'
    case 'captures':
      return '/cases/$caseId/captures'
    case 'selectors':
      return '/cases/$caseId/selectors'
    case 'notes':
      return '/cases/$caseId/notes'
    case 'tags':
      return '/cases/$caseId/tags'
  }
}

export function CaseWorkspace() {
  const { caseId } = useParams({ from: '/cases/$caseId' })
  const matchRoute = useMatchRoute()
  const { data: cases = [], isLoading } = useQuery(casesQueryOptions)
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))
  const { data: noteCount = 0 } = useQuery(noteCountQueryOptions(caseId))
  const { data: tagCount = 0 } = useQuery(tagCountForCaseQueryOptions(caseId))

  useSelectorFilters(caseId)

  // Activate case on the capture server when entering workspace
  useEffect(() => {
    if (caseId) {
      fetch(`${CAPTURE_SERVER_BASE_URL}/api/cases/${caseId}/activate`, { method: 'POST' }).catch(
        (err) => console.error('Failed to activate case on server:', err)
      )
    }
  }, [caseId])

  const activeCase = cases.find((c) => c.id === caseId)

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">Loading case...</div>
    )
  }

  if (!activeCase) return null

  const isCaptures = matchRoute({ to: '/cases/$caseId/captures', fuzzy: true }) !== false
  const isSelectors = matchRoute({ to: '/cases/$caseId/selectors', fuzzy: true }) !== false
  const isNotes = matchRoute({ to: '/cases/$caseId/notes', fuzzy: true }) !== false
  const isTags = matchRoute({ to: '/cases/$caseId/tags', fuzzy: true }) !== false

  function isTabActive(tab: CaseTab): boolean {
    if (tab === 'overview') return !isCaptures && !isSelectors && !isNotes && !isTags
    if (tab === 'captures') return isCaptures
    if (tab === 'selectors') return isSelectors
    if (tab === 'notes') return isNotes
    return isTags
  }

  const activeTabId = tabs.find((t) => isTabActive(t.id))?.id ?? 'overview'

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="h-11 shrink-0 flex items-end gap-0.5 border-b px-5 bg-surface border-border">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = isTabActive(tab.id)
          const badgeCount =
            tab.id === 'captures'
              ? captures.length
              : tab.id === 'notes'
                ? noteCount
                : tab.id === 'tags'
                  ? tagCount
                  : null
          return (
            <Link
              key={tab.id}
              to={tabPath(tab.id)}
              params={{ caseId: caseId }}
              className={`relative flex items-center gap-1.5 rounded-t-lg px-4 py-2 text-xs font-medium transition-colors ${
                isActive
                  ? 'font-semibold text-accent'
                  : 'text-text-muted hover:text-text-primary hover:bg-elevated'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {badgeCount !== null && (
                <span
                  data-testid={`tab-badge-${tab.id}`}
                  className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    isActive ? 'bg-accent-subtle text-accent' : 'bg-elevated text-text-muted'
                  }`}
                >
                  {badgeCount}
                </span>
              )}
              {isActive && (
                <motion.div
                  layoutId="tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full"
                />
              )}
            </Link>
          )
        })}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        {isCaptures ? (
          <motion.div key="captures" {...presets.fadeIn} className="flex-1 overflow-hidden">
            <Outlet />
          </motion.div>
        ) : (
          <motion.div key={activeTabId} {...presets.fadeIn} className="flex-1 overflow-auto p-6">
            <Outlet />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
