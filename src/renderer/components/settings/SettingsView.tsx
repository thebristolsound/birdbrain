import { useState, useEffect } from 'react'
import type { BirdbrainSettings } from '@shared/types'
import { AIConfig } from './AIConfig'
import { CapturePreferences } from './CapturePreferences'
import { StorageConfig } from './StorageConfig'
import { AppearanceConfig } from './AppearanceConfig'
import { OperatorConfig } from './OperatorConfig'
import { About } from './About'
import { Key, Camera, HardDrive, Palette, Info, UserCircle, Database, X } from 'lucide-react'
import { useRouter } from '@tanstack/react-router'
import { DatabaseAdmin } from './DatabaseAdmin'

type SettingsTab = 'ai' | 'capture' | 'storage' | 'appearance' | 'operator' | 'database' | 'about'

const settingsTabs: { id: SettingsTab; label: string; icon: typeof Key }[] = [
  { id: 'ai', label: 'API Keys', icon: Key },
  { id: 'capture', label: 'Capture', icon: Camera },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'operator', label: 'Operator', icon: UserCircle },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'about', label: 'About', icon: Info }
]

export function SettingsView() {
  const router = useRouter()
  const [settings, setSettings] = useState<BirdbrainSettings | null>(null)
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai')

  useEffect(() => {
    window.birdbrain.settings.get().then(setSettings)
  }, [])

  // Persist settings as active section for session restore
  useEffect(() => {
    window.birdbrain.settings.update({ lastActiveSection: 'settings' })
  }, [])

  const handleUpdate = async (partial: Partial<BirdbrainSettings>) => {
    const updated = await window.birdbrain.settings.update(partial)
    setSettings(updated)
  }

  if (!settings) return <div className="text-text-muted">Loading settings...</div>

  const renderContent = () => {
    switch (activeTab) {
      case 'ai':
        return <AIConfig />
      case 'capture':
        return <CapturePreferences settings={settings} onUpdate={handleUpdate} />
      case 'storage':
        return <StorageConfig settings={settings} onUpdate={handleUpdate} />
      case 'appearance':
        return <AppearanceConfig />
      case 'operator':
        return <OperatorConfig />
      case 'database':
        return <DatabaseAdmin />
      case 'about':
        return <About />
    }
  }

  return (
    <div className="relative flex h-full">
      {/* Dismiss button */}
      <button
        onClick={() => router.history.back()}
        className="absolute right-4 top-4 z-10 flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-primary transition-colors"
        title="Close settings"
      >
        <X className="h-4 w-4" />
      </button>

      <nav className="w-48 shrink-0 border-r border-border p-3">
        <div className="space-y-1">
          {settingsTabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm rounded-lg ${
                activeTab === id
                  ? 'bg-accent-subtle text-accent font-semibold'
                  : 'text-text-muted hover:text-text-primary hover:bg-elevated'
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      </nav>
      <div className="flex-1 p-6 overflow-y-auto">{renderContent()}</div>
    </div>
  )
}
