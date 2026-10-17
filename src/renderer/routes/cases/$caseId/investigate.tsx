import { useParams, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { caseQueryOptions } from '@renderer/lib/api/cases'
import {
  InvestigateView,
  type InvestigateSelection
} from '@renderer/components/investigate/InvestigateView'

// The Investigate section's selection. One shape here, so the panes later briefs fill read and
// set the same keys without each editing the route tree.
export function validateInvestigateSearch(search: Record<string, unknown>): InvestigateSelection {
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' ? value : undefined
  return {
    jointId: text(search.jointId),
    subjectId: text(search.subjectId),
    spanId: text(search.spanId)
  }
}

export function InvestigateRoute() {
  const { caseId } = useParams({ from: '/cases/$caseId/investigate' })
  const selection = useSearch({ from: '/cases/$caseId/investigate' })
  const { data: caseData } = useQuery(caseQueryOptions(caseId))

  return (
    <InvestigateView
      key={caseId}
      caseId={caseId}
      caseName={caseData?.name ?? ''}
      selection={selection}
    />
  )
}
