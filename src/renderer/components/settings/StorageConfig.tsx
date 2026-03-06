import type { BirdbrainSettings } from '@shared/types'

interface StorageConfigProps {
  settings: BirdbrainSettings
  onUpdate: (partial: Partial<BirdbrainSettings>) => Promise<void>
}

export function StorageConfig({ settings, onUpdate }: StorageConfigProps) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-4 text-lg font-semibold text-neutral-200">Storage</h2>

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-neutral-400">Storage Location</label>
          <div className="rounded bg-neutral-800 px-3 py-2 font-mono text-sm text-neutral-400">
            {settings.storagePath || 'Default'}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm text-neutral-400">
            Max Storage (MB) — leave empty for unlimited
          </label>
          <input
            type="number"
            value={settings.maxStorageMb ?? ''}
            onChange={(e) =>
              onUpdate({ maxStorageMb: e.target.value ? parseInt(e.target.value) : null })
            }
            className="w-32 rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-amber-600"
            placeholder="Unlimited"
            min={0}
          />
        </div>
      </div>
    </section>
  )
}
