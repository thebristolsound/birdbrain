import { useState, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { casesQueryOptions } from '@renderer/lib/queries'
import type { BirdbrainSettings } from '@shared/types'

type Section = BirdbrainSettings['lastActiveSection']

const SECTION_PATHS: Record<Exclude<Section, 'settings'>, string> = {
  captures: '/cases/$caseId/captures',
  selectors: '/cases/$caseId/selectors',
  notes: '/cases/$caseId/notes',
  tags: '/cases/$caseId/tags'
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

  const section: Exclude<Section, 'settings'> =
    lastActiveSection in SECTION_PATHS
      ? (lastActiveSection as Exclude<Section, 'settings'>)
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
  const { data: cases, isLoading } = useQuery(casesQueryOptions)

  useEffect(() => {
    if (isLoading || cases === undefined) return

    let cancelled = false

    async function restore() {
      const settings = await window.birdbrain.settings.get()
      if (cancelled) return

      const route = resolveStartRoute({
        lastActiveCaseId: settings.lastActiveCaseId,
        lastActiveSection: settings.lastActiveSection,
        cases: cases ?? []
      })

      await navigate(route as Parameters<typeof navigate>[0])
      if (!cancelled) setRestoring(false)
    }

    restore()

    return () => {
      cancelled = true
    }
  }, [isLoading, cases, navigate])

  return { restoring }
}
