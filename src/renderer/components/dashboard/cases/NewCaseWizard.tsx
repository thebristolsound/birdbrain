import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useCasesMutations, useSettingsMutations } from '@renderer/lib/queries'
import { createSelector } from '@renderer/lib/api/selectors'
import { notify } from '@renderer/lib/notify'
import { FolderPlus, ArrowLeft } from 'lucide-react'
import { Card, Button, Input, Textarea, Label } from '@renderer/components/ui'

const SELECTOR_PRESETS = [
  {
    id: 'email',
    label: 'Email Addresses',
    pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
    isRegex: true
  },
  {
    id: 'crypto',
    label: 'Crypto Addresses',
    pattern: '(0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-zA-HJ-NP-Z0-9]{39,59})',
    isRegex: true
  },
  {
    id: 'ip',
    label: 'IP Addresses',
    pattern: '\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b',
    isRegex: true
  },
  {
    id: 'domain',
    label: 'Domain Names',
    pattern: '\\b[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\\.[a-zA-Z]{2,})+\\b',
    isRegex: true
  },
  {
    id: 'phone',
    label: 'Phone Numbers',
    pattern: '\\+?\\d{1,4}[-.\\s]?\\(?\\d{1,3}\\)?[-.\\s]?\\d{1,4}[-.\\s]?\\d{1,9}',
    isRegex: true
  },
  { id: 'username', label: 'Usernames', pattern: '@[a-zA-Z0-9_]{1,15}', isRegex: true }
]

export function NewCaseWizard() {
  const navigate = useNavigate()
  const { create } = useCasesMutations()
  const { update: updateSettings } = useSettingsMutations()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedSelectors, setSelectedSelectors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const toggleSelector = (id: string) => {
    setSelectedSelectors((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    )
  }

  const handleSubmit = async () => {
    if (!name.trim() || submitting) return
    setSubmitting(true)

    try {
      const newCase = await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        type: 'custom'
      })

      await updateSettings.mutateAsync({ hasCompletedOnboarding: true })

      let armed = 0
      for (const presetId of selectedSelectors) {
        const preset = SELECTOR_PRESETS.find((p) => p.id === presetId)
        if (preset) {
          await createSelector({
            caseId: newCase.id,
            pattern: preset.pattern,
            isRegex: preset.isRegex,
            label: preset.label,
            origin: 'manual'
          })
          armed++
        }
      }

      notify.success('Investigation created', {
        description: `“${name.trim()}” is ready — ${armed} selector${armed === 1 ? '' : 's'} armed.`
      })
      navigate({ to: '/cases/$caseId', params: { caseId: newCase.id } })
    } catch {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl py-12 px-6">
      {/* Progress indicator */}
      <div className="mb-8 flex items-center justify-center gap-2">
        <div className="h-2 w-8 rounded-full bg-accent" />
        <div className="h-2 w-2 rounded-full bg-elevated" />
        <div className="h-2 w-2 rounded-full bg-elevated" />
      </div>

      {/* Card */}
      <Card className="p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-subtle">
            <FolderPlus className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-text-primary">New Investigation</h2>
            <p className="text-sm text-text-muted">Set up your case details</p>
          </div>
        </div>

        {/* Investigation Name */}
        <div className="mb-4">
          <Label className="mb-1.5 text-sm font-medium text-text-secondary">
            Investigation Name
          </Label>
          <Input
            data-testid="case-name-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Phishing Campaign Analysis"
            className="px-3 py-2 text-sm placeholder:text-text-muted"
            autoFocus
          />
        </div>

        {/* Description */}
        <div className="mb-6">
          <Label className="mb-1.5 text-sm font-medium text-text-secondary">Description</Label>
          {/* Recessed fill, not the V1 note's bg-elevated (#563): the V2 handoff bundle
              (prototype/design-handoff-2026-08, style_sync_patch/SCREEN_NOTES.md "New case
              wizard") rules this textarea "6px, recessed fill", and HANDOFF.md defines
              recessed as bg-canvas + border-border-strong — it "replaces the
              elevated/surface/canvas mix". The primitive already bases on that; the call
              site adds only the wizard's 14px density and rounded-xl, which the globals.css
              radius collapse aliases to the ruled 6px. The name Input above keeps 4px. */}
          <Textarea
            data-testid="case-description-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of this investigation..."
            rows={3}
            className="resize-none rounded-xl px-3 py-2 text-sm placeholder:text-text-muted"
          />
        </div>

        {/* Initial Selectors */}
        <div className="mb-8">
          <label className="mb-3 block text-sm font-medium text-text-secondary">
            Initial Selectors
          </label>
          <div className="flex flex-wrap gap-2">
            {SELECTOR_PRESETS.map((preset) => {
              const selected = selectedSelectors.includes(preset.id)
              return (
                <button
                  key={preset.id}
                  onClick={() => toggleSelector(preset.id)}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                    selected
                      ? 'bg-accent-subtle border-accent/25 text-text-primary'
                      : 'bg-elevated border-border-strong text-text-muted hover:border-accent/30 hover:text-text-secondary'
                  }`}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border pt-6">
          <Button
            variant="ghost"
            onClick={() => navigate({ to: '/' })}
            className="gap-2 rounded-xl"
          >
            <ArrowLeft className="h-4 w-4" />
            Cancel
          </Button>
          <Button
            data-testid="case-create-btn"
            onClick={handleSubmit}
            disabled={!name.trim() || submitting}
            className="rounded-xl px-6 shadow-lg shadow-accent/20"
          >
            {submitting ? 'Creating...' : 'Create Case'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
