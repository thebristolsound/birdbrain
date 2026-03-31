import { useRef, useState, useEffect, useCallback } from 'react'
import { useCases } from '@renderer/hooks/useCases'
import { useAppStore } from '@renderer/stores/appStore'
import { HeroSection } from './HeroSection'
import { RecentCases } from './RecentCases'
import { QuickStartGuide } from './QuickStartGuide'
import { ExtensionBanner } from './ExtensionBanner'
import { DashboardFooter } from './DashboardFooter'

export function Dashboard() {
  const { cases, updateCase, deleteCase } = useCases()
  const selectCase = useAppStore((s) => s.selectCase)
  const connectedToExtension = useAppStore((s) => s.connectedToExtension)
  const activeCaseId = useAppStore((s) => s.activeCaseId)
  const sessionActive = useAppStore((s) => s.sessionActive)
  const goToNewCaseWizard = useAppStore((s) => s.goToNewCaseWizard)

  const recentCasesRef = useRef<HTMLDivElement>(null)
  const [captureCounts, setCaptureCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    window.birdbrain.captures
      .countsByCase()
      .then((counts) => {
        if (!cancelled) setCaptureCounts(counts)
      })
      .catch((err) => {
        if (!cancelled) console.error('Failed to load capture counts:', err)
      })
    return () => {
      cancelled = true
    }
  }, [cases.length])

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
          captureCounts={captureCounts}
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
