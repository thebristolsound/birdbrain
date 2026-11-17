import { useMatchRoute } from '@tanstack/react-router'
import { useAppStore } from '@renderer/stores/appStore'
import { SessionControls } from '@renderer/components/status/SessionControls'
import { RecordingMark } from '@renderer/components/status/RecordingMark'
import { useCaptureSessionView } from '@renderer/components/launchedBrowser/CaptureSessionPanel'

// The row under the top bar (docs/design-handoff/2026-11-08-top-bar/, Option B): the recording
// mark while a session runs, then the Capture Session switch, so the mark sits against the
// switch. Share, Export and Launch browser moved up into the top bar. The bar renders whenever a
// Case is open; the switch shows itself only while it has something to control (SessionControls).
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
  // The Capture Session panel names a launched browser, open or closed, so the mark beside it
  // names a source only when the panel shows none: an extension-only session, or a notice.
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

      {sessionActive && <RecordingMark showSource={!('browser' in view)} />}
      <SessionControls />
    </div>
  )
}
