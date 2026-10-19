import { useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { InvestigationView, NotReadCount, RunSummary } from '@shared/investigation'
import { Button, SectionLabel } from '@renderer/components/ui'
import {
  counted,
  formatBasis,
  notReadRows,
  notReadTotal,
  runInquiryText,
  sharedNames,
  subjectMeta
} from '@renderer/components/investigate/investigateModel'

// Launched-browser mock, piece 1y. "Show them" waits for the designer's revision (maintainer
// ruling, 2026-10-17), so the breakdown links to nothing.
const NOT_READ_INFO =
  "What they hold is unknown to this run. They can still hold a Subject's identifiers."

function NotReadBreakdown({ notRead }: { notRead: NotReadCount[] }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const total = notReadTotal(notRead)

  if (total === 0) return <span>0 not read</span>

  return (
    <span
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          setOpen(false)
          buttonRef.current?.focus()
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex items-center gap-0.5 rounded-sm underline decoration-dotted underline-offset-2 hover:text-text-primary"
        onClick={() => setOpen((v) => !v)}
      >
        {total} not read
        <ChevronDown className="h-2.5 w-2.5" />
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label="Exhibits this run did not read"
          className="absolute left-0 top-full z-20 mt-1 w-[340px] rounded-lg border border-border bg-card px-3 py-2.5 text-[11px] text-text-secondary shadow-[var(--shadow-overlay)]"
        >
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-text-primary">
              This run did not read these Exhibits
            </span>
            <span
              tabIndex={0}
              role="img"
              aria-label={NOT_READ_INFO}
              title={NOT_READ_INFO}
              className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-border-strong font-mono text-[10px] font-bold text-text-muted"
            >
              i
            </span>
          </div>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {notReadRows(notRead).map(({ key, text }) => (
              <li key={key}>{text}</li>
            ))}
          </ul>
        </div>
      )}
    </span>
  )
}

interface ViewHeaderProps {
  view: InvestigationView & { run: RunSummary }
  onNewRun: () => void
}

export function ViewHeader({ view, onNewRun }: ViewHeaderProps) {
  const { run, subjects, joints } = view
  const { read, withheld, notRead } = run.counts
  const shared = sharedNames(subjects)
  const byId = new Map(subjects.map((s) => [s.id, s]))
  const starting = run.startingSubjectIds.flatMap((id) => byId.get(id) ?? [])
  const { followDepth } = run.parameters

  return (
    <header
      data-testid="investigate-header"
      className="flex shrink-0 flex-col gap-1.5 border-b border-border bg-surface px-3.5 py-2"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <SectionLabel className="shrink-0">Joint map</SectionLabel>
        <span className="min-w-0 truncate text-sm font-bold text-text-primary">
          {runInquiryText(run, joints)}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-text-muted">
          {formatBasis(run.startedAt)}
        </span>
        <Button variant="outline" size="sm" className="h-6 shrink-0" onClick={onNewRun}>
          New run
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="whitespace-nowrap">Starting from</span>
          {starting.map((s) => (
            <span
              key={s.id}
              data-testid="investigate-header-subject"
              className="rounded-md border border-border px-1.5 py-px text-text-secondary"
            >
              {s.name} <span className="text-text-faint">{subjectMeta(s, shared)}</span>
            </span>
          ))}
        </span>
        <span data-testid="investigate-header-counts">
          {counted(read, 'Exhibit', 'Exhibits')} read · {withheld} withheld ·{' '}
          <NotReadBreakdown notRead={notRead} />
        </span>
        <span>Sources: stored Case only</span>
        <span>
          Followed: {counted(followDepth, 'Joint', 'Joints')} out from each starting Subject
        </span>
        <span>AI analysis off</span>
      </div>
    </header>
  )
}
