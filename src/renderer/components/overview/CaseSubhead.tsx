import { useEffect, useRef, useState } from 'react'
import { FolderOpen, ShieldAlert, Users, Pencil } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Case } from '@shared/types'
import { useCasesMutations } from '@renderer/lib/queries'
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
  const { update } = useCasesMutations()

  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  const [editingDesc, setEditingDesc] = useState(false)
  const [descValue, setDescValue] = useState('')
  const descInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setNameValue(caseData.name)
    setDescValue(caseData.description ?? '')
  }, [caseData])

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [editingName])

  useEffect(() => {
    if (editingDesc && descInputRef.current) {
      descInputRef.current.focus()
    }
  }, [editingDesc])

  async function saveName() {
    const trimmed = nameValue.trim()
    if (!trimmed || trimmed === caseData.name) {
      setNameValue(caseData.name)
      setEditingName(false)
      return
    }
    try {
      await update.mutateAsync({ id: caseData.id, name: trimmed })
      setEditingName(false)
    } catch (err) {
      // Keep the field in edit mode with the user's value so they can retry.
      console.error('Failed to rename case', err)
    }
  }

  async function saveDesc() {
    const trimmed = descValue.trim()
    if (trimmed === (caseData.description ?? '')) {
      setEditingDesc(false)
      return
    }
    try {
      await update.mutateAsync({ id: caseData.id, description: trimmed })
      setEditingDesc(false)
    } catch (err) {
      // Keep the field in edit mode with the user's value so they can retry.
      console.error('Failed to update case description', err)
    }
  }

  const style = (caseData.type && TYPE_STYLES[caseData.type]) || DEFAULT_STYLE
  const PillIcon = style.icon
  const typeLabel = caseData.type
    ? caseData.type[0].toUpperCase() + caseData.type.slice(1)
    : 'Case'

  return (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          {editingName ? (
            <input
              data-testid="case-subhead-name-input"
              ref={nameInputRef}
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName()
                if (e.key === 'Escape') {
                  setNameValue(caseData.name)
                  setEditingName(false)
                }
              }}
              className="rounded border border-accent bg-elevated px-2 py-0.5 font-display text-2xl font-extrabold leading-tight tracking-tight text-text-primary focus:outline-none"
            />
          ) : (
            <button
              data-testid="case-subhead-name-btn"
              className="group flex min-w-0 items-center gap-2"
              onClick={() => setEditingName(true)}
              title="Click to edit"
            >
              <h1 className="min-w-0 truncate font-display text-2xl font-extrabold leading-tight tracking-tight">
                <span className={glow ? 'shimmer-text' : 'text-text-primary'}>{caseData.name}</span>
              </h1>
              <Pencil
                size={13}
                className="shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100"
              />
            </button>
          )}
          <span
            className={`inline-flex h-[22px] items-center gap-1.5 rounded-full border px-2.5 ${style.pill}`}
          >
            <PillIcon size={11} strokeWidth={1.8} />
            <span className="font-display text-[11px] font-semibold">{typeLabel}</span>
          </span>
        </div>
        {editingDesc ? (
          <textarea
            ref={descInputRef}
            value={descValue}
            onChange={(e) => setDescValue(e.target.value)}
            onBlur={saveDesc}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDescValue(caseData.description ?? '')
                setEditingDesc(false)
              }
            }}
            rows={2}
            className="mt-2 w-full max-w-[760px] resize-none rounded border border-accent bg-elevated px-2 py-1 font-body text-[12.5px] leading-relaxed text-text-secondary focus:outline-none"
          />
        ) : (
          <button
            type="button"
            className="mt-2 block max-w-[760px] cursor-pointer text-left font-body text-[12.5px] leading-relaxed text-text-muted hover:text-text-secondary"
            onClick={() => setEditingDesc(true)}
            title="Click to edit"
          >
            {caseData.description ? (
              caseData.description
            ) : (
              <span className="italic text-text-faint">Add a description…</span>
            )}
          </button>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2.5">
        <span className="font-mono text-[10.5px] text-text-faint">
          Opened {formatRelativeTime(caseData.createdAt)}
        </span>
      </div>
    </div>
  )
}
