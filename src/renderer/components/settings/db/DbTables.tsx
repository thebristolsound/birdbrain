import { useState, useEffect } from 'react'
import { Pencil, Trash2, Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@renderer/components/ui'
import type { DbTableRowsResult } from '@shared/ipc'
import { RowEditModal } from '@renderer/components/settings/db/RowEditModal'
import { ConfirmDialog } from '@renderer/components/settings/db/ConfirmDialog'

const TABLES = [
  'cases',
  'captures',
  'tags',
  'capture_tags',
  'selectors',
  'selector_matches',
  'capture_favorites',
  'notes',
  'captures_fts',
  'notes_fts'
] as const

const FTS_TABLES = new Set(['captures_fts', 'notes_fts'])
const PAGE_SIZE = 50

export function DbTables() {
  const [selectedTable, setSelectedTable] = useState<string>('cases')
  const [data, setData] = useState<DbTableRowsResult | null>(null)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Modal state
  const [editModal, setEditModal] = useState<{
    open: boolean
    mode: 'create' | 'edit'
    row?: Record<string, unknown>
  }>({ open: false, mode: 'create' })

  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean
    pk: Record<string, string>
  }>({ open: false, pk: {} })

  const isFts = FTS_TABLES.has(selectedTable)
  const editableColumns = data?.columns.filter((c) => !c.pk) ?? []
  const canEditRows = !isFts && editableColumns.length > 0

  async function fetchRows() {
    setLoading(true)
    setError(null)
    try {
      const result = await window.birdbrain.db.tableRows({
        table: selectedTable,
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE
      })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rows')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setPage(0)
  }, [selectedTable])

  useEffect(() => {
    fetchRows()
  }, [selectedTable, page])

  function getPk(row: Record<string, unknown>): Record<string, string> {
    if (!data) return {}
    const pkCols = data.columns.filter((c) => c.pk)
    const pk: Record<string, string> = {}
    for (const col of pkCols) {
      pk[col.name] = String(row[col.name] ?? '')
    }
    return pk
  }

  async function handleSave(rowData: Record<string, unknown>) {
    try {
      if (editModal.mode === 'create') {
        await window.birdbrain.db.createRow({ table: selectedTable, data: rowData })
      } else {
        const pk = getPk(editModal.row!)
        const pkCols = data?.columns.filter((c) => c.pk).map((c) => c.name) ?? []
        // Only send changed fields (exclude PK columns)
        const changedData: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(rowData)) {
          if (!pkCols.includes(key)) {
            changedData[key] = value
          }
        }
        if (Object.keys(changedData).length === 0) {
          setEditModal({ open: false, mode: 'create' })
          fetchRows()
          return
        }
        await window.birdbrain.db.updateRow({ table: selectedTable, pk, data: changedData })
      }
      setEditModal({ open: false, mode: 'create' })
      fetchRows()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function handleDelete() {
    try {
      await window.birdbrain.db.deleteRow({ table: selectedTable, pk: deleteConfirm.pk })
      setDeleteConfirm({ open: false, pk: {} })
      fetchRows()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-text-muted">Table</label>
          <select
            value={selectedTable}
            onChange={(e) => setSelectedTable(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
          >
            {TABLES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {data && (
            <span className="text-xs text-text-faint">
              {data.total.toLocaleString()} row{data.total !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {!isFts && (
          <Button
            size="sm"
            onClick={() => setEditModal({ open: true, mode: 'create' })}
            className="gap-1"
          >
            <Plus size={12} />
            Create
          </Button>
        )}
      </div>

      {error && <div className="rounded-lg bg-red-900/20 p-3 text-sm text-red-400">{error}</div>}

      {loading && !data && <div className="text-sm text-text-muted">Loading...</div>}

      {data && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-elevated">
                  {data.columns.map((col) => (
                    <th
                      key={col.name}
                      className="whitespace-nowrap px-3 py-2 text-left font-medium text-text-muted"
                    >
                      {col.name}
                      {col.pk && <span className="ml-1 text-[9px] text-accent">PK</span>}
                    </th>
                  ))}
                  {!isFts && <th className="w-20 px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-border last:border-b-0 hover:bg-elevated/50"
                  >
                    {data.columns.map((col) => (
                      <td
                        key={col.name}
                        className="max-w-[200px] truncate whitespace-nowrap px-3 py-1.5 font-mono text-text-primary"
                        title={row[col.name] != null ? String(row[col.name]) : ''}
                      >
                        {row[col.name] != null ? (
                          String(row[col.name])
                        ) : (
                          <span className="text-text-faint">null</span>
                        )}
                      </td>
                    ))}
                    {canEditRows && (
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <div className="flex gap-1">
                          <button
                            onClick={() => setEditModal({ open: true, mode: 'edit', row })}
                            className="rounded p-1 text-text-muted hover:bg-elevated hover:text-accent"
                            title="Edit"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm({ open: true, pk: getPk(row) })}
                            className="rounded p-1 text-text-muted hover:bg-elevated hover:text-red-400"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={data.columns.length + (canEditRows ? 1 : 0)}
                      className="px-3 py-6 text-center text-text-faint"
                    >
                      No rows
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-text-faint">
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                <ChevronLeft size={14} />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        </>
      )}

      {data && canEditRows && (
        <RowEditModal
          open={editModal.open}
          mode={editModal.mode}
          table={selectedTable}
          columns={data.columns}
          initialData={editModal.row}
          onSave={handleSave}
          onClose={() => setEditModal({ open: false, mode: 'create' })}
        />
      )}

      <ConfirmDialog
        open={deleteConfirm.open}
        title="Delete Row"
        message={`Permanently delete this row from "${selectedTable}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirm({ open: false, pk: {} })}
      />
    </div>
  )
}
