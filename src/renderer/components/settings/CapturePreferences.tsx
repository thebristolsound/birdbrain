import { useState } from 'react'
import type { BirdbrainSettings, AutoCaptureMode } from '@shared/types'
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

          <div>
            <Label>Dedupe window: {settings.dedupeWindowSeconds}s</Label>
            <input
              type="range"
              min={0}
              max={300}
              value={settings.dedupeWindowSeconds}
              onChange={(e) => onUpdate({ dedupeWindowSeconds: parseInt(e.target.value) })}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-text-muted">
              <span>0s (off)</span>
              <span>300s</span>
            </div>
          </div>

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

          <div>
            <Label>Selector auto-capture mode</Label>
            <div className="space-y-1">
              {(
                [
                  ['auto', 'Auto-capture', 'Automatically capture pages with selector matches'],
                  ['notify', 'Notify only', 'Show a notification when matches are found'],
                  ['per-case', 'Per-case', 'Configure capture behavior per case']
                ] as [AutoCaptureMode, string, string][]
              ).map(([value, label, desc]) => (
                <label
                  key={value}
                  className="flex items-start gap-2 cursor-pointer rounded p-1.5 hover:bg-elevated"
                >
                  <input
                    type="radio"
                    name="autoCaptureMode"
                    value={value}
                    checked={settings.autoCaptureMode === value}
                    onChange={() => onUpdate({ autoCaptureMode: value })}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm text-text-secondary">{label}</div>
                    <div className="text-xs text-text-muted">{desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
