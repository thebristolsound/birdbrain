import { useRef, useCallback, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import type { ArchiveInspectReport } from '@shared/types'
import {
  casesQueryOptions,
  captureCountsQueryOptions,
  useCasesMutations
} from '@renderer/lib/queries'
import { inspectCaseArchive } from '@renderer/lib/api/cases'
import { ImportCaseDialog } from '@renderer/components/dashboard/cases/ImportCaseDialog'
import { HeroSection } from '@renderer/components/dashboard/HeroSection'
import { RecentCases } from '@renderer/components/dashboard/RecentCases'
import { QuickStartGuide } from '@renderer/components/dashboard/QuickStartGuide'
import { ExtensionBanner } from '@renderer/components/dashboard/ExtensionBanner'
import { DashboardFooter } from '@renderer/components/dashboard/DashboardFooter'

export function Dashboard() {
  const navigate = useNavigate()
  const { data: cases = [] } = useQuery(casesQueryOptions)
  const { data: captureCounts = {} } = useQuery(captureCountsQueryOptions)
  const { update, remove } = useCasesMutations()
  const connectedToExtension = useAppStore((s) => s.connectedToExtension)
  const [importReport, setImportReport] = useState<ArchiveInspectReport | null>(null)
  const [importError, setImportError] = useState('')

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

  const handleImportCase = useCallback(async () => {
    setImportError('')
    try {
      const report = await inspectCaseArchive()
      if (report) setImportReport(report)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  return (
    <div data-testid="dashboard" className="grid-bg min-h-full">
      <HeroSection
        onNewInvestigation={handleNewCase}
        onOpenRecent={handleOpenRecent}
        onImportCase={handleImportCase}
      />

      {importError && (
        <div className="px-8 pb-4">
          <div className="max-w-3xl mx-auto rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {importError}
          </div>
        </div>
      )}

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

      {importReport && (
        <ImportCaseDialog report={importReport} onClose={() => setImportReport(null)} />
      )}
    </div>
  )
}
