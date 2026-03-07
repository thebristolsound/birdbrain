import { useAppStore } from '@renderer/stores/appStore'
import { CaseList } from '@renderer/components/cases/CaseList'
import { CaptureList } from '@renderer/components/captures/CaptureList'
import { TagList } from '@renderer/components/tags/TagList'

export function Sidebar() {
  const { sidebarCollapsed, activeCaseId, setActiveView } = useAppStore()

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
      <div className="border-t border-neutral-800" />
      <button
        onClick={() => setActiveView('selectors-overview')}
        className="px-4 py-2 text-left text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
      >
        Selectors
      </button>
    </aside>
  )
}
