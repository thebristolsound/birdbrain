import { useEffect, useRef, useState } from 'react'
import {
  FolderOpen,
  ShieldAlert,
  Users,
  FileOutput,
  Pencil,
  Archive,
  Loader2,
  CheckCircle2
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Case } from '@shared/types'
import { Button } from '@renderer/components/ui'
import { ExportDialog } from '@renderer/components/export/ExportDialog'
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
  const [showExport, setShowExport] = useState(false)
  const { update, exportArchive } = useCasesMutations()
  const [archiveResult, setArchiveResult] = useState<{ filePath: string } | null>(null)
  const [archiveError, setArchiveError] = useState('')
  const [archiveProgress, setArchiveProgress] = useState<{ step: string; percent: number } | null>(
    null
  )

  // Tracks the currently-displayed case so a still-in-flight export that resolves
  // after a case switch can detect it's stale (the async closure captured the
  // old caseData). This route stays mounted across $caseId changes.
  const caseIdRef = useRef(caseData.id)

  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  const [editingDesc, setEditingDesc] = useState(false)
  const [descValue, setDescValue] = useState('')
  const descInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setNameValue(caseData.name)
    setDescValue(caseData.description ?? '')
    caseIdRef.current = caseData.id
    // Switching cases must not carry a stale export banner/progress across.
    setArchiveResult(null)
    setArchiveError('')
    setArchiveProgress(null)
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

  useEffect(() => {
    const unsubscribe = window.birdbrain.onArchiveProgress((event) => {
      if (event.caseId === caseData.id) {
        setArchiveProgress({ step: event.step, percent: event.percent })
      }
    })
    return unsubscribe
  }, [caseData.id])

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

  async function handleExportArchive() {
    const exportCaseId = caseData.id
    setArchiveError('')
    setArchiveResult(null)
    setArchiveProgress({ step: 'Preparing archive…', percent: 0 })
    try {
      const result = await exportArchive.mutateAsync(exportCaseId)
      // Ignore a completion that lands after the user switched cases.
      if (caseIdRef.current !== exportCaseId) return
      if (!result.canceled && result.filePath) {
        setArchiveResult({ filePath: result.filePath })
      }
    } catch (err) {
      if (caseIdRef.current !== exportCaseId) return
      setArchiveError(err instanceof Error ? err.message : String(err))
    } finally {
      if (caseIdRef.current === exportCaseId) setArchiveProgress(null)
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
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowExport(true)} className="gap-1.5">
            <FileOutput size={12} strokeWidth={1.8} />
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportArchive}
            disabled={exportArchive.isPending}
            className="gap-1.5"
          >
            {exportArchive.isPending ? (
              <Loader2 size={12} strokeWidth={1.8} className="animate-spin" />
            ) : (
              <Archive size={12} strokeWidth={1.8} />
            )}
            {exportArchive.isPending && archiveProgress
              ? `${archiveProgress.step} — ${Math.round(archiveProgress.percent)}%`
              : 'Export case archive'}
          </Button>
        </div>
        <span className="font-mono text-[10.5px] text-text-faint">
          Opened {formatRelativeTime(caseData.createdAt)}
        </span>
        {archiveResult && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-400"
          >
            <CheckCircle2 size={12} strokeWidth={1.8} className="shrink-0" />
            <span className="max-w-[220px] truncate" title={archiveResult.filePath}>
              Archive saved
            </span>
            <button
              type="button"
              className="font-semibold underline underline-offset-2 hover:text-emerald-300"
              onClick={() => window.birdbrain.shell.showItemInFolder(archiveResult.filePath)}
            >
              Show in folder
            </button>
          </div>
        )}
        {archiveError && (
          <div
            role="alert"
            aria-live="assertive"
            className="max-w-[260px] rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs text-red-400"
          >
            {archiveError}
          </div>
        )}
      </div>
      {showExport && (
        <ExportDialog
          caseId={caseData.id}
          caseName={caseData.name}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  )
}
