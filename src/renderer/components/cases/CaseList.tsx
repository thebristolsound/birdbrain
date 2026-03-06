import { useState } from 'react'
import { useCases } from '@renderer/hooks/useCases'
import { useAppStore } from '@renderer/stores/appStore'
import { CaseItem } from './CaseItem'
import { CreateCaseDialog } from './CreateCaseDialog'

export function CaseList() {
  const { cases, deleteCase, updateCase } = useCases()
  const { activeCaseId, selectCase, sessionActive } = useAppStore()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Cases</span>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          title="New case"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto">
        {cases.map((c) => (
          <CaseItem
            key={c.id}
            caseData={c}
            isActive={c.id === activeCaseId}
            isRecording={c.id === activeCaseId && sessionActive}
            onClick={() => selectCase(c.id)}
            onDelete={() => deleteCase(c.id)}
            onRename={(name) => updateCase({ id: c.id, name })}
          />
        ))}
        {cases.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-neutral-600">No cases yet</div>
        )}
      </div>
      {showCreate && <CreateCaseDialog onClose={() => setShowCreate(false)} />}
    </div>
  )
}
