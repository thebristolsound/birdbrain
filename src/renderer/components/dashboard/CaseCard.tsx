import { useState, useRef, useEffect, memo } from 'react'
import type { Case } from '@shared/types'
import { Camera, ArrowUpRight, ShieldAlert, Users, FolderOpen, MoreVertical } from 'lucide-react'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days !== 1 ? 's' : ''} ago`
}

const CASE_ICONS: Record<string, { icon: typeof FolderOpen; bgClass: string; iconClass: string }> =
  {
    crypto: {
      icon: FolderOpen,
      bgClass: 'bg-amber-950/50 border border-amber-800/30',
      iconClass: 'text-amber-400'
    },
    malware: {
      icon: ShieldAlert,
      bgClass: 'bg-sky-950/50 border border-sky-800/30',
      iconClass: 'text-sky-400'
    },
    fraud: {
      icon: Users,
      bgClass: 'bg-pink-950/50 border border-pink-800/30',
      iconClass: 'text-pink-400'
    }
  }
const DEFAULT_ICON = {
  icon: FolderOpen,
  bgClass: 'bg-accent-subtle border border-accent/20',
  iconClass: 'text-accent'
}

interface CaseCardProps {
  caseData: Case
  isRecording: boolean
  isActive: boolean
  captureCount: number
  onClick: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  animDelay?: string
}

export const CaseCard = memo(function CaseCard({
  caseData,
  isRecording,
  isActive,
  captureCount,
  onClick,
  onRename,
  onDelete,
  animDelay = 'd5'
}: CaseCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const {
    icon: IconComponent,
    bgClass,
    iconClass
  } = CASE_ICONS[caseData.type ?? ''] ?? DEFAULT_ICON

  useEffect(() => {
    if (editingName !== null && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingName])

  useEffect(() => {
    if (!menuOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setDeletingId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  function handleRenameSubmit(value: string) {
    const trimmed = value.trim()
    if (trimmed && trimmed !== caseData.name) {
      onRename(caseData.id, trimmed)
    }
    setEditingName(null)
  }

  return (
    <div
      data-testid="case-card"
      className={`anim-scale ${animDelay} neu-card rounded-2xl p-5 cursor-pointer group relative`}
      onClick={onClick}
    >
      {/* Top row */}
      <div className="flex justify-between mb-4">
        {/* Case icon */}
        <div className={`w-10 h-10 rounded-xl ${bgClass} flex items-center justify-center`}>
          <IconComponent className={`h-5 w-5 ${iconClass}`} />
        </div>

        {/* Status badge */}
        {isRecording ? (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-950/60 border border-red-800/40">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[9px] font-bold text-red-400">Recording</span>
          </div>
        ) : isActive ? (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800/40">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-[9px] font-bold text-emerald-400">Active</span>
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

      {/* Stats row */}
      <div className="flex items-center gap-4 mb-3">
        <div className="flex items-center gap-1.5">
          <Camera className="h-3 w-3 text-text-faint" />
          <span className="text-[11px] font-bold text-text-secondary">{captureCount}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-border-strong flex justify-between items-center">
        <span className="text-[10px] text-text-faint">Updated {timeAgo(caseData.updatedAt)}</span>
        <ArrowUpRight className="h-4 w-4 text-text-faint group-hover:text-accent transition-colors" />
      </div>

      {/* Context menu */}
      <div ref={menuRef} className="absolute right-2 top-2">
        <button
          data-testid="case-card-menu-btn"
          className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-elevated transition-all"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen(!menuOpen)
            setDeletingId(null)
          }}
        >
          <MoreVertical className="h-4 w-4 text-text-muted" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-8 z-50 w-32 rounded-lg bg-surface border border-border-strong shadow-xl py-1">
            {deletingId === caseData.id ? (
              <div className="px-2 py-1.5">
                <p className="text-[11px] text-red-400 font-bold mb-2">Delete?</p>
                <div className="flex gap-1.5">
                  <button
                    data-testid="case-card-delete-confirm-btn"
                    className="flex-1 text-[10px] font-bold px-2 py-1 rounded bg-red-950/60 text-red-400 border border-red-800/40 hover:bg-red-900/60"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(caseData.id)
                      setMenuOpen(false)
                      setDeletingId(null)
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    className="flex-1 text-[10px] font-bold px-2 py-1 rounded bg-elevated text-text-muted hover:bg-elevated"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeletingId(null)
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  data-testid="case-card-rename-btn"
                  className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:bg-elevated hover:text-text-primary"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingName(caseData.name)
                    setMenuOpen(false)
                  }}
                >
                  Rename
                </button>
                <button
                  data-testid="case-card-delete-btn"
                  className="w-full text-left px-3 py-1.5 text-[11px] text-red-400 hover:bg-elevated hover:text-red-300"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeletingId(caseData.id)
                  }}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
