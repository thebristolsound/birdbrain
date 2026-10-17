import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { InvestigationView } from '@shared/investigation'
import { formatExhibitCitation } from '@shared/exhibitCitation'
import { useInvestigationMutations } from '@renderer/lib/api/investigation'
import { Button, SectionLabel, Textarea } from '@renderer/components/ui'
import {
  counted,
  holderText,
  holdsOwnFlag,
  sharedNames,
  subjectLabel,
  subjectMeta
} from '@renderer/components/investigate/investigateModel'

// The decision 22 line: with AI off, an empty result is never read as "no connection".
const AI_OFF_LIMIT =
  'Without it, this run matches shared identifiers and identical text only. It cannot find a ' +
  'paraphrased retelling or a relation stated only in prose; an empty result never means there ' +
  'is no connection.'

const RUN_RECORDS =
  'The inquiry, the starting Subjects, the withheld list, the Note passages it uses as they ' +
  'read now, and the Case state as of now.'

interface RunSetupProps {
  caseId: string
  caseName: string
  view: InvestigationView
  running: boolean
  onRun: (inquiry: string, startingSubjectIds: string[]) => void
  onCancel: (() => void) | null
}

export function RunSetup({ caseId, caseName, view, running, onRun, onCancel }: RunSetupProps) {
  const [inquiry, setInquiry] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const { setWithheld } = useInvestigationMutations(caseId)
  const { subjects, withheld } = view
  const shared = sharedNames(subjects)
  const byId = new Map(subjects.map((s) => [s.id, s]))
  const pickedSubjects = picked.flatMap((id) => byId.get(id) ?? [])
  const addable = subjects.filter(({ id }) => !picked.includes(id))
  const trimmed = inquiry.trim()
  const canRun = !running && (trimmed !== '' || picked.length > 0)

  return (
    <div className="h-full overflow-y-auto p-[var(--d-pad)]">
      <div className="mx-auto flex max-w-[640px] flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold text-text-primary">Ask the Case</h2>
          <span className="truncate text-[11px] text-text-muted">{caseName}</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionLabel>
            <label htmlFor="investigate-inquiry">Inquiry or claim</label>
          </SectionLabel>
          <Textarea
            id="investigate-inquiry"
            rows={2}
            value={inquiry}
            onChange={(e) => setInquiry(e.target.value)}
            placeholder="Who owned the Marlow Star between 2019 and 2022?"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <SectionLabel>Starting Subjects</SectionLabel>
            <span className="text-[10px] text-text-faint">
              Two Subjects with one name are listed separately
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5" data-testid="investigate-starting-subjects">
            {pickedSubjects.map((s) => (
              <span
                key={s.id}
                data-testid="investigate-picked-subject"
                className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-elevated px-2 py-0.5"
              >
                <span className="text-xs font-semibold text-text-primary">{s.name}</span>
                <span className="text-[10px] text-text-faint">{subjectMeta(s, shared)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${subjectLabel(s, shared)}`}
                  className="rounded-sm text-text-muted hover:text-text-primary"
                  onClick={() => setPicked((ids) => ids.filter((id) => id !== s.id))}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            {addable.map((s) => (
              <button
                key={s.id}
                type="button"
                data-testid="investigate-addable-subject"
                aria-label={`Add ${subjectLabel(s, shared)}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-dotted border-border-strong px-2 py-0.5 text-text-secondary hover:bg-elevated"
                onClick={() => setPicked((ids) => [...ids, s.id])}
              >
                <Plus className="h-2.5 w-2.5" />
                <span className="text-xs">{s.name}</span>
                <span className="text-[10px] text-text-faint">{subjectMeta(s, shared)}</span>
              </button>
            ))}
          </div>
        </div>

        <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-2 text-[11px] text-text-secondary">
          <dt className="text-text-muted">Withheld from analysis</dt>
          <dd>
            <div>{counted(withheld.length, 'Exhibit withheld', 'Exhibits withheld')}</div>
            {withheld.map((w) => (
              <div
                key={w.exhibitId}
                data-testid="investigate-withheld-row"
                className="mt-1 flex items-center gap-2"
              >
                <span className="rounded-sm bg-elevated px-1 font-mono text-[10px] text-text-primary">
                  {formatExhibitCitation(w, { prefixed: true })}
                </span>
                <span className="truncate text-text-primary">{w.name}</span>
                <span className="text-text-faint">{holderText(w.holders)}</span>
                {holdsOwnFlag(w.holders) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6"
                    disabled={setWithheld.isPending}
                    onClick={() => setWithheld.mutate({ exhibitId: w.exhibitId, withheld: false })}
                  >
                    Clear my flag
                  </Button>
                )}
              </div>
            ))}
          </dd>
          <dt className="text-text-muted">Sources</dt>
          <dd>Stored Case only</dd>
          <dt className="text-text-muted">AI analysis</dt>
          <dd>
            <span>AI analysis is off.</span> <span className="text-text-muted">{AI_OFF_LIMIT}</span>
          </dd>
          <dt className="text-text-muted">What the run records</dt>
          <dd className="text-text-muted">{RUN_RECORDS}</dd>
        </dl>

        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button disabled={!canRun} onClick={() => onRun(trimmed, picked)}>
            Run
          </Button>
        </div>
      </div>
    </div>
  )
}
