import { useState, useEffect, useRef, useId } from 'react'
import { v4 as uuid } from 'uuid'
import { X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Input,
  Label
} from '@renderer/components/ui'

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
  const idPrefix = useId()

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
    if (open) closeBtnRef.current?.focus()
  }, [open])

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
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        onClose={onClose}
        className="max-h-[80vh] max-w-lg overflow-y-auto"
        aria-labelledby="row-edit-modal-title"
      >
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle id="row-edit-modal-title">
              {mode === 'create' ? 'Create Row' : 'Edit Row'} &mdash; {table}
            </DialogTitle>
            <Button
              ref={closeBtnRef}
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close row editor"
            >
              <X size={18} />
            </Button>
          </div>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {columns.map((col) => (
            <div key={col.name}>
              <Label
                htmlFor={`${idPrefix}-${col.name}`}
                className="text-xs font-medium text-text-secondary"
              >
                {col.name}
                {col.pk && <span className="ml-1 text-[10px] text-accent font-bold">PK</span>}
                <span className="ml-1 text-[10px] text-text-faint">{col.type}</span>
              </Label>
              <Input
                id={`${idPrefix}-${col.name}`}
                type={inputType(col)}
                value={formData[col.name] ?? ''}
                onChange={(e) => setFormData((prev) => ({ ...prev, [col.name]: e.target.value }))}
                readOnly={mode === 'edit' && col.pk}
                step={col.type === 'REAL' ? 'any' : undefined}
                className={
                  mode === 'edit' && col.pk ? 'bg-elevated text-text-muted cursor-not-allowed' : ''
                }
              />
            </div>
          ))}
          <DialogFooter className="pt-3">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{mode === 'create' ? 'Create' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
