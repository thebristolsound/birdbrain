import { useState } from 'react'
import type { FieldHit } from '@shared/types'
import { checkFieldHit } from '@renderer/lib/api/captures'
import { CHECK_FAILED_TEXT, checkAnswer } from '@renderer/components/captures/fieldHitCheckModel'

/**
 * The exact check of the search hit open in the viewer (docs/plans/2026-10-09-case-
 * retrieval-first-slice.md, D7). Each press reads the stored files again in the main
 * process. The answer is held only in this component, which the viewer mounts afresh
 * for each opening of a hit, so closing the hit or opening any hit, the same one
 * included, leaves no answer until the next press.
 */
export function FieldHitCheck({ hit }: { hit: FieldHit }) {
  // Null before the first press; '' while a check runs. The button is disabled while
  // one runs, so a press never races an earlier one.
  const [answer, setAnswer] = useState<string | null>(null)
  const running = answer === ''

  const run = () => {
    setAnswer('')
    checkFieldHit(hit.fieldId).then(
      (result) => setAnswer(checkAnswer(hit, result)),
      () => setAnswer(CHECK_FAILED_TEXT)
    )
  }

  return (
    <div
      data-testid="field-hit-check"
      className="flex shrink-0 items-start gap-2.5 border-b border-border bg-surface px-4 py-1.5"
    >
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="shrink-0 rounded border border-border-strong bg-card px-2 py-0.5 text-[11px] font-medium text-text-secondary hover:text-text-primary disabled:opacity-60"
      >
        {running ? 'Checking…' : 'Check against the stored file'}
      </button>
      {answer ? (
        <p
          data-testid="field-hit-check-answer"
          role="status"
          className="min-w-0 pt-0.5 text-[11px] text-text-secondary"
        >
          {answer}
        </p>
      ) : null}
    </div>
  )
}
