import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui'
import type { Arrangement } from '@renderer/components/investigate/investigateModel'

export type PaneId = 'map' | 'detail' | 'source'

// The panes are empty until the Joint map and list (CI-V2) and Joint detail and the source
// inspector (CI-V3) fill them.
const PANE_NAMES: Record<PaneId, string> = {
  map: 'Joint map and list',
  detail: 'Joint detail',
  source: 'Source inspector'
}

interface PaneArrangementProps {
  arrangement: Arrangement
  activeTab: PaneId
  onTabChange: (tab: PaneId) => void
  subjectSelected: boolean
}

export function PaneArrangement({
  arrangement,
  activeTab,
  onTabChange,
  subjectSelected
}: PaneArrangementProps) {
  if (arrangement === 'panes') {
    return (
      <div className="flex min-h-0 flex-1" data-testid="investigate-panes">
        <section
          aria-label={PANE_NAMES.map}
          className="w-[500px] shrink-0 overflow-y-auto border-r border-border bg-surface"
        />
        <section
          aria-label={PANE_NAMES.detail}
          className="min-w-[300px] flex-1 overflow-y-auto border-r border-border"
        />
        <section aria-label={PANE_NAMES.source} className="w-[340px] shrink-0 overflow-y-auto" />
      </div>
    )
  }

  const tabs: { id: PaneId; label: string }[] = [
    { id: 'map', label: 'Joints' },
    { id: 'detail', label: subjectSelected ? 'Subject' : 'Joint detail' },
    { id: 'source', label: 'Source' }
  ]

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => onTabChange(value as PaneId)}
      className="min-h-0 flex-1 gap-0"
    >
      <TabsList
        variant="line"
        className="h-auto w-full justify-start border-b border-border bg-surface px-2.5 pt-1"
      >
        {tabs.map(({ id, label }) => (
          <TabsTrigger key={id} value={id} className="h-7 flex-none px-2.5 text-xs">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map(({ id }) => (
        <TabsContent key={id} value={id} className="min-h-0 overflow-y-auto">
          <section aria-label={PANE_NAMES[id]} className="h-full" />
        </TabsContent>
      ))}
    </Tabs>
  )
}
