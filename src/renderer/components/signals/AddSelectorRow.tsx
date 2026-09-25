import { forwardRef, useState, type KeyboardEvent } from 'react'
import { Plus } from 'lucide-react'
import { parseSelectorInput } from '@renderer/components/signals/signalsModel'

interface AddSelectorRowProps {
  onAdd: (pattern: string, isRegex: boolean) => void
  /** ArrowDown from the input moves into the list. */
  onFocusList: () => void
}

const MODE_CARDS = [
  {
    regex: false,
    badge: 'Aa',
    title: 'Exact text',
    hint: 'matches the text exactly as typed'
  },
  {
    regex: true,
    badge: '.*',
    title: 'Regular expression',
    hint: 'wildcards & classes — e.g. bc1[a-z0-9]{20,}'
  }
] as const

// The inline add row. One line by default; focusing it opens the two match-mode
// cards, because "is this exact text or a pattern?" is the only question a new
// selector needs answered and it is easy to get wrong silently.
export const AddSelectorRow = forwardRef<HTMLInputElement, AddSelectorRowProps>(
  function AddSelectorRow({ onAdd, onFocusList }, ref) {
    const [value, setValue] = useState('')
    const [regexMode, setRegexMode] = useState(false)
    const [drawerOpen, setDrawerOpen] = useState(false)

    function handleKey(event: KeyboardEvent<HTMLInputElement>) {
      if (event.key === 'Escape') {
        setValue('')
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        onFocusList()
        return
      }
      if (event.key !== 'Enter') return
      const parsed = parseSelectorInput(value, regexMode)
      if (!parsed) return
      // Cleared but still focused: adding selectors is a typing run, and the
      // design's placeholder says so ("Enter to save and keep typing").
      setValue('')
      onAdd(parsed.pattern, parsed.isRegex)
    }

    return (
      <div className="mb-1.5 flex flex-col rounded border border-dashed border-border-strong bg-surface px-[10px] py-[7px]">
        <div className="flex items-center gap-3">
          <span className="flex w-[30px] shrink-0 justify-center">
            <Plus className="h-3.5 w-3.5 text-text-faint" strokeWidth={2} />
          </span>
          <input
            ref={ref}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKey}
            onFocus={() => setDrawerOpen(true)}
            onBlur={() => setDrawerOpen(false)}
            aria-label="Add selector"
            data-testid="add-selector-input"
            placeholder={
              regexMode
                ? 'Add regex selector — e.g. bc1[a-z0-9]{20,} — Enter to save and keep typing'
                : 'Add selector — exact text match — Enter to save and keep typing'
            }
            className="min-w-0 flex-1 border-none bg-transparent font-mono text-xs text-text-primary outline-none"
          />
          <button
            type="button"
            onClick={() => setRegexMode((v) => !v)}
            title={
              regexMode
                ? 'Regex mode on — click for exact text (or just wrap the pattern in /…/)'
                : 'Exact text mode — click for regex (or just wrap the pattern in /…/)'
            }
            data-testid="add-selector-mode"
            className={[
              'shrink-0 rounded px-2 py-0.5 font-mono text-[10px] font-semibold',
              regexMode
                ? 'border border-accent/30 bg-accent-subtle text-accent'
                : 'border border-border bg-surface text-text-muted'
            ].join(' ')}
          >
            {regexMode ? '.*' : 'Aa'}
          </button>
          <kbd className="shrink-0 rounded border border-border-strong bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-faint">
            Enter ↵
          </kbd>
        </div>

        {drawerOpen && (
          <div
            role="radiogroup"
            aria-label="Match mode"
            className="match-mode-enter mt-2 flex gap-1.5 border-t border-dashed border-border pt-2"
          >
            {MODE_CARDS.map((card) => (
              <button
                key={card.badge}
                type="button"
                role="radio"
                aria-checked={regexMode === card.regex}
                // mouseDown with preventDefault, not click: a click would blur
                // the input first, closing this drawer before the choice lands.
                onMouseDown={(event) => {
                  event.preventDefault()
                  setRegexMode(card.regex)
                }}
                className={[
                  'flex min-w-0 flex-1 items-center gap-2 rounded px-[10px] py-1.5 text-left transition-colors',
                  regexMode === card.regex
                    ? 'border border-accent/45 bg-accent-subtle'
                    : 'border border-border bg-transparent'
                ].join(' ')}
              >
                <span
                  className={`shrink-0 rounded border border-border-strong bg-card px-1.5 py-px font-mono text-[10px] font-semibold ${
                    regexMode === card.regex ? 'text-accent' : 'text-text-muted'
                  }`}
                >
                  {card.badge}
                </span>
                <span className="flex min-w-0 flex-col gap-px">
                  <span className="text-[11px] font-semibold text-text-primary">{card.title}</span>
                  <span className="truncate text-[10px] text-text-faint">{card.hint}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }
)
