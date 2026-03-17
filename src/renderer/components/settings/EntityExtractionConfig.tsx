import type { BirdbrainSettings, EntityType } from '@shared/types'

interface EntityExtractionConfigProps {
  settings: BirdbrainSettings
  onUpdate: (partial: Partial<BirdbrainSettings>) => Promise<void>
}

const ENTITY_TYPE_LABELS: Array<{ type: EntityType; label: string; method: 'regex' | 'nlp' }> = [
  { type: 'email', label: 'Email Addresses', method: 'regex' },
  { type: 'phone', label: 'Phone Numbers', method: 'regex' },
  { type: 'domain', label: 'Domains', method: 'regex' },
  { type: 'ip_address', label: 'IP Addresses', method: 'regex' },
  { type: 'username', label: 'Usernames / Handles', method: 'regex' },
  { type: 'crypto_wallet', label: 'Crypto Wallets', method: 'regex' },
  { type: 'person', label: 'Person Names', method: 'nlp' },
  { type: 'organization', label: 'Organizations', method: 'nlp' },
  { type: 'date', label: 'Dates', method: 'nlp' }
]

export function EntityExtractionConfig({ settings, onUpdate }: EntityExtractionConfigProps) {
  const enabledTypes = settings.enabledEntityTypes || []
  const confidence = settings.minEntityConfidence ?? 0.5

  const toggleType = (type: EntityType) => {
    const updated = enabledTypes.includes(type)
      ? enabledTypes.filter(t => t !== type)
      : [...enabledTypes, type]
    onUpdate({ enabledEntityTypes: updated })
  }

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-4 text-lg font-semibold text-neutral-200">Entity Extraction</h2>
      <p className="mb-4 text-sm text-neutral-400">
        Rule-based extraction runs automatically on every capture without requiring an AI API key.
      </p>

      <div className="mb-5">
        <label className="mb-2 block text-sm text-neutral-400">Enabled Entity Types</label>
        <div className="grid grid-cols-2 gap-2">
          {ENTITY_TYPE_LABELS.map(({ type, label, method }) => (
            <label key={type} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enabledTypes.includes(type)}
                onChange={() => toggleType(type)}
                className="rounded"
              />
              <span className="text-sm text-neutral-300">{label}</span>
              {method === 'nlp' && (
                <span className="rounded bg-amber-900/50 px-1.5 py-0.5 text-xs text-amber-400">
                  NLP
                </span>
              )}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm text-neutral-400">
          Minimum Confidence Threshold: {Math.round(confidence * 100)}%
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(confidence * 100)}
          onChange={(e) => onUpdate({ minEntityConfidence: Number(e.target.value) / 100 })}
          className="w-full accent-amber-600"
        />
        <div className="mt-1 flex justify-between text-xs text-neutral-500">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>
    </section>
  )
}
