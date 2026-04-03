import { Plus, ArrowRight } from 'lucide-react'
import type { Case } from '@shared/types'
import { CaseCard } from './CaseCard'

interface RecentCasesProps {
  cases: Case[]
  captureCounts: Record<string, number>
  onSelectCase: (id: string) => void
  onNewCase: () => void
  onRenameCase: (id: string, name: string) => void
  onDeleteCase: (id: string) => void
}

export function RecentCases({
  cases,
  captureCounts,
  onSelectCase,
  onNewCase,
  onRenameCase,
  onDeleteCase
}: RecentCasesProps) {
  return (
    <section className="px-8 pb-12">
      <div className="max-w-5xl mx-auto">
        <div className="anim-up d5 flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h2 className="font-display font-bold text-lg tracking-tight text-text-primary">
              Recent Cases
            </h2>
            <span className="rounded-full border border-border-strong bg-surface px-2 py-0.5 font-mono text-[10px] font-medium text-text-muted">
              {cases.length} {cases.length === 1 ? 'case' : 'cases'}
            </span>
          </div>
          <button className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-accent hover:text-accent transition-colors">
            <span>View All</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {cases.slice(0, 3).map((c, i) => (
            <CaseCard
              key={c.id}
              caseData={c}
              isRecording={false}
              isActive={false}
              captureCount={captureCounts[c.id] || 0}
              onClick={() => onSelectCase(c.id)}
              onRename={onRenameCase}
              onDelete={onDeleteCase}
              animDelay={`d${5 + i}`}
            />
          ))}

          <div
            onClick={onNewCase}
            className="anim-scale d8 new-case-card cursor-pointer rounded-2xl border-2 border-dashed p-5 transition-all flex flex-col items-center justify-center text-center min-h-[260px] group"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/20 bg-accent-subtle transition-colors group-hover:bg-accent-subtle">
              <Plus className="h-6 w-6 text-accent transition-transform duration-300 group-hover:rotate-90" />
            </div>
            <h3 className="font-display font-bold text-sm text-accent mb-1">
              New Investigation
            </h3>
            <p className="text-[11px] text-accent leading-relaxed">
              Start a fresh case with
              <br />
              guided setup
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
