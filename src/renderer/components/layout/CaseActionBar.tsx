import type { Case } from '@shared/types'
import { SessionControls } from '@renderer/components/status/SessionControls'
import { ExportMenu } from '@renderer/components/export/ExportMenu'

// The case's own actions sit in this bar under the top bar rather than in it. The top bar
// shares its row with the native window controls, and the room they take is only as right
// as the window-controls overlay reports (lib/windowControls.ts); keeping the top bar's
// right side short and fixed leaves it clear of them at every window width. The bar sets no
// z-index: one would make it a stacking context, and the Export menu and dialog would then
// paint under the Captures details overlay (z-40) instead of on their own z-50.
export function CaseActionBar({ caseData }: { caseData: Case }) {
  return (
    <div
      data-testid="case-action-bar"
      className="flex h-10 shrink-0 items-center justify-end gap-3 border-b border-border bg-surface px-4"
    >
      <SessionControls />
      <ExportMenu caseId={caseData.id} caseName={caseData.name} />
    </div>
  )
}
