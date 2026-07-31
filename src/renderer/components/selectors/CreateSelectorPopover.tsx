import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, Input, Label } from '@renderer/components/ui'
import { useSelectorsMutations } from '@renderer/lib/queries'

interface CreateSelectorPopoverProps {
  caseId: string
  defaultValue: string
  defaultLabel: string
  onClose: () => void
}

export function CreateSelectorPopover({
  caseId,
  defaultValue,
  defaultLabel,
  onClose
}: CreateSelectorPopoverProps) {
  const [pattern, setPattern] = useState(defaultValue)
  const [label, setLabel] = useState(defaultLabel)
  const { create } = useSelectorsMutations(caseId)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  async function handleCreate() {
    if (!pattern.trim()) return
    await create.mutateAsync({
      caseId,
      pattern: pattern.trim(),
      isRegex: false,
      label: label.trim() || undefined
    })
    onClose()
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border border-border-strong bg-elevated p-3 shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="space-y-3">
        <div>
          <Label className="text-xs font-medium">Label</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Selector label"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </div>
        <div>
          <Label className="text-xs font-medium">Value</Label>
          <Input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="Selector value"
            className="font-mono"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!pattern.trim() || create.isPending}
            className="gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            {create.isPending ? '...' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  )
}
