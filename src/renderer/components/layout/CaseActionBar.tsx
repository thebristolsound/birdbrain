import { useMatchRoute } from '@tanstack/react-router'
import { SessionControls } from '@renderer/components/status/SessionControls'

// The row under the top bar (docs/design-handoff/2026-11-08-top-bar/, Option B): the section's
// name, and the Capture Session switch for the extension's session. The recording mark is the
// running state of the top bar's capture control. The bar renders whenever a Case is open; the
// switch shows itself only for the extension's own session, since the Capture Session panel
// stops a launched browser's (SessionControls).

const SECTIONS = [
  ['/cases/$caseId/overview', 'Overview'],
  ['/cases/$caseId/captures', 'Captures'],
  ['/cases/$caseId/notes', 'Notes'],
  ['/cases/$caseId/signals', 'Signals'],
  ['/cases/$caseId/data', 'Data'],
  ['/cases/$caseId/investigate', 'Investigate'],
  ['/cases/$caseId/settings', 'Case settings']
] as const

export function CaseActionBar() {
  const matchRoute = useMatchRoute()
  const section = SECTIONS.find(([to]) => matchRoute({ to, fuzzy: true }))?.[1] ?? null

  return (
    <div
      data-testid="case-action-bar"
      className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-surface px-4"
    >
      {section && (
        <span
          data-testid="case-action-bar-section"
          className="font-display text-xs font-semibold text-text-primary"
        >
          {section}
        </span>
      )}
      <div className="flex-1" />

      <SessionControls />
    </div>
  )
}
