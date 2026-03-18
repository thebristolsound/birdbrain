import { useState, useCallback } from 'react'
import { useCases } from '@renderer/hooks/useCases'
import { useAppStore } from '@renderer/stores/appStore'
import { CreateCaseDialog } from '@renderer/components/cases/CreateCaseDialog'

export function Dashboard() {
  const { cases, updateCase, deleteCase } = useCases()
  const { selectCase, connectedToExtension, activeCaseId, goToDashboard } = useAppStore()
  const [showCreate, setShowCreate] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const recentCases = cases.slice(0, 5)

  const handleRenameSubmit = useCallback(
    async (id: string) => {
      const trimmed = editName.trim()
      if (trimmed) {
        await updateCase({ id, name: trimmed })
      }
      setEditingId(null)
      setEditName('')
    },
    [editName, updateCase]
  )

  const handleDeleteConfirm = useCallback(
    async (id: string) => {
      await deleteCase(id)
      setMenuOpenId(null)
      setDeletingId(null)
      if (activeCaseId === id) {
        goToDashboard()
      }
    },
    [deleteCase, activeCaseId, goToDashboard]
  )

  return (
    <div data-testid="dashboard" className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-amber-500">Birdbrain</h1>
        <p className="mt-1 text-neutral-400">Web investigation & capture tool</p>
      </div>

      {/* Extension Status */}
      <div
        className={`rounded-lg border p-4 ${
          connectedToExtension
            ? 'border-green-800 bg-green-950/30'
            : 'border-neutral-700 bg-neutral-900'
        }`}
      >
        <h3 className="font-medium text-neutral-200">
          {connectedToExtension ? 'Chrome Extension Connected' : 'Chrome Extension Not Connected'}
        </h3>
        {!connectedToExtension && (
          <div className="mt-2 space-y-1 text-sm text-neutral-400">
            <p>To get started:</p>
            <ol className="ml-4 list-decimal space-y-1">
              <li>
                Open Chrome and navigate to{' '}
                <span className="font-mono text-amber-500">chrome://extensions</span>
              </li>
              <li>Enable "Developer mode" (top right)</li>
              <li>
                Click "Load unpacked" and select the{' '}
                <span className="font-mono text-amber-500">extension/dist</span> folder
              </li>
              <li>The extension icon will appear in your toolbar</li>
            </ol>
          </div>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-2xl font-bold text-neutral-100">{cases.length}</div>
          <div className="text-sm text-neutral-400">Cases</div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-2xl font-bold text-neutral-100">-</div>
          <div className="text-sm text-neutral-400">Total Captures</div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-2xl font-bold text-neutral-100">-</div>
          <div className="text-sm text-neutral-400">Storage Used</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <button
          data-testid="new-case-btn"
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
        >
          + New Case
        </button>
      </div>

      {/* Recent Cases */}
      {recentCases.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-neutral-200">Recent Cases</h2>
          <div className="space-y-2">
            {/* Overlay to close menu when clicking outside */}
            {menuOpenId !== null && (
              <div className="fixed inset-0 z-40" onClick={() => { setMenuOpenId(null); setDeletingId(null) }} />
            )}
            {recentCases.map((c) => (
              <div
                key={c.id}
                data-testid="case-card"
                className="group relative w-full rounded-lg border border-neutral-800 bg-neutral-900 transition hover:border-amber-800"
              >
                {/* Clickable card area */}
                <div
                  role="button"
                  tabIndex={editingId === c.id ? -1 : 0}
                  onClick={() => !editingId && selectCase(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      if (!editingId) selectCase(c.id)
                    }
                  }}
                  className="w-full cursor-pointer p-3 pr-10 text-left"
                >
                  {editingId === c.id ? (
                    <input
                      data-testid="case-rename-input"
                      className="w-full rounded border border-amber-600 bg-neutral-800 px-2 py-0.5 font-medium text-neutral-200 focus:outline-none"
                      value={editName}
                      autoFocus
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => handleRenameSubmit(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleRenameSubmit(c.id)
                        } else if (e.key === 'Escape') {
                          setEditingId(null)
                          setEditName('')
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div className="font-medium text-neutral-200">{c.name}</div>
                  )}
                  {c.description && (
                    <div className="mt-1 text-sm text-neutral-500">{c.description}</div>
                  )}
                  <div className="mt-1 font-mono text-xs text-neutral-600">
                    Updated {new Date(c.updatedAt).toLocaleDateString()}
                  </div>
                </div>

                {/* Kebab menu button */}
                <button
                  data-testid="case-card-menu-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (menuOpenId === c.id) {
                      setMenuOpenId(null)
                      setDeletingId(null)
                    } else {
                      setMenuOpenId(c.id)
                      setDeletingId(null)
                    }
                  }}
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded text-neutral-400 opacity-0 transition hover:bg-neutral-700 hover:text-neutral-200 group-hover:opacity-100"
                  aria-label="Card menu"
                >
                  ⋮
                </button>

                {/* Dropdown menu */}
                {menuOpenId === c.id && (
                  <div className="absolute right-2 top-9 z-50 min-w-[120px] rounded-lg border border-neutral-700 bg-neutral-800 py-1 shadow-lg">
                    {deletingId === c.id ? (
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="text-sm text-neutral-300">Delete?</span>
                        <button
                          data-testid="case-card-delete-confirm-btn"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteConfirm(c.id)
                          }}
                          className="rounded bg-red-700 px-2 py-0.5 text-xs text-white hover:bg-red-600"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeletingId(null)
                          }}
                          className="rounded bg-neutral-600 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-500"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          data-testid="case-card-rename-btn"
                          onClick={(e) => {
                            e.stopPropagation()
                            setMenuOpenId(null)
                            setEditingId(c.id)
                            setEditName(c.name)
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100"
                        >
                          Rename
                        </button>
                        <button
                          data-testid="case-card-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeletingId(c.id)
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-neutral-700 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreate && <CreateCaseDialog onClose={() => setShowCreate(false)} />}
    </div>
  )
}
