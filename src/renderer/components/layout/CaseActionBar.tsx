import { useMatchRoute } from '@tanstack/react-router'
import { useAppStore } from '@renderer/stores/appStore'
import { SessionControls } from '@renderer/components/status/SessionControls'
import { RecordingMark } from '@renderer/components/status/RecordingMark'
import { useCaptureSessionView } from '@renderer/components/launchedBrowser/CaptureSessionPanel'

// The row under the top bar (docs/design-handoff/2026-11-08-top-bar/, Option B): the recording
// mark while a session runs, then the Capture Session switch, so the mark sits against the
// switch, or against the label where a launched browser's session shows one with no switch.
// Launch browser is in the top bar, and Share and Export are in the Case menu on the Case name.
// The bar renders whenever a
// Case is open; the switch shows itself only for the extension's own session, since the Capture
// Session panel stops a launched browser's (SessionControls).
// Its left side names the section, which the rail shows only as an icon and the screen header can
// scroll away.

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
  const sessionActive = useAppStore((s) => s.sessionActive)
  // While a launched browser is open the mark's source is that browser, which the Capture
  // Session panel names, so the mark leaves it out. In every other state the mark's source is
  // the extension, when one is connected, and nothing else on the screen says so.
  const view = useCaptureSessionView()
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

      {sessionActive && <RecordingMark showSource={view.kind !== 'open'} />}
      <SessionControls />
    </div>
  )
}
