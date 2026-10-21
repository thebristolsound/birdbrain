import { useEffect, useRef, useState } from 'react'
import type { Tag } from '@shared/types'
import { useTagsMutations } from '@renderer/lib/queries'
import { notify } from '@renderer/lib/notify'
import { TAG_COLOR_PRESETS, DEFAULT_TAG_COLOR } from '@renderer/components/tags/tagColors'
import { findTagByName, slugifyTagName } from '@renderer/components/signals/signalsModel'

interface NewTagPopoverProps {
  caseId: string
  /** Every tag, for the taken-name check. */
  tags: Tag[]
  onCreated: (tag: Tag) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}

/**
 * The dashboard's tag-creation menu: the colour dot and name row the capture
 * tag popovers open with, and the naming rules the Signals add row applies, so
 * a tag made here is the same tag the Signals page would have made. It stays
 * open across creates, so several tags are one gesture.
 */
export function NewTagPopover({ caseId, tags, onCreated, onClose, anchorRef }: NewTagPopoverProps) {
  const { create } = useTagsMutations(caseId)
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_TAG_COLOR)
  const [showColors, setShowColors] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      // The button that opened it owns that path; closing here too would make
      // a second click reopen rather than dismiss.
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, anchorRef])

  async function handleCreate() {
    const slug = slugifyTagName(name)
    if (!slug || create.isPending) return
    // Checked here rather than left to main's TAG_NAME_TAKEN, as on the Signals
    // page (#1549), so a taken name is an info toast. Main's refusal reaches
    // the window only as the generic failure toast (#1949).
    if (findTagByName(tags, slug)) {
      notify.info(`A tag named ‘${slug}’ already exists`)
      return
    }
    try {
      onCreated(await create.mutateAsync({ name: slug, color }))
      setName('')
    } catch {
      // The mutation cache toasts it; the name is kept so the operator can retry.
    }
  }

  return (
    <div
      ref={popoverRef}
      data-testid="overview-new-tag-popover"
      className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-border-strong bg-card shadow-xl"
    >
      <div className="flex items-center gap-1.5 px-3 py-2">
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setShowColors(!showColors)}
            className="flex h-4 w-4 items-center justify-center rounded-full ring-1 ring-border transition-transform hover:scale-110"
            style={{ backgroundColor: color }}
            title="Pick color"
            aria-label="Pick color"
          />
          {showColors && (
            <div className="absolute left-0 top-full z-10 mt-1 flex flex-col gap-1 rounded-lg border border-border-strong bg-card p-1.5 shadow-lg">
              {TAG_COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Use color ${c}`}
                  onClick={() => {
                    setColor(c)
                    setShowColors(false)
                  }}
                  className="h-4 w-4 rounded-full ring-1 ring-border hover:scale-110"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          )}
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            handleCreate()
          }}
          data-testid="overview-new-tag-input"
          placeholder="Create tag"
          aria-label="Create tag"
          className="min-w-0 flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-faint focus:outline-none"
        />
        <button
          type="button"
          onClick={handleCreate}
          disabled={!slugifyTagName(name) || create.isPending}
          className="rounded-md px-2 py-0.5 text-[11px] text-accent hover:bg-accent-subtle disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  )
}
