import { useState, useCallback } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import type { CaseTab } from '@renderer/stores/appStore'
import { useCases } from '@renderer/hooks/useCases'
import { CaseOverview } from '@renderer/components/cases/CaseOverview'
import { CaptureViewer } from '@renderer/components/captures/CaptureViewer'
import { CaptureList } from '@renderer/components/captures/CaptureList'
import { CaseAnalysis } from '@renderer/components/analysis/CaseAnalysis'
import { SelectorsOverview } from '@renderer/components/selectors/SelectorsOverview'
import { CaseEntities } from '@renderer/components/cases/CaseEntities'

const tabs: { id: CaseTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'captures', label: 'Captures' },
  { id: 'entities', label: 'Entities' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'selectors', label: 'Selectors' }
]

export function CaseWorkspace() {
  const activeCaseId = useAppStore((s) => s.activeCaseId)
  const activeCaseTab = useAppStore((s) => s.activeCaseTab)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const sessionActive = useAppStore((s) => s.sessionActive)
  const goToDashboard = useAppStore((s) => s.goToDashboard)
  const { cases, updateCase, deleteCase } = useCases()

  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [confirming, setConfirming] = useState(false)

  const activeCase = cases.find((c) => c.id === activeCaseId)

  const handleRenameSubmit = useCallback(async () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== activeCase?.name && activeCaseId) {
      await updateCase({ id: activeCaseId, name: trimmed })
    }
    setRenaming(false)
    setRenameValue('')
  }, [renameValue, activeCase, activeCaseId, updateCase])

  const handleDeleteConfirm = useCallback(async () => {
    if (!activeCaseId) return
    await deleteCase(activeCaseId)
    setMenuOpen(false)
    setConfirming(false)
    goToDashboard()
  }, [activeCaseId, deleteCase, goToDashboard])

  if (!activeCaseId || !activeCase) return null

  return (
    <div className="flex h-full flex-col">
      {/* Case header */}
      <div data-testid="case-workspace-header" className="border-b border-neutral-800 px-6 pb-2 pt-4">
        <div className="flex items-center gap-3">
          {renaming ? (
            <input
              data-testid="case-header-rename-input"
              className="rounded border border-amber-600 bg-neutral-800 px-2 py-0.5 text-xl font-semibold text-neutral-100 focus:outline-none"
              value={renameValue}
              autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                } else if (e.key === 'Escape') {
                  setRenaming(false)
                  setRenameValue('')
                }
              }}
            />
          ) : (
            <h1 className="text-xl font-semibold text-neutral-100">{activeCase.name}</h1>
          )}
          {sessionActive && (
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" title="Recording" />
          )}
          {/* Kebab menu */}
          <div className="relative ml-auto">
            <button
              data-testid="case-header-menu-btn"
              onClick={() => {
                if (menuOpen) {
                  setMenuOpen(false)
                  setConfirming(false)
                } else {
                  setMenuOpen(true)
                }
              }}
              className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
              aria-label="Case menu"
              aria-expanded={menuOpen}
              aria-haspopup="true"
            >
              ⋮
            </button>
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => {
                    setMenuOpen(false)
                    setConfirming(false)
                  }}
                />
                <div className="absolute right-0 top-8 z-50 min-w-[120px] rounded-lg border border-neutral-700 bg-neutral-800 py-1 shadow-lg">
                  {confirming ? (
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span className="text-sm text-neutral-300">Delete?</span>
                      <button
                        data-testid="case-header-delete-confirm-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteConfirm()
                        }}
                        className="rounded bg-red-700 px-2 py-0.5 text-xs text-white hover:bg-red-600"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirming(false)
                        }}
                        className="rounded bg-neutral-600 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-500"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        data-testid="case-header-rename-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          setMenuOpen(false)
                          setConfirming(false)
                          setRenaming(true)
                          setRenameValue(activeCase.name)
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100"
                      >
                        Rename
                      </button>
                      <button
                        data-testid="case-header-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirming(true)
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-neutral-700 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        {activeCase.description && (
          <p className="mt-1 text-sm text-neutral-400">{activeCase.description}</p>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-neutral-800 px-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              activeCaseTab === tab.id
                ? 'border-b-2 border-blue-500 text-blue-400'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-6">
        {activeCaseTab === 'overview' && <CaseOverview />}
        {activeCaseTab === 'captures' && (
          <div className="flex h-full gap-4">
            <div className="w-[30%] overflow-y-auto">
              <CaptureList caseId={activeCaseId} />
            </div>
            <div className="flex-1 overflow-y-auto">
              <CaptureViewer />
            </div>
          </div>
        )}
        {activeCaseTab === 'entities' && <CaseEntities />}
        {activeCaseTab === 'analysis' && <CaseAnalysis />}
        {activeCaseTab === 'selectors' && <SelectorsOverview />}
      </div>
    </div>
  )
}
