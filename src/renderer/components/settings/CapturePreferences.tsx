import { useState } from 'react'
import type { BirdbrainSettings } from '@shared/types'
import { Card, CardContent, Input, Button, Label } from '@renderer/components/ui'

interface CapturePreferencesProps {
  settings: BirdbrainSettings
  onUpdate: (partial: Partial<BirdbrainSettings>) => Promise<void>
}

export function CapturePreferences({ settings, onUpdate }: CapturePreferencesProps) {
  const [newPattern, setNewPattern] = useState('')

  const addPattern = () => {
    if (!newPattern.trim()) return
    onUpdate({
      ignoredUrlPatterns: [...settings.ignoredUrlPatterns, newPattern.trim()]
    })
    setNewPattern('')
  }

  const removePattern = (index: number) => {
    onUpdate({
      ignoredUrlPatterns: settings.ignoredUrlPatterns.filter((_, i) => i !== index)
    })
  }

  return (
    <Card>
      <CardContent>
        <h2 className="mb-4 text-lg font-semibold text-text-primary">Capture Preferences</h2>

        <div className="space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.captureScreenshots}
              onChange={(e) => onUpdate({ captureScreenshots: e.target.checked })}
              className="rounded"
            />
            <span className="text-sm text-text-secondary">Capture screenshots</span>
          </label>

          {/* The session dedupe window is hidden for the same reason as the mode radio
              below: its only consumer is the commented-out background.ts:322, so moving the
              slider changes nothing. It governs the auto paths only — repeat manual captures
              are deduped server-side by MANUAL_DEDUPE_WINDOW_MS, which is unaffected. */}

          <div>
            <Label>Ignored URL patterns</Label>
            <div className="mb-2 flex gap-2">
              <Input
                type="text"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPattern()}
                className="flex-1 py-1.5 font-mono"
                placeholder="e.g. *.google.com or facebook.com"
              />
              <Button variant="ghost" size="sm" onClick={addPattern}>
                Add
              </Button>
            </div>
            <p className="mb-2 text-xs text-text-muted">
              Substring (<code className="text-text-muted">google.com</code>), wildcards (
              <code className="text-text-muted">*.facebook.com*</code>), or regex (
              <code className="text-text-muted">/pattern/i</code>)
            </p>
            <div className="space-y-1">
              {settings.ignoredUrlPatterns.map((pattern, i) => (
                <div
                  key={pattern}
                  className="flex items-center justify-between rounded bg-elevated px-2 py-1"
                >
                  <span className="font-mono text-xs text-text-muted">{pattern}</span>
                  <button
                    onClick={() => removePattern(i)}
                    className="text-xs text-text-muted hover:text-red-400"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* The selector auto-capture mode radio is not rendered while auto-capture is
              out of service. Both auto paths in extension/src/background.ts are commented
              out behind HOTFIX markers (#211), so every mode behaves as 'notify' — selector
              matches update the extension badge and nothing is captured. The stored setting
              and its schema are left untouched, so restoring the control is a revert rather
              than a migration. See #570; #571 tracks whether auto-capture returns at all. */}
        </div>
      </CardContent>
    </Card>
  )
}
