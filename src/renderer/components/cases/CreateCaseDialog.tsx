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
        className="w-96 rounded-lg border border-neutral-700 bg-neutral-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-neutral-100">New Case</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-neutral-400">Name</label>
            <input
              data-testid="case-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-amber-600"
              placeholder="Investigation name..."
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-neutral-400">Description (optional)</label>
            <textarea
              data-testid="case-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-amber-600"
              placeholder="What is this investigation about?"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200"
            >
              Cancel
            </button>
            <button
              data-testid="case-create-btn"
              type="submit"
              disabled={!name.trim()}
              className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
