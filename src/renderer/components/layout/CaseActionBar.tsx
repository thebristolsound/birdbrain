import { useQuery } from '@tanstack/react-query'
import { useMatchRoute, useNavigate } from '@tanstack/react-router'
import { useAppStore } from '@renderer/stores/appStore'
import { Button } from '@renderer/components/ui'
import { SessionControls } from '@renderer/components/status/SessionControls'
import { RecordingMark } from '@renderer/components/status/RecordingMark'
import { SharePill } from '@renderer/components/status/SharePill'
import { ExportMenu } from '@renderer/components/export/ExportMenu'
import { caseQueryOptions } from '@renderer/lib/queries'
import { launchedBrowserStatusQueryOptions } from '@renderer/lib/api/launchedBrowser'
import { busyRefusal } from '@renderer/components/launchedBrowser/startDialogModel'

// What you can do to this Case, in one row under the top bar (docs/design-handoff/2026-11-08-top-bar/,
// Option B): Share, Export, Launch browser, and, while a session runs, the recording mark and the
// Capture Session switch. The top bar above keeps where you are and how the app is doing. The bar
// renders whenever a Case is open; the switch shows itself only while it has something to control.
// Its left side names the section, which the rail shows only as an icon and the screen header can
// scroll away: it is also what makes this a row rather than a second right-aligned cluster.

const SECTIONS = [
  ['/cases/$caseId/overview', 'Overview'],
  ['/cases/$caseId/captures', 'Captures'],
  ['/cases/$caseId/notes', 'Notes'],
  ['/cases/$caseId/signals', 'Signals'],
  ['/cases/$caseId/data', 'Data'],
  ['/cases/$caseId/investigate', 'Investigate'],
  ['/cases/$caseId/settings', 'Case settings']
] as const

export function CaseActionBar({ caseId }: { caseId: string }) {
  const navigate = useNavigate()
  const matchRoute = useMatchRoute()
  const openStartDialog = useAppStore((s) => s.openStartDialog)
  const sessionActive = useAppStore((s) => s.sessionActive)
  const { data: activeCase } = useQuery(caseQueryOptions(caseId))
  const { data: status } = useQuery(launchedBrowserStatusQueryOptions)
  // One launched browser at a time. A disabled button takes no pointer, so the reason sits on
  // its wrapper.
  const busy = busyRefusal(status)?.title
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

      {/* The Case's one sharing control: "Share" until a peer joins, then the sync state. */}
      {activeCase && (
        <SharePill
          caseId={activeCase.id}
          onOpenMembers={() =>
            navigate({ to: '/cases/$caseId/settings', params: { caseId: activeCase.id } })
          }
        />
      )}
      {activeCase && <ExportMenu caseId={activeCase.id} caseName={activeCase.name} />}

      <span className="h-5 w-px bg-border" aria-hidden="true" />

      {sessionActive && <RecordingMark />}
      <span title={busy}>
        <Button
          variant="outline"
          disabled={busy !== undefined}
          onClick={() => openStartDialog(caseId)}
        >
          Launch browser
        </Button>
      </span>
      <SessionControls />
    </div>
  )
}
