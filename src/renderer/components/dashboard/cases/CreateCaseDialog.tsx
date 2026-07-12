import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { useCasesMutations } from '@renderer/lib/api/cases'
import { presets } from '@renderer/lib/motion'
import { Button, Input, Textarea, Label } from '@renderer/components/ui'

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
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      {...presets.overlay}
    >
      <motion.div
        className="w-96 rounded-lg border border-border-strong bg-card p-6"
        onClick={(e) => e.stopPropagation()}
        {...presets.modal}
      >
        <h2 className="mb-4 text-lg font-semibold text-text-primary">New Case</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input
              data-testid="case-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Investigation name..."
              autoFocus
            />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Textarea
              data-testid="case-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this investigation about?"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button data-testid="case-create-btn" type="submit" size="sm" disabled={!name.trim()}>
              Create
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
