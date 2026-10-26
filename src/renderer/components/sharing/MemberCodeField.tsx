import { Check } from 'lucide-react'
import { Input } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import { COPY, type MemberCodeCheck } from '@renderer/components/sharing/memberModel'

interface MemberCodeFieldProps {
  id: string
  value: string
  check: MemberCodeCheck
  // A refusal main returned for the code, shown in place of the live check.
  refusal: string | null
  onChange: (value: string) => void
}

// The Member Code input of the join request (#1514, mock 1c step 3): 64px,
// upper-cased as typed, with the live check beside it. The check itself is
// memberCodeCheck in the model; this only draws its result. An invalid code
// (empty, too long, a symbol) marks the input and says nothing: the helper
// under the field already states the rule.
export function MemberCodeField({ id, value, check, refusal, onChange }: MemberCodeFieldProps) {
  const problem = refusal ?? (!check.ok && check.reason === 'taken' ? check.message : null)
  const invalid = refusal !== null || !check.ok
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        data-testid="member-code-input"
        className={cn(
          'w-16 rounded border-border-strong px-2.5 py-1.5 text-xs font-semibold uppercase tracking-[.02em]',
          invalid && 'border-danger-fg focus:border-danger-fg'
        )}
      />
      {problem !== null ? (
        <span className="text-[11px] text-danger-fg" data-testid="member-code-problem">
          {problem}
        </span>
      ) : check.ok ? (
        <span
          className="flex items-center gap-1 text-[11px] text-success-fg"
          data-testid="member-code-ok"
        >
          <Check size={11} strokeWidth={2.4} aria-hidden="true" />
          {COPY.memberCodeOk}
        </span>
      ) : null}
    </div>
  )
}
