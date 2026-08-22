import { useState, useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { casesQueryOptions, settingsQueryOptions } from '@renderer/lib/queries'
import type { BirdbrainSettings } from '@shared/types'

type Section = BirdbrainSettings['lastActiveSection']

type RestorableSection = Exclude<Section, 'settings' | 'selectors' | 'tags'>

const SECTION_PATHS: Record<RestorableSection, string> = {
  overview: '/cases/$caseId/overview',
  captures: '/cases/$caseId/captures',
  notes: '/cases/$caseId/notes',
  signals: '/cases/$caseId/signals',
  data: '/cases/$caseId/data'
}

// Sections that no longer exist as routes (#400/#700) but are still written in
// settings files from before this release. Mapped rather than left to the
// fallback below, so an operator who was last on Selectors lands on the screen
// that replaced it instead of on Captures.
const LEGACY_SECTIONS: Record<'selectors' | 'tags', RestorableSection> = {
  selectors: 'signals',
  tags: 'signals'
}

interface ResolveInput {
  lastActiveCaseId: string | null
  lastActiveSection: Section
  cases: Array<{ id: string }>
}

type RouteResult = { to: '/' } | { to: '/settings' } | { to: string; params: { caseId: string } }

export function resolveStartRoute(input: ResolveInput): RouteResult {
  const { lastActiveCaseId, lastActiveSection, cases } = input

  if (cases.length === 0) {
    return { to: '/' }
  }

  if (lastActiveSection === 'settings') {
    return { to: '/settings' }
  }

  const section: RestorableSection =
    lastActiveSection === 'selectors' || lastActiveSection === 'tags'
      ? LEGACY_SECTIONS[lastActiveSection]
      : lastActiveSection in SECTION_PATHS
        ? (lastActiveSection as RestorableSection)
        : 'captures'

  const matchedCase = lastActiveCaseId ? cases.find((c) => c.id === lastActiveCaseId) : null
  const targetCase = matchedCase ?? cases[0]

  return {
    to: SECTION_PATHS[section],
    params: { caseId: targetCase.id }
  }
}

export function useSessionRestore() {
  const [restoring, setRestoring] = useState(true)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: cases, isLoading, isError } = useQuery(casesQueryOptions)
  const hasRestoredRef = useRef(false)

  useEffect(() => {
    if (hasRestoredRef.current) return
    if (isLoading) return
    if (isError) {
      hasRestoredRef.current = true
      setRestoring(false)
      return
    }
    if (cases === undefined) return

    hasRestoredRef.current = true
    let cancelled = false

    async function restore() {
      try {
        const settings = await queryClient.fetchQuery(settingsQueryOptions)
        if (cancelled) return

        const route = resolveStartRoute({
          lastActiveCaseId: settings.lastActiveCaseId,
          lastActiveSection: settings.lastActiveSection,
          cases: cases ?? []
        })

        await navigate(route as Parameters<typeof navigate>[0])
      } finally {
        if (!cancelled) setRestoring(false)
      }
    }

    restore()

    return () => {
      cancelled = true
    }
  }, [isLoading, isError, cases, navigate])

  return { restoring }
}
