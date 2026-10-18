import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { InvestigationView, RunSummary } from '@shared/investigation'
import { investigationViewQueryOptions } from '@renderer/lib/api/investigation'
import { Button } from '@renderer/components/ui'
import { arrangementFor } from '@renderer/components/investigate/investigateModel'
import { RunSetup } from '@renderer/components/investigate/RunSetup'
import { ViewHeader } from '@renderer/components/investigate/ViewHeader'
import { PaneArrangement, type PaneId } from '@renderer/components/investigate/PaneArrangement'
import { useInvestigationRun } from '@renderer/components/investigate/useInvestigationRun'
import { useViewWidth } from '@renderer/components/investigate/useViewWidth'

// The route's selection, read from its search so it survives a tab switch and a width change.
export interface InvestigateSelection {
  jointId?: string
  subjectId?: string
  spanId?: string
}

interface InvestigateViewProps {
  caseId: string
  caseName: string
  selection: InvestigateSelection
}

const hasRun = (view: InvestigationView): view is InvestigationView & { run: RunSummary } =>
  view.run !== null

export function InvestigateView({ caseId, caseName, selection }: InvestigateViewProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const width = useViewWidth(rootRef)
  const [setupOpen, setSetupOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<PaneId>('map')
  const {
    data: view,
    isPending,
    isError,
    error,
    refetch
  } = useQuery(investigationViewQueryOptions(caseId))
  const { running, run } = useInvestigationRun(caseId, (status) => {
    if (status === 'stored') setSetupOpen(false)
  })

  let body
  if (isPending) {
    body = <div className="p-6 text-xs text-text-muted">Loading the investigation view…</div>
  } else if (isError) {
    // A packaged build registers no investigation handler, so this is all it can show here.
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-9 text-center">
        <div className="text-xs text-danger-fg">
          Failed to load the investigation view:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    )
  } else if (setupOpen || !hasRun(view)) {
    body = (
      <RunSetup
        caseId={caseId}
        caseName={caseName}
        view={view}
        running={running}
        onRun={(inquiry, startingSubjectIds) =>
          run({ from: 'inquiry', inquiry, startingSubjectIds })
        }
        onCancel={hasRun(view) ? () => setSetupOpen(false) : null}
      />
    )
  } else {
    body = (
      <>
        <ViewHeader view={view} onNewRun={() => setSetupOpen(true)} />
        <PaneArrangement
          arrangement={arrangementFor(width)}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          subjectSelected={selection.subjectId !== undefined}
        />
      </>
    )
  }

  return (
    <div
      ref={rootRef}
      data-testid="investigate-view"
      className="flex h-full min-w-0 flex-col overflow-hidden bg-canvas"
    >
      {body}
    </div>
  )
}
