import { useRef, useState } from 'react'
import type { FieldHit } from '@shared/types'
import { checkFieldHit } from '@renderer/lib/api/captures'
import { CHECK_FAILED_TEXT, checkAnswer } from '@renderer/components/captures/fieldHitCheckModel'

interface Answer {
  hit: FieldHit
  /** Which press this answers, so an earlier press that settles late is dropped. */
  ask: number
  text: string | null
}

/**
 * The exact check of the search hit open in the viewer (docs/plans/2026-10-09-case-
 * retrieval-first-slice.md, D7). Each press reads the stored files again in the main
 * process. The answer is held here for the hit it answers and nowhere else: opening
 * another hit, or another Capture, leaves nothing to show.
 */
export function FieldHitCheck({ hit }: { hit: FieldHit }) {
  const [answer, setAnswer] = useState<Answer | null>(null)
  const asks = useRef(0)
  const current = answer?.hit === hit ? answer : null
  const running = current !== null && current.text === null

  const run = () => {
    asks.current += 1
    const ask = asks.current
    const settle = (text: string) =>
      setAnswer((prev) => (prev?.ask === ask ? { hit, ask, text } : prev))
    setAnswer({ hit, ask, text: null })
    checkFieldHit(hit.fieldId).then(
      (result) => settle(checkAnswer(hit, result)),
      () => settle(CHECK_FAILED_TEXT)
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
      {current?.text ? (
        <p
          data-testid="field-hit-check-answer"
          role="status"
          className="min-w-0 pt-0.5 text-[11px] text-text-secondary"
        >
          {current.text}
        </p>
      ) : null}
    </div>
  )
}
