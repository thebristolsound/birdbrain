import { useState, useCallback, useMemo } from 'react'
import { useCases } from '@renderer/hooks/useCases'
import { useAppStore } from '@renderer/stores/appStore'
import { CreateCaseDialog } from '@renderer/components/cases/CreateCaseDialog'
import {
  Plus,
  FolderOpen,
  Camera,
  Fingerprint,
  HardDrive,
  Search,
  ArrowUpDown,
  Clock
} from 'lucide-react'

export function Dashboard() {
  const { cases, updateCase, deleteCase } = useCases()
  const { selectCase, connectedToExtension, activeCaseId, goToDashboard } = useAppStore()
  const [showCreate, setShowCreate] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const recentCases = useMemo(() => {
    const filtered = searchQuery
      ? cases.filter((c) =>
          c.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : cases
    return filtered.slice(0, 10)
  }, [cases, searchQuery])

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
    <div data-testid="dashboard" className="mx-auto max-w-5xl space-y-8">
      {/* Header row */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-white">Birdbrain</h1>
          <p className="text-sm text-slate-500">Web investigation & capture tool</p>
        </div>
        <button
          data-testid="new-case-btn"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500"
        >
          <Plus className="h-4 w-4" />
          New Case
        </button>
      </div>

      {/* Extension status */}
      <div className="text-sm">
        {connectedToExtension ? (
          <span className="text-emerald-400">Chrome Extension Connected</span>
        ) : (
          <span className="text-slate-500">Chrome Extension Not Connected</span>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-4">
        <div className="neu-card rounded-2xl p-5">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10">
            <FolderOpen className="h-5 w-5 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white">{cases.length}</div>
          <div className="text-sm text-slate-400">Active Cases</div>
        </div>
        <div className="neu-card rounded-2xl p-5">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10">
            <Camera className="h-5 w-5 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white">-</div>
          <div className="text-sm text-slate-400">Total Captures</div>
        </div>
        <div className="neu-card rounded-2xl p-5">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10">
            <Fingerprint className="h-5 w-5 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white">-</div>
          <div className="text-sm text-slate-400">Entities Found</div>
        </div>
        <div className="neu-card rounded-2xl p-5">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10">
            <HardDrive className="h-5 w-5 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white">-</div>
          <div className="text-sm text-slate-400">Storage Used</div>
        </div>
      </div>

      {/* Search + Sort bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search cases..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-white/[0.08] bg-slate-800 py-2 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <button className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-slate-800 text-slate-400 hover:bg-white/[0.06] hover:text-slate-200">
          <ArrowUpDown className="h-4 w-4" />
        </button>
      </div>

      {/* Case cards */}
      {recentCases.length > 0 && (
        <div>
          {/* Overlay to close menu when clicking outside */}
          {menuOpenId !== null && (
            <div className="fixed inset-0 z-40" onClick={() => { setMenuOpenId(null); setDeletingId(null) }} />
          )}
          <div className="grid grid-cols-2 gap-4">
            {recentCases.map((c) => (
              <div
                key={c.id}
                data-testid="case-card"
                className="neu-card neu-card-hover group relative cursor-pointer rounded-2xl transition-all"
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
                  className="w-full p-4 pr-10 text-left"
                >
                  {editingId === c.id ? (
                    <input
                      data-testid="case-rename-input"
                      className="w-full rounded border border-indigo-500 bg-slate-800 px-2 py-0.5 font-medium text-white focus:outline-none"
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
                    <div className="font-display text-sm font-bold text-white">{c.name}</div>
                  )}
                  {c.description && (
                    <div className="mt-1 text-xs text-slate-400">{c.description}</div>
                  )}
                  <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                    <Clock className="h-3 w-3" />
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
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded text-slate-400 opacity-0 transition hover:bg-white/[0.06] hover:text-slate-200 group-hover:opacity-100"
                  aria-label="Card menu"
                >
                  &#x22EE;
                </button>

                {/* Dropdown menu */}
                {menuOpenId === c.id && (
                  <div className="absolute right-2 top-9 z-50 min-w-[120px] rounded-lg border border-white/[0.08] bg-slate-800 py-1 shadow-lg">
                    {deletingId === c.id ? (
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="text-sm text-slate-300">Delete?</span>
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
                          className="rounded bg-slate-600 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-500"
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
                          className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/[0.06] hover:text-slate-100"
                        >
                          Rename
                        </button>
                        <button
                          data-testid="case-card-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeletingId(c.id)
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-white/[0.06] hover:text-red-300"
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
