import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { settingsQueryOptions, useSettingsMutations } from '@renderer/lib/queries'
import type { BirdbrainSettings } from '@shared/types'
import { AIConfig } from '@renderer/components/settings/AIConfig'
import { CapturePreferences } from '@renderer/components/settings/CapturePreferences'
import { StorageConfig } from '@renderer/components/settings/StorageConfig'
import { AppearanceConfig } from '@renderer/components/settings/AppearanceConfig'
import { OperatorConfig } from '@renderer/components/settings/OperatorConfig'
import { UpdatesConfig } from '@renderer/components/settings/UpdatesConfig'
import { About } from '@renderer/components/settings/About'
import { Key, Camera, HardDrive, Palette, Info, UserCircle, Database, RefreshCw } from 'lucide-react'
import { DatabaseAdmin } from '@renderer/components/settings/DatabaseAdmin'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@renderer/components/ui'

type SettingsTab =
  | 'ai'
  | 'capture'
  | 'storage'
  | 'appearance'
  | 'operator'
  | 'database'
  | 'updates'
  | 'about'

const settingsTabs: { id: SettingsTab; label: string; icon: typeof Key }[] = [
  // { id: 'ai', label: 'AI', icon: Key }, // temporarily hidden until AI features are ready
  { id: 'capture', label: 'Capture', icon: Camera },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'operator', label: 'Operator', icon: UserCircle },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'updates', label: 'Updates', icon: RefreshCw },
  { id: 'about', label: 'About', icon: Info }
]

export function SettingsView() {
  const { data: settings } = useQuery(settingsQueryOptions)
  const { update } = useSettingsMutations()
  const [activeTab, setActiveTab] = useState<SettingsTab>('capture')

  useEffect(() => {
    update.mutate({ lastActiveSection: 'settings' })
  }, [])

  const handleUpdate = async (partial: Partial<BirdbrainSettings>) => {
    await update.mutateAsync(partial)
  }

  if (!settings) return <div className="text-text-muted">Loading settings...</div>

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as SettingsTab)}
      orientation="vertical"
      className="flex h-full"
    >
      <nav className="w-48 shrink-0 border-r border-border p-3">
        <TabsList className="flex h-auto w-full flex-col gap-1 bg-transparent p-0">
          {settingsTabs.map(({ id, label, icon: Icon }) => (
            <TabsTrigger
              key={id}
              value={id}
              className="w-full justify-start gap-2 px-3 py-2 data-[state=active]:bg-accent-subtle data-[state=active]:text-accent data-[state=active]:font-semibold"
            >
              <Icon size={16} />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </nav>

      <div className="flex-1 overflow-auto p-6">
        <TabsContent value="ai" className="mt-0">
          <AIConfig settings={settings} onUpdate={handleUpdate} />
        </TabsContent>
        <TabsContent value="capture" className="mt-0">
          <CapturePreferences settings={settings} onUpdate={handleUpdate} />
        </TabsContent>
        <TabsContent value="storage" className="mt-0">
          <StorageConfig settings={settings} onUpdate={handleUpdate} />
        </TabsContent>
        <TabsContent value="appearance" className="mt-0">
          <AppearanceConfig />
        </TabsContent>
        <TabsContent value="operator" className="mt-0">
          <OperatorConfig />
        </TabsContent>
        <TabsContent value="database" className="mt-0">
          <DatabaseAdmin />
        </TabsContent>
        <TabsContent value="updates" className="mt-0">
          <UpdatesConfig settings={settings} onUpdate={handleUpdate} />
        </TabsContent>
        <TabsContent value="about" className="mt-0">
          <About />
        </TabsContent>
      </div>
    </Tabs>
  )
}
