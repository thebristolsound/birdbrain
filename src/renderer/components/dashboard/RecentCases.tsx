import { Plus } from 'lucide-react'
import { motion } from 'motion/react'
import type { Case } from '@shared/types'
import { presets, STAGGER_INTERVAL, STAGGER_VISIBLE_CAP } from '@renderer/lib/motion'
import { CaseCard } from '@renderer/components/dashboard/CaseCard'

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
        <div className="flex items-center gap-3 mb-6">
          <h2 className="font-display font-bold text-lg tracking-tight text-text-primary">
            Recent Cases
          </h2>
          <span className="rounded-full border border-border-strong bg-surface px-2 py-0.5 text-[10px] font-medium tabular-nums text-text-muted">
            {cases.length} {cases.length === 1 ? 'case' : 'cases'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {cases.slice(0, 3).map((c, i) => (
            <motion.div
              key={c.id}
              initial={presets.fadeUp.initial}
              animate={presets.fadeUp.animate}
              transition={{
                ...presets.fadeUp.transition,
                delay: i < STAGGER_VISIBLE_CAP ? i * STAGGER_INTERVAL : 0
              }}
            >
              <CaseCard
                caseData={c}
                isRecording={false}
                isActive={false}
                captureCount={captureCounts[c.id] || 0}
                onClick={() => onSelectCase(c.id)}
                onRename={onRenameCase}
                onDelete={onDeleteCase}
              />
            </motion.div>
          ))}

          <div
            onClick={onNewCase}
            className="new-case-card cursor-pointer rounded-2xl border-2 border-dashed p-5 transition-colors flex flex-col items-center justify-center text-center min-h-[260px] group"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/20 bg-accent-subtle transition-colors group-hover:bg-accent-subtle">
              <Plus className="h-6 w-6 text-accent transition-transform duration-300 group-hover:rotate-90" />
            </div>
            <h3 className="font-display font-bold text-sm text-accent mb-1">New Investigation</h3>
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
