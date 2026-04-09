import { useState } from 'react'
import type { BirdbrainSettings } from '@shared/types'

interface StorageConfigProps {
  settings: BirdbrainSettings
  onUpdate: (partial: Partial<BirdbrainSettings>) => Promise<void>
}

export function StorageConfig({ settings, onUpdate }: StorageConfigProps) {
  const [restartNeeded, setRestartNeeded] = useState(false)

  const handleBrowse = async () => {
    const path = await window.birdbrain.settings.chooseStoragePath()
    if (path) {
      await onUpdate({ storagePath: path })
      setRestartNeeded(true)
    }
  }

  const handleReset = async () => {
    await onUpdate({ storagePath: '' })
    setRestartNeeded(true)
  }

  return (
    <section className="neu-card rounded-2xl p-5">
      <h2 className="mb-4 text-lg font-semibold text-text-primary">Storage</h2>

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-text-muted">Storage Location</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded bg-elevated px-3 py-2 font-mono text-sm text-text-muted">
              {settings.storagePath || 'Default'}
            </div>
            <button
              onClick={handleBrowse}
              className="rounded bg-elevated px-3 py-2 text-sm text-text-secondary hover:bg-surface"
            >
              Browse...
            </button>
            {settings.storagePath && (
              <button
                onClick={handleReset}
                className="rounded bg-elevated px-3 py-2 text-sm text-text-muted hover:text-red-400"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {restartNeeded && (
          <div className="rounded bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-400">
            Restart required for storage location change to take effect.
          </div>
        )}
      </div>
    </section>
  )
}
