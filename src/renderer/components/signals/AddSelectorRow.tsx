import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent
} from 'react'
import { Plus } from 'lucide-react'
import { parseSelectorInput } from '@renderer/components/signals/signalsModel'
import { regexPatternError } from '@shared/selectorPattern'

/** A pattern to load into the row, from a selector's Duplicate action. */
export interface SelectorPrefill {
  pattern: string
  isRegex: boolean
  /** Changes on every request, so duplicating the same selector twice refills. */
  seq: number
}

interface AddSelectorRowProps {
  /** Returns false when the pattern was refused, so the typed value stays. */
  onAdd: (pattern: string, isRegex: boolean) => boolean
  /** ArrowDown from the input moves into the list. */
  onFocusList: () => void
  prefill?: SelectorPrefill | null
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
  function AddSelectorRow({ onAdd, onFocusList, prefill }, ref) {
    const [value, setValue] = useState('')
    const [regexMode, setRegexMode] = useState(false)
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [regexError, setRegexError] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const pointerDownRef = useRef(false)
    useImperativeHandle(ref, () => inputRef.current as HTMLInputElement)

    // Whether a pointer is pressed anywhere, so a blur can tell a click on
    // something else from a Tab away.
    useEffect(() => {
      const down = () => {
        pointerDownRef.current = true
      }
      const up = () => {
        pointerDownRef.current = false
      }
      window.addEventListener('pointerdown', down, true)
      window.addEventListener('pointerup', up, true)
      window.addEventListener('pointercancel', up, true)
      return () => {
        window.removeEventListener('pointerdown', down, true)
        window.removeEventListener('pointerup', up, true)
        window.removeEventListener('pointercancel', up, true)
      }
    }, [])

    // A click elsewhere blurs the input on pointer-down. Folding the drawer
    // then moves the list up under the pointer, and the click lands on
    // whatever has moved there, or on nothing (#1755). So a blur from a press
    // waits for the release and the click it produces before folding.
    function handleBlur() {
      const fold = () => {
        if (document.activeElement !== inputRef.current) setDrawerOpen(false)
      }
      if (!pointerDownRef.current) {
        setDrawerOpen(false)
        return
      }
      const settle = () => {
        window.removeEventListener('pointerup', settle, true)
        window.removeEventListener('pointercancel', settle, true)
        setTimeout(fold, 0)
      }
      window.addEventListener('pointerup', settle, true)
      window.addEventListener('pointercancel', settle, true)
    }

    useEffect(() => {
      if (!prefill) return
      setValue(prefill.pattern)
      setRegexMode(prefill.isRegex)
      setRegexError(null)
      inputRef.current?.focus()
    }, [prefill])

    function handleKey(event: KeyboardEvent<HTMLInputElement>) {
      if (event.key === 'Escape') {
        setValue('')
        setRegexError(null)
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
      // An invalid regex would be saved and then match nothing (#1754).
      const invalid = parsed.isRegex ? regexPatternError(parsed.pattern) : null
      if (invalid) {
        setRegexError(invalid)
        return
      }
      // Cleared but still focused: adding selectors is a typing run, and the
      // design's placeholder says so ("Enter to save and keep typing").
      if (onAdd(parsed.pattern, parsed.isRegex)) setValue('')
    }

    return (
      <div className="mb-1.5 flex flex-col rounded border border-dashed border-border-strong bg-surface px-[10px] py-[7px]">
        <div className="flex items-center gap-3">
          <span className="flex w-[30px] shrink-0 justify-center">
            <Plus className="h-3.5 w-3.5 text-text-faint" strokeWidth={2} />
          </span>
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
              setRegexError(null)
            }}
            onKeyDown={handleKey}
            onFocus={() => setDrawerOpen(true)}
            onBlur={handleBlur}
            aria-label="Add selector"
            aria-invalid={regexError ? true : undefined}
            aria-describedby={regexError ? 'add-selector-error' : undefined}
            data-testid="add-selector-input"
            placeholder={regexMode ? 'Add regex selector' : 'Add selector'}
            className="min-w-0 flex-1 border-none bg-transparent font-mono text-xs text-text-primary outline-none"
          />
          <button
            type="button"
            onClick={() => {
              setRegexMode((v) => !v)
              setRegexError(null)
            }}
            title={regexMode ? 'Regex — click for exact text' : 'Exact text — click for regex'}
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

        {regexError && (
          <p
            id="add-selector-error"
            role="alert"
            data-testid="add-selector-error"
            className="mt-1.5 text-[11px] text-red-400"
          >
            Not a valid regular expression: {regexError}
          </p>
        )}

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
                  setRegexError(null)
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
