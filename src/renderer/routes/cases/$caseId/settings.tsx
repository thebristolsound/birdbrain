import { useParams } from '@tanstack/react-router'
import { CaseSettingsView } from '@renderer/components/sharing/CaseSettingsView'

// Case settings (#1514). Registered under the Case workspace with no sidebar,
// top-bar or palette entry until the sync defects #1951 and #1955 merge; a
// later PR adds the entry points.
export function CaseSettingsRoute() {
  const { caseId } = useParams({ from: '/cases/$caseId/settings' })
  return <CaseSettingsView key={caseId} caseId={caseId} />
}
