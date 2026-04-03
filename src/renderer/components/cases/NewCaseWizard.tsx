import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useCasesMutations } from '@renderer/lib/queries'
import { FolderPlus, Bitcoin, Bug, ShieldAlert, Settings2, ArrowLeft } from 'lucide-react'

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

const CASE_TYPES = [
  { id: 'crypto' as const, label: 'Crypto', icon: Bitcoin },
  { id: 'malware' as const, label: 'Malware', icon: Bug },
  { id: 'fraud' as const, label: 'Fraud', icon: ShieldAlert },
  { id: 'custom' as const, label: 'Custom', icon: Settings2 }
]

export function NewCaseWizard() {
  const navigate = useNavigate()
  const { create } = useCasesMutations()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [caseType, setCaseType] = useState<'crypto' | 'malware' | 'fraud' | 'custom'>('custom')
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
        type: caseType
      })

      for (const presetId of selectedSelectors) {
        const preset = SELECTOR_PRESETS.find((p) => p.id === presetId)
        if (preset) {
          await window.birdbrain.selectors.create({
            caseId: newCase.id,
            pattern: preset.pattern,
            isRegex: preset.isRegex,
            label: preset.label
          })
        }
      }

      navigate({ to: '/cases/$caseId', params: { caseId: newCase.id } })
    } catch {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl py-12 px-6">
      {/* Progress indicator */}
      <div className="mb-8 flex items-center justify-center gap-2">
        <div className="h-2 w-8 rounded-full bg-indigo-500" />
        <div className="h-2 w-2 rounded-full bg-white/[0.15]" />
        <div className="h-2 w-2 rounded-full bg-white/[0.15]" />
      </div>

      {/* Card */}
      <div className="neu-card rounded-2xl p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10">
            <FolderPlus className="h-5 w-5 text-indigo-400" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-white">New Investigation</h2>
            <p className="text-sm text-slate-400">Set up your case details</p>
          </div>
        </div>

        {/* Investigation Name */}
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Investigation Name
          </label>
          <input
            data-testid="case-name-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Phishing Campaign Analysis"
            className="w-full rounded-xl border border-white/[0.08] bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
            autoFocus
          />
        </div>

        {/* Description */}
        <div className="mb-6">
          <label className="mb-1.5 block text-sm font-medium text-slate-300">Description</label>
          <textarea
            data-testid="case-description-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of this investigation..."
            rows={3}
            className="w-full resize-none rounded-xl border border-white/[0.08] bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        {/* Investigation Type */}
        <div className="mb-6">
          <label className="mb-3 block text-sm font-medium text-slate-300">
            Investigation Type
          </label>
          <div className="grid grid-cols-2 gap-3">
            {CASE_TYPES.map((t) => {
              const Icon = t.icon
              const selected = caseType === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setCaseType(t.id)}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
                    selected
                      ? 'border-indigo-500 bg-indigo-500/10'
                      : 'border-white/[0.08] bg-slate-800 hover:border-white/[0.15]'
                  }`}
                >
                  <Icon className={`h-5 w-5 ${selected ? 'text-indigo-400' : 'text-slate-400'}`} />
                  <span
                    className={`text-sm font-medium ${selected ? 'text-white' : 'text-slate-300'}`}
                  >
                    {t.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Initial Selectors */}
        <div className="mb-8">
          <label className="mb-3 block text-sm font-medium text-slate-300">Initial Selectors</label>
          <div className="flex flex-wrap gap-2">
            {SELECTOR_PRESETS.map((preset) => {
              const selected = selectedSelectors.includes(preset.id)
              return (
                <button
                  key={preset.id}
                  onClick={() => toggleSelector(preset.id)}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                    selected
                      ? 'bg-indigo-500/10 border-indigo-500/25 text-white'
                      : 'bg-slate-800 border-white/[0.08] text-slate-400 hover:border-white/[0.15] hover:text-slate-300'
                  }`}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/[0.06] pt-6">
          <button
            onClick={() => navigate({ to: '/' })}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Cancel
          </button>
          <button
            data-testid="case-create-btn"
            onClick={handleSubmit}
            disabled={!name.trim() || submitting}
            className="rounded-xl bg-indigo-600 px-6 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creating...' : 'Create Case'}
          </button>
        </div>
      </div>
    </div>
  )
}
