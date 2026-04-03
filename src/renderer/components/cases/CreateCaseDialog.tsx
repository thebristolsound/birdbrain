import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useCasesMutations } from '@renderer/lib/queries'

interface CreateCaseDialogProps {
  onClose: () => void
}

export function CreateCaseDialog({ onClose }: CreateCaseDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const { create } = useCasesMutations()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const newCase = await create.mutateAsync({
      name: name.trim(),
      description: description.trim() || undefined
    })
    navigate({ to: '/cases/$caseId', params: { caseId: newCase.id } })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-96 rounded-lg border border-border-strong bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-text-primary">New Case</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-text-muted">Name</label>
            <input
              data-testid="case-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-border-strong bg-elevated px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
              placeholder="Investigation name..."
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-text-muted">Description (optional)</label>
            <textarea
              data-testid="case-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded border border-border-strong bg-elevated px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
              placeholder="What is this investigation about?"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-sm text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              data-testid="case-create-btn"
              type="submit"
              disabled={!name.trim()}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
