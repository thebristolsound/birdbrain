import { useRef, useCallback } from 'react'
import { useCases } from '@renderer/hooks/useCases'
import { useAppStore } from '@renderer/stores/appStore'
import { HeroSection } from './HeroSection'
import { RecentCases } from './RecentCases'
import { QuickStartGuide } from './QuickStartGuide'
import { ExtensionBanner } from './ExtensionBanner'
import { DashboardFooter } from './DashboardFooter'

export function Dashboard() {
  const { cases, updateCase, deleteCase } = useCases()
  const { selectCase, connectedToExtension, activeCaseId, sessionActive, goToNewCaseWizard } =
    useAppStore()

  const recentCasesRef = useRef<HTMLDivElement>(null)

  const handleOpenRecent = useCallback(() => {
    recentCasesRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const handleRenameCase = useCallback(
    async (id: string, name: string) => {
      await updateCase({ id, name })
    },
    [updateCase]
  )

  const handleDeleteCase = useCallback(
    async (id: string) => {
      await deleteCase(id)
    },
    [deleteCase]
  )

  return (
    <div data-testid="dashboard" className="grid-bg min-h-full">
      <HeroSection onNewInvestigation={goToNewCaseWizard} onOpenRecent={handleOpenRecent} />

      <div ref={recentCasesRef}>
        <RecentCases
          cases={cases}
          activeCaseId={activeCaseId}
          sessionActive={sessionActive}
          onSelectCase={selectCase}
          onNewCase={goToNewCaseWizard}
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
