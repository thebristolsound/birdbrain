import { useState } from 'react'
import { FolderOpen, ShieldAlert, Users, FileOutput } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Case } from '@shared/types'
import { Button } from '@renderer/components/ui'
import { ExportDialog } from '@renderer/components/export/ExportDialog'
import { formatRelativeTime } from '@renderer/lib/formatRelativeTime'

// Type pill colours mirror CASE_ICONS in dashboard/CaseCard.tsx.
const TYPE_STYLES: Record<string, { icon: LucideIcon; pill: string }> = {
  crypto: { icon: FolderOpen, pill: 'border-amber-500/20 bg-amber-500/10 text-amber-500' },
  malware: { icon: ShieldAlert, pill: 'border-sky-500/20 bg-sky-500/10 text-sky-500' },
  fraud: { icon: Users, pill: 'border-pink-500/20 bg-pink-500/10 text-pink-500' }
}
const DEFAULT_STYLE = { icon: FolderOpen, pill: 'border-accent/20 bg-accent-subtle text-accent' }

interface CaseSubheadProps {
  caseData: Case
  glow?: boolean
}

export function CaseSubhead({ caseData, glow = true }: CaseSubheadProps) {
  const [showExport, setShowExport] = useState(false)
  const style = (caseData.type && TYPE_STYLES[caseData.type]) || DEFAULT_STYLE
  const PillIcon = style.icon
  const typeLabel = caseData.type
    ? caseData.type[0].toUpperCase() + caseData.type.slice(1)
    : 'Case'

  return (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-extrabold leading-tight tracking-tight">
            <span className={glow ? 'shimmer-text' : 'text-text-primary'}>{caseData.name}</span>
          </h1>
          <span
            className={`inline-flex h-[22px] items-center gap-1.5 rounded-full border px-2.5 ${style.pill}`}
          >
            <PillIcon size={11} strokeWidth={1.8} />
            <span className="font-display text-[11px] font-semibold">{typeLabel}</span>
          </span>
        </div>
        {caseData.description ? (
          <p className="mt-2 max-w-[760px] font-body text-[12.5px] leading-relaxed text-text-muted">
            {caseData.description}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2.5">
        <Button variant="outline" size="sm" onClick={() => setShowExport(true)} className="gap-1.5">
          <FileOutput size={12} strokeWidth={1.8} />
          Export
        </Button>
        <span className="font-mono text-[10.5px] text-text-faint">
          Opened {formatRelativeTime(caseData.createdAt)}
        </span>
      </div>
      {showExport && (
        <ExportDialog
          caseId={caseData.id}
          caseName={caseData.name}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  )
}
