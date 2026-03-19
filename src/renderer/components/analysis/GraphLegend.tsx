import type { EntityNode, EntityType } from '@shared/types'

const TYPE_COLORS: Record<string, string> = {
  person: '#f59e0b',
  organization: '#38bdf8',
  email: '#22c55e',
  phone: '#a855f7',
  domain: '#ec4899',
  ip_address: '#ef4444',
  address: '#14b8a6',
  date: '#f97316',
  username: '#6366f1',
  crypto_wallet: '#eab308',
  custom: '#737373'
}

const TYPE_LABELS: Record<string, string> = {
  person: 'Person',
  organization: 'Org',
  email: 'Email',
  phone: 'Phone',
  domain: 'Domain',
  ip_address: 'IP',
  address: 'Address',
  date: 'Date',
  username: 'Username',
  crypto_wallet: 'Crypto',
  custom: 'Custom'
}

interface GraphLegendProps {
  nodes: EntityNode[]
  activeTypes: Set<EntityType>
  onToggleType: (type: EntityType) => void
}

export function GraphLegend({ nodes, activeTypes, onToggleType }: GraphLegendProps) {
  const typeCounts = new Map<EntityType, number>()
  for (const node of nodes) {
    typeCounts.set(node.type, (typeCounts.get(node.type) || 0) + 1)
  }

  return (
    <div className="flex shrink-0 items-center border-b border-white/[0.06] bg-slate-900 px-5 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
          Filter:
        </span>
        {Array.from(typeCounts.entries()).map(([type, count]) => {
          const isActive = activeTypes.has(type)
          return (
            <button
              key={type}
              onClick={() => onToggleType(type)}
              className={`legend-chip inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-medium ${
                isActive
                  ? 'border-indigo-400/35 bg-indigo-500/12 font-semibold text-indigo-200'
                  : 'border-white/[0.08] bg-white/[0.04] text-slate-300'
              }`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: TYPE_COLORS[type] || '#737373' }}
              />
              {TYPE_LABELS[type] || type}
              <span className={`text-[9px] ${isActive ? 'opacity-60' : 'text-slate-500'}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export { TYPE_COLORS, TYPE_LABELS }
