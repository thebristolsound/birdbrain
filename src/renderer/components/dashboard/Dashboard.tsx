import { useRef, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import {
  casesQueryOptions,
  captureCountsQueryOptions,
  useCasesMutations
} from '@renderer/lib/queries'
import { HeroSection } from './HeroSection'
import { RecentCases } from './RecentCases'
import { QuickStartGuide } from './QuickStartGuide'
import { ExtensionBanner } from './ExtensionBanner'
import { DashboardFooter } from './DashboardFooter'

export function Dashboard() {
  const navigate = useNavigate()
  const { data: cases = [] } = useQuery(casesQueryOptions)
  const { data: captureCounts = {} } = useQuery(captureCountsQueryOptions)
  const { update, remove } = useCasesMutations()
  const connectedToExtension = useAppStore((s) => s.connectedToExtension)

  const recentCasesRef = useRef<HTMLDivElement>(null)

  const handleSelectCase = useCallback(
    (id: string) => {
      navigate({ to: '/cases/$caseId', params: { caseId: id } })
    },
    [navigate]
  )

  const handleNewCase = useCallback(() => {
    navigate({ to: '/cases/new' })
  }, [navigate])

  const handleOpenRecent = useCallback(() => {
    recentCasesRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const handleRenameCase = useCallback(
    async (id: string, name: string) => {
      await update.mutateAsync({ id, name })
    },
    [update]
  )

  const handleDeleteCase = useCallback(
    async (id: string) => {
      await remove.mutateAsync(id)
    },
    [remove]
  )

  return (
    <div data-testid="dashboard" className="grid-bg min-h-full">
      <HeroSection onNewInvestigation={handleNewCase} onOpenRecent={handleOpenRecent} />

      <div ref={recentCasesRef}>
        <RecentCases
          cases={cases}
          captureCounts={captureCounts}
          onSelectCase={handleSelectCase}
          onNewCase={handleNewCase}
          onRenameCase={handleRenameCase}
          onDeleteCase={handleDeleteCase}
        />
      </div>

      <QuickStartGuide />

      <div className="px-8 pb-16">
        <div className="max-w-5xl mx-auto">
          <ExtensionBanner connected={connectedToExtension} />
        </div>
      </div>

      <DashboardFooter />
    </div>
  )
}
