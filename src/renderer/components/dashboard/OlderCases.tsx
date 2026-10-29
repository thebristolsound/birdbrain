import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { Case } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { useTimeTick } from '@renderer/hooks/useTimeTick'
import { membersQueryOptions } from '@renderer/lib/api/sharing'
import { getCaseTypeStyle } from '@renderer/components/dashboard/caseTypeStyle'
import { CaseMenu } from '@renderer/components/dashboard/CaseMenu'
import { timeAgo } from '@renderer/components/dashboard/timeAgo'
import { CaseRoleLine } from '@renderer/components/sharing/CaseRoleLine'
import { COPY } from '@renderer/components/sharing/memberModel'

// The grid shows this many Cases as cards; the rest are listed here.
export const RECENT_CASE_COUNT = 3

// Every Case after the three the grid shows (docs/design-handoff/
// 2026-10-28-share-a-case/, frame E), so an older Case can be opened,
// renamed, shared or deleted from the dashboard. Absent with three Cases or
// fewer.
interface OlderCasesProps {
  cases: Case[]
  captureCounts: Record<string, number>
  onSelectCase: (id: string) => void
  onRenameCase: (id: string, name: string) => void
  onDeleteCase: (id: string) => void
}

const COLUMNS = 'grid grid-cols-[minmax(0,1fr)_90px_220px_36px] items-center px-5'

export function OlderCases({
  cases,
  captureCounts,
  onSelectCase,
  onRenameCase,
  onDeleteCase
}: OlderCasesProps) {
  const older = cases.slice(RECENT_CASE_COUNT)
  const nowMs = useTimeTick(60_000)
  if (older.length === 0) return null
  return (
    <div data-testid="older-cases" className="mt-7 rounded-md border border-border bg-card">
      <div
        className={cn(
          COLUMNS,
          'border-b border-border py-2 text-[10px] font-medium uppercase tracking-[.05em] text-text-faint'
        )}
      >
        <span>Older Cases · {older.length}</span>
        <span>Captures</span>
        <span>Sharing</span>
        <span />
      </div>
      {older.map((c) => (
        <OlderCaseRow
          key={c.id}
          caseData={c}
          captureCount={captureCounts[c.id] || 0}
          nowMs={nowMs}
          onSelect={() => onSelectCase(c.id)}
          onRename={onRenameCase}
          onDelete={onDeleteCase}
        />
      ))}
    </div>
  )
}

interface OlderCaseRowProps {
  caseData: Case
  captureCount: number
  nowMs: number
  onSelect: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

function OlderCaseRow({
  caseData,
  captureCount,
  nowMs,
  onSelect,
  onRename,
  onDelete
}: OlderCaseRowProps) {
  const navigate = useNavigate()
  const shared = Boolean(caseData.sharedAt)
  const { data: members } = useQuery({ ...membersQueryOptions(caseData.id), enabled: shared })
  const [editingName, setEditingName] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { dotClass } = getCaseTypeStyle(caseData.type)

  useEffect(() => {
    if (editingName !== null && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingName])

  function handleRenameSubmit(value: string) {
    const trimmed = value.trim()
    if (trimmed && trimmed !== caseData.name) onRename(caseData.id, trimmed)
    setEditingName(null)
  }

  return (
    <div
      data-testid="older-case-row"
      onClick={onSelect}
      className={cn(
        COLUMNS,
        'group relative min-h-10 cursor-pointer border-b border-border text-xs transition-colors last:border-b-0 hover:bg-elevated'
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', dotClass)} />
        {editingName !== null ? (
          <input
            ref={inputRef}
            data-testid="case-rename-input"
            className="w-full rounded border border-border-strong bg-transparent px-1 py-0.5 text-xs font-medium text-text-primary outline-none focus:border-accent"
            defaultValue={editingName}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => handleRenameSubmit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit((e.target as HTMLInputElement).value)
              if (e.key === 'Escape') setEditingName(null)
            }}
          />
        ) : (
          <>
            <span className="truncate font-medium text-text-primary">{caseData.name}</span>
            <span className="shrink-0 text-[10px] text-text-faint">
              {timeAgo(caseData.updatedAt, nowMs)}
            </span>
          </>
        )}
      </div>
      <span className="tabular-nums text-text-muted">{captureCount}</span>
      {shared ? (
        <CaseRoleLine shared members={members} nowMs={nowMs} />
      ) : (
        // A local Case's Sharing cell offers sharing, so it opens Members as the
        // menu item does, not the Case the row opens.
        <button
          type="button"
          data-testid="older-case-share"
          className="min-w-0 justify-self-start truncate text-[11px] text-text-muted hover:text-text-primary hover:underline"
          onClick={(e) => {
            e.stopPropagation()
            navigate({ to: '/cases/$caseId/settings', params: { caseId: caseData.id } })
          }}
        >
          {COPY.shareThisCase}
        </button>
      )}
      <CaseMenu
        caseData={caseData}
        alwaysVisible
        className="relative"
        onRenameStart={() => setEditingName(caseData.name)}
        onDelete={onDelete}
      />
    </div>
  )
}
