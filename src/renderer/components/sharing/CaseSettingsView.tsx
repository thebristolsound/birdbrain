import { useState } from 'react'
import { Archive, Folder, Users } from 'lucide-react'
import { SectionLabel, Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui'
import { MembersTab } from '@renderer/components/sharing/MembersTab'
import { COPY } from '@renderer/components/sharing/memberModel'

type CaseSettingsTab = 'general' | 'members' | 'export'

const TRIGGER =
  'w-full justify-start gap-2 rounded px-2.5 py-1.5 text-xs font-medium text-text-primary/60 ' +
  'data-[state=active]:bg-accent-subtle data-[state=active]:font-semibold data-[state=active]:text-accent'

// Case settings (#1514, mock 1a): the SettingsView shell with the mock's
// three-item nav. General and Export are placeholders (feasibility item 19)
// until their screens move here; only Members has content.
export function CaseSettingsView({ caseId }: { caseId: string }) {
  const [tab, setTab] = useState<CaseSettingsTab>('members')
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as CaseSettingsTab)}
      orientation="vertical"
      className="flex h-full gap-0 p-[18px]"
      data-testid="case-settings-view"
    >
      <nav className="w-44 shrink-0 border-r border-border p-2">
        <SectionLabel className="px-2.5 pb-2">{COPY.navLabel}</SectionLabel>
        <TabsList className="flex h-auto w-full flex-col gap-1 bg-transparent p-0">
          <TabsTrigger value="general" disabled className={TRIGGER}>
            <Folder size={16} aria-hidden="true" />
            General
          </TabsTrigger>
          <TabsTrigger value="members" className={TRIGGER}>
            <Users size={16} aria-hidden="true" />
            Members
          </TabsTrigger>
          <TabsTrigger value="export" disabled className={TRIGGER}>
            <Archive size={16} aria-hidden="true" />
            Export
          </TabsTrigger>
        </TabsList>
        <p className="mx-2.5 mt-3.5 text-[10px] leading-[1.5] text-text-faint">
          {COPY.navFootnote}
        </p>
      </nav>
      <div className="min-w-0 flex-1 overflow-auto pl-[18px]">
        <TabsContent value="members" className="mt-0">
          <MembersTab caseId={caseId} />
        </TabsContent>
      </div>
    </Tabs>
  )
}
