import { useState } from 'react'
import type { BirdbrainSettings } from '@shared/types'
import { Card, CardContent, Button, Label } from '@renderer/components/ui'

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
    <Card>
      <CardContent>
        <h2 className="mb-4 text-lg font-semibold text-text-primary">Storage</h2>

        <div className="space-y-4">
          <div>
            <Label>Storage Location</Label>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded bg-elevated px-3 py-2 font-mono text-sm text-text-muted">
                {settings.storagePath || 'Default'}
              </div>
              <Button variant="outline" size="sm" onClick={handleBrowse}>
                Browse...
              </Button>
              {settings.storagePath && (
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  Reset
                </Button>
              )}
            </div>
          </div>

          {restartNeeded && (
            <div className="rounded bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-400">
              Restart required for storage location change to take effect.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
