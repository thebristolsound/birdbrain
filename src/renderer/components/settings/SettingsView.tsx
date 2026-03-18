import { useState, useEffect } from 'react'
import type { BirdbrainSettings } from '@shared/types'
import { AIConfig } from './AIConfig'
import { EntityExtractionConfig } from './EntityExtractionConfig'
import { CapturePreferences } from './CapturePreferences'
import { StorageConfig } from './StorageConfig'
import { AppearanceConfig } from './AppearanceConfig'
import { About } from './About'
import { Key, Fingerprint, Camera, HardDrive, Palette, Info } from 'lucide-react'

type SettingsTab = 'ai' | 'entities' | 'capture' | 'storage' | 'appearance' | 'about'

const settingsTabs: { id: SettingsTab; label: string; icon: typeof Key }[] = [
  { id: 'ai', label: 'API Keys', icon: Key },
  { id: 'entities', label: 'Entity Extraction', icon: Fingerprint },
  { id: 'capture', label: 'Capture', icon: Camera },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'about', label: 'About', icon: Info }
]

export function SettingsView() {
  const [settings, setSettings] = useState<BirdbrainSettings | null>(null)
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai')

  useEffect(() => {
    window.birdbrain.settings.get().then(setSettings)
  }, [])

  const handleUpdate = async (partial: Partial<BirdbrainSettings>) => {
    const updated = await window.birdbrain.settings.update(partial)
    setSettings(updated)
  }

  if (!settings) return <div className="text-slate-500">Loading settings...</div>

  const renderContent = () => {
    switch (activeTab) {
      case 'ai':
        return <AIConfig settings={settings} onUpdate={handleUpdate} />
      case 'entities':
        return <EntityExtractionConfig settings={settings} onUpdate={handleUpdate} />
      case 'capture':
        return <CapturePreferences settings={settings} onUpdate={handleUpdate} />
      case 'storage':
        return <StorageConfig settings={settings} onUpdate={handleUpdate} />
      case 'appearance':
        return <AppearanceConfig />
      case 'about':
        return <About />
    }
  }

  return (
    <div className="flex h-full">
      <nav className="w-48 shrink-0 border-r border-white/[0.06] p-3">
        <div className="space-y-1">
          {settingsTabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm rounded-lg ${
                activeTab === id
                  ? 'bg-indigo-500/15 text-indigo-400 font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      </nav>
      <div className="flex-1 p-6 overflow-y-auto">
        {renderContent()}
      </div>
    </div>
  )
}
