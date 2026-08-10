import { useState } from 'react'
import type { BirdbrainSettings } from '@shared/types'
import { Card, CardContent, Button, Label } from '@renderer/components/ui'
import { chooseStoragePath } from '@renderer/lib/api/system'

interface StorageConfigProps {
  settings: BirdbrainSettings
  onUpdate: (partial: Partial<BirdbrainSettings>) => Promise<void>
}

// Inline detail, not a durable log: the message may carry a filesystem path,
// which is fine here (the card already prints the path verbatim) but must not
// be serialised — persist failures are already durably logged path-free by the
// mutation cache's mutation.failed entry.
function describeFailure(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err)
  return detail
    ? `Couldn't update the storage location — ${detail}`
    : "Couldn't update the storage location"
}

export function StorageConfig({ settings, onUpdate }: StorageConfigProps) {
  const [restartNeeded, setRestartNeeded] = useState(false)
  const [actionError, setActionError] = useState('')

  // restartNeeded must only flip after the write has persisted: a rejected
  // onUpdate skips it, so the notice never advertises a change that was
  // never saved.
  const persistStoragePath = async (storagePath: string) => {
    await onUpdate({ storagePath })
    setRestartNeeded(true)
  }

  const handleBrowse = async () => {
    setActionError('')
    try {
      const path = await chooseStoragePath()
      // null means the dialog was cancelled — not a failure, nothing to report
      if (path) await persistStoragePath(path)
    } catch (err) {
      setActionError(describeFailure(err))
    }
  }

  const handleReset = async () => {
    setActionError('')
    try {
      await persistStoragePath('')
    } catch (err) {
      setActionError(describeFailure(err))
    }
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

          {actionError && (
            <div
              role="alert"
              className="rounded bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-400"
            >
              {actionError}
            </div>
          )}

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
