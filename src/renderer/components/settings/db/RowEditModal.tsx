import { useState, useEffect, useRef } from 'react'
import { v4 as uuid } from 'uuid'
import { X } from 'lucide-react'

interface ColumnInfo {
  name: string
  type: string
  pk: boolean
}

interface RowEditModalProps {
  open: boolean
  mode: 'create' | 'edit'
  table: string
  columns: ColumnInfo[]
  initialData?: Record<string, unknown>
  onSave: (data: Record<string, unknown>) => void
  onClose: () => void
}

export function RowEditModal({
  open,
  mode,
  table,
  columns,
  initialData,
  onSave,
  onClose
}: RowEditModalProps) {
  const [formData, setFormData] = useState<Record<string, string>>({})
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const titleId = 'row-edit-modal-title'

  useEffect(() => {
    if (!open) return
    const data: Record<string, string> = {}
    for (const col of columns) {
      if (mode === 'edit' && initialData) {
        data[col.name] = initialData[col.name] != null ? String(initialData[col.name]) : ''
      } else if (mode === 'create' && col.pk && col.name === 'id') {
        data[col.name] = uuid()
      } else {
        data[col.name] = ''
      }
    }
    setFormData(data)
  }, [open, mode, columns, initialData])

  useEffect(() => {
    if (!open) return
    closeBtnRef.current?.focus()
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsed: Record<string, unknown> = {}
    for (const col of columns) {
      const val = formData[col.name]
      if (val === '') {
        parsed[col.name] = null
      } else if (col.type.includes('INT') || col.type === 'REAL') {
        parsed[col.name] = Number(val)
      } else {
        parsed[col.name] = val
      }
    }
    onSave(parsed)
  }

  function inputType(col: ColumnInfo): string {
    if (col.type.includes('INT') || col.type === 'REAL') return 'number'
    return 'text'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl border border-border bg-canvas p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 id={titleId} className="text-lg font-semibold text-text-primary">
            {mode === 'create' ? 'Create Row' : 'Edit Row'} &mdash; {table}
          </h3>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="Close row editor"
            className="text-text-muted hover:text-text-primary"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          {columns.map((col) => (
            <div key={col.name}>
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                {col.name}
                {col.pk && (
                  <span className="ml-1 text-[10px] text-accent font-bold">PK</span>
                )}
                <span className="ml-1 text-[10px] text-text-faint">{col.type}</span>
              </label>
              <input
                type={inputType(col)}
                value={formData[col.name] ?? ''}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, [col.name]: e.target.value }))
                }
                readOnly={mode === 'edit' && col.pk}
                step={col.type === 'REAL' ? 'any' : undefined}
                className={`w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent ${
                  mode === 'edit' && col.pk
                    ? 'bg-elevated text-text-muted cursor-not-allowed'
                    : ''
                }`}
              />
            </div>
          ))}
          <div className="flex justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-text-muted hover:bg-elevated"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              {mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
