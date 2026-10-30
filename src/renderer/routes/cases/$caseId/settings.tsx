import { useParams } from '@tanstack/react-router'
import { CaseSettingsView } from '@renderer/components/sharing/CaseSettingsView'

// Case settings (#1514). Reached from the top-bar sync pill and the Case card's
// menu; the sidebar carries no entry.
export function CaseSettingsRoute() {
  const { caseId } = useParams({ from: '/cases/$caseId/settings' })
  return <CaseSettingsView key={caseId} caseId={caseId} />
}
