import { useState, useEffect } from 'react'
import type { BirdbrainSettings } from '@shared/types'
import { AIConfig } from './AIConfig'
import { CapturePreferences } from './CapturePreferences'
import { StorageConfig } from './StorageConfig'
import { About } from './About'

export function SettingsView() {
  const [settings, setSettings] = useState<BirdbrainSettings | null>(null)

  useEffect(() => {
    window.birdbrain.settings.get().then(setSettings)
  }, [])

  const handleUpdate = async (partial: Partial<BirdbrainSettings>) => {
    const updated = await window.birdbrain.settings.update(partial)
    setSettings(updated)
  }

  if (!settings) return <div className="text-neutral-500">Loading settings...</div>

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold text-neutral-100">Settings</h1>
      <AIConfig settings={settings} onUpdate={handleUpdate} />
      <CapturePreferences settings={settings} onUpdate={handleUpdate} />
      <StorageConfig settings={settings} onUpdate={handleUpdate} />
      <About />
    </div>
  )
}
