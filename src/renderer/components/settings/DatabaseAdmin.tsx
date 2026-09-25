import { useState } from 'react'
import { Card, CardContent } from '@renderer/components/ui'
import { DbMaintenance } from '@renderer/components/settings/db/DbMaintenance'
import { DbStats } from '@renderer/components/settings/db/DbStats'
import { DbTables } from '@renderer/components/settings/db/DbTables'
import { DbUtilities } from '@renderer/components/settings/db/DbUtilities'

type DbSubTab = 'stats' | 'tables' | 'utilities'

const subTabs: { id: DbSubTab; label: string }[] = [
  { id: 'stats', label: 'Stats' },
  { id: 'tables', label: 'Tables' },
  { id: 'utilities', label: 'Utilities' }
]

export function DatabaseAdmin() {
  const [activeTab, setActiveTab] = useState<DbSubTab>('stats')

  return (
    <Card>
      <CardContent className="space-y-4">
        <h2 className="font-display text-[10px] font-semibold uppercase tracking-wider text-text-faint">
          Database
        </h2>
        <div className="flex gap-1 border-b border-border">
          {subTabs.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-muted hover:text-text-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div>
          {activeTab === 'stats' && <DbStats />}
          {activeTab === 'tables' && <DbTables />}
          {activeTab === 'utilities' && <DbUtilities />}
        </div>
        {activeTab === 'stats' && <DbMaintenance />}
      </CardContent>
    </Card>
  )
}
