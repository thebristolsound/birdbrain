import { useState, useRef, useEffect, memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Case } from '@shared/types'
import { Camera, ArrowUpRight, Users } from 'lucide-react'
import { Card } from '@renderer/components/ui'
import { useTimeTick } from '@renderer/hooks/useTimeTick'
import { membersQueryOptions } from '@renderer/lib/api/sharing'
import { getCaseTypeStyle } from '@renderer/components/dashboard/caseTypeStyle'
import { CaseMenu } from '@renderer/components/dashboard/CaseMenu'
import { timeAgo } from '@renderer/components/dashboard/timeAgo'
import { CaseRoleLine } from '@renderer/components/sharing/CaseRoleLine'
import {
  memberCount,
  sharedBadge,
  sharedWithTeammates
} from '@renderer/components/sharing/memberModel'

interface CaseCardProps {
  caseData: Case
  isRecording: boolean
  isActive: boolean
  captureCount: number
  onClick: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

export const CaseCard = memo(function CaseCard({
  caseData,
  isRecording,
  isActive,
  captureCount,
  onClick,
  onRename,
  onDelete
}: CaseCardProps) {
  const [editingName, setEditingName] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const nowMs = useTimeTick(60_000)

  const { icon: IconComponent, bgClass, iconClass } = getCaseTypeStyle(caseData.type)

  // A shared Case reads its roster for the badge and the role line
  // (docs/design-handoff/2026-10-28-share-a-case/, frame E); a local one has
  // nothing to read.
  const shared = Boolean(caseData.sharedAt)
  const { data: members } = useQuery({ ...membersQueryOptions(caseData.id), enabled: shared })
  // "Shared · n" from the first approved join, as the top bar's pill turns to
  // its sync state then; Recording and Active outrank it, and the role line
  // still says the Case is shared when the badge yields.
  const sharedCount = shared && members ? memberCount(members.members) : 0

  useEffect(() => {
    if (editingName !== null && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingName])

  function handleRenameSubmit(value: string) {
    const trimmed = value.trim()
    if (trimmed && trimmed !== caseData.name) {
      onRename(caseData.id, trimmed)
    }
    setEditingName(null)
  }

  return (
    <Card data-testid="case-card" className="p-5 cursor-pointer group relative" onClick={onClick}>
      {/* Top row */}
      <div className="flex justify-between mb-4">
        {/* Case icon */}
        <div className={`w-10 h-10 rounded-xl ${bgClass} flex items-center justify-center`}>
          <IconComponent className={`h-5 w-5 ${iconClass}`} />
        </div>

        {/* Status badge; the right margin keeps it clear of the kebab. */}
        {isRecording ? (
          <div className="mr-5 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[9px] font-bold text-danger-fg">Recording</span>
          </div>
        ) : isActive ? (
          <div className="mr-5 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-[9px] font-bold text-success-fg">Active</span>
          </div>
        ) : sharedCount > 1 ? (
          <div
            data-testid="case-shared-badge"
            title={sharedWithTeammates(sharedCount)}
            className="mr-5 flex h-5 items-center gap-1.5 rounded-full border border-border-strong px-2 text-[9px] font-bold text-text-secondary"
          >
            <Users className="h-2.5 w-2.5" strokeWidth={2.4} />
            <span>{sharedBadge(sharedCount)}</span>
          </div>
        ) : null}
      </div>

      {/* Title */}
      {editingName !== null ? (
        <input
          ref={inputRef}
          data-testid="case-rename-input"
          className="font-display font-bold text-sm text-text-primary mb-1 bg-transparent border border-border-strong rounded px-1 py-0.5 w-full outline-none focus:border-accent"
          defaultValue={editingName}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => handleRenameSubmit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRenameSubmit((e.target as HTMLInputElement).value)
            if (e.key === 'Escape') setEditingName(null)
          }}
        />
      ) : (
        <h3 className="font-display font-bold text-sm text-text-primary mb-1 group-hover:text-accent transition-colors">
          {caseData.name}
        </h3>
      )}

      {/* Description */}
      <p className="text-[11px] text-text-muted leading-relaxed mb-4 line-clamp-2">
        {caseData.description || 'No description'}
      </p>

      {/* Role line, then the stats row */}
      <CaseRoleLine shared={shared} members={members} nowMs={nowMs} className="mb-2.5" />
      <div className="flex items-center gap-4 mb-3">
        <div className="flex items-center gap-1.5">
          <Camera className="h-3 w-3 text-text-faint" />
          <span className="text-[11px] font-bold text-text-secondary">{captureCount}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-border-strong flex justify-between items-center">
        <span className="text-[10px] text-text-faint">
          Updated {timeAgo(caseData.updatedAt, nowMs)}
        </span>
        <ArrowUpRight className="h-4 w-4 text-text-faint group-hover:text-accent transition-colors" />
      </div>

      <CaseMenu
        caseData={caseData}
        className="absolute right-2 top-2"
        onRenameStart={() => setEditingName(caseData.name)}
        onDelete={onDelete}
      />
    </Card>
  )
})
