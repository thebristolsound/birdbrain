import { useAppStore } from '@renderer/stores/appStore'
import { CaseList } from '@renderer/components/cases/CaseList'
import { CaptureList } from '@renderer/components/captures/CaptureList'
import { TagList } from '@renderer/components/tags/TagList'

export function Sidebar() {
  const { sidebarCollapsed, activeCaseId } = useAppStore()

  if (sidebarCollapsed) return null

  return (
    <aside className="flex w-72 flex-col border-r border-neutral-800 bg-neutral-900/50">
      <CaseList />
      {activeCaseId && (
        <>
          <div className="border-t border-neutral-800" />
          <CaptureList caseId={activeCaseId} />
        </>
      )}
      <div className="border-t border-neutral-800" />
      <TagList />
    </aside>
  )
}
