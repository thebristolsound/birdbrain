import type { BirdbrainSettings } from '@shared/types'

interface StorageConfigProps {
  settings: BirdbrainSettings
  onUpdate: (partial: Partial<BirdbrainSettings>) => Promise<void>
}

export function StorageConfig({ settings, onUpdate }: StorageConfigProps) {
  return (
    <section className="neu-card rounded-2xl p-5">
      <h2 className="mb-4 text-lg font-semibold text-text-primary">Storage</h2>

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-text-muted">Storage Location</label>
          <div className="rounded bg-elevated px-3 py-2 font-mono text-sm text-text-muted">
            {settings.storagePath || 'Default'}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm text-text-muted">
            Max Storage (MB) — leave empty for unlimited
          </label>
          <input
            type="number"
            value={settings.maxStorageMb ?? ''}
            onChange={(e) =>
              onUpdate({ maxStorageMb: e.target.value ? parseInt(e.target.value) : null })
            }
            className="w-32 rounded border border-border-strong bg-elevated px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            placeholder="Unlimited"
            min={0}
          />
        </div>
      </div>
    </section>
  )
}
