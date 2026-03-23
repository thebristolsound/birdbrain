import { useState } from 'react'
import type { BirdbrainSettings, AutoCaptureMode } from '@shared/types'

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
    <section className="neu-card rounded-2xl p-5">
      <h2 className="mb-4 text-lg font-semibold text-slate-200">Capture Preferences</h2>

      <div className="space-y-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.captureScreenshots}
            onChange={(e) => onUpdate({ captureScreenshots: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm text-slate-300">Capture screenshots</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.captureHtml}
            onChange={(e) => onUpdate({ captureHtml: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm text-slate-300">Capture HTML</span>
        </label>

        <div>
          <label className="mb-1 block text-sm text-slate-400">
            Dedupe window: {settings.dedupeWindowSeconds}s
          </label>
          <input
            type="range"
            min={0}
            max={300}
            value={settings.dedupeWindowSeconds}
            onChange={(e) => onUpdate({ dedupeWindowSeconds: parseInt(e.target.value) })}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-slate-500">
            <span>0s (off)</span>
            <span>300s</span>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-400">Ignored URL patterns</label>
          <div className="mb-2 flex gap-2">
            <input
              type="text"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addPattern()}
              className="flex-1 rounded border border-white/[0.08] bg-slate-800 px-3 py-1.5 font-mono text-sm text-white outline-none focus:border-indigo-500"
              placeholder="e.g. *.google.com or facebook.com"
            />
            <button
              onClick={addPattern}
              className="rounded bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/[0.06]"
            >
              Add
            </button>
          </div>
          <p className="mb-2 text-xs text-slate-500">
            Substring (<code className="text-slate-400">google.com</code>), wildcards (
            <code className="text-slate-400">*.facebook.com*</code>), or regex (
            <code className="text-slate-400">/pattern/i</code>)
          </p>
          <div className="space-y-1">
            {settings.ignoredUrlPatterns.map((pattern, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded bg-slate-800 px-2 py-1"
              >
                <span className="font-mono text-xs text-slate-400">{pattern}</span>
                <button
                  onClick={() => removePattern(i)}
                  className="text-xs text-slate-500 hover:text-red-400"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-400">Selector auto-capture mode</label>
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
                className="flex items-start gap-2 cursor-pointer rounded p-1.5 hover:bg-white/[0.06]"
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
                  <div className="text-sm text-slate-300">{label}</div>
                  <div className="text-xs text-slate-500">{desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
