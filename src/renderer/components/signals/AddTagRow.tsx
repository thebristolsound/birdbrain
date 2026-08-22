import { forwardRef, useState, type KeyboardEvent } from 'react'
import { slugifyTagName } from '@renderer/components/signals/signalsModel'

interface AddTagRowProps {
  onAdd: (name: string) => void
  onFocusList: () => void
  /** The colour the next tag will take, previewed in the gutter. */
  nextColor: string
}

export const AddTagRow = forwardRef<HTMLInputElement, AddTagRowProps>(function AddTagRow(
  { onAdd, onFocusList, nextColor },
  ref
) {
  const [value, setValue] = useState('')

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
    const name = slugifyTagName(value)
    if (!name) return
    setValue('')
    onAdd(name)
  }

  return (
    <div className="mb-1.5 flex items-center gap-3 rounded border border-dashed border-border-strong bg-surface px-[10px] py-[7px]">
      <span className="flex w-[30px] shrink-0 justify-center">
        <span className="h-[9px] w-[9px] rounded-full" style={{ background: nextColor }} />
      </span>
      <input
        ref={ref}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKey}
        aria-label="Add tag"
        data-testid="add-tag-input"
        placeholder="Add tag — Enter to save and keep typing"
        className="min-w-0 flex-1 border-none bg-transparent text-xs text-text-primary outline-none"
      />
      <kbd className="shrink-0 rounded border border-border-strong bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-faint">
        Enter ↵
      </kbd>
    </div>
  )
})
