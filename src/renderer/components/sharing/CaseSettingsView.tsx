import { useState } from 'react'
import { Users } from 'lucide-react'
import {
  Badge,
  SectionLabel,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@renderer/components/ui'
import { MembersTab } from '@renderer/components/sharing/MembersTab'
import { COPY } from '@renderer/components/sharing/memberModel'

type CaseSettingsTab = 'members'

const TRIGGER =
  'w-full justify-start gap-2 rounded px-2.5 py-1.5 text-xs font-medium text-text-primary/60 ' +
  'data-[state=active]:bg-accent-subtle data-[state=active]:font-semibold data-[state=active]:text-accent'

// Case settings (#1514, mock 1a): the SettingsView shell. Members is the one
// tab; General and Export keep their current homes until their screens move here.
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
          <TabsTrigger value="members" className={TRIGGER}>
            <Users size={16} aria-hidden="true" />
            Members
          </TabsTrigger>
        </TabsList>
      </nav>
      <div className="min-w-0 flex-1 overflow-auto pl-[18px]">
        <TabsContent value="members" className="mt-0 flex flex-col gap-3">
          <Badge
            variant="accent"
            size="default"
            className="self-start"
            data-testid="sharing-early-access"
          >
            {COPY.earlyAccess}
          </Badge>
          <MembersTab caseId={caseId} />
        </TabsContent>
      </div>
    </Tabs>
  )
}
