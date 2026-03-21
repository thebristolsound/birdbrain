import { useState, useRef, useEffect } from 'react'
import type { Case } from '@shared/types'
import {
  Camera, Fingerprint, ArrowUpRight,
  ShieldAlert, Users, FolderOpen, MoreVertical
} from 'lucide-react'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

const CASE_ICONS: Record<string, { icon: typeof FolderOpen; bgClass: string; iconClass: string }> = {
  crypto: { icon: FolderOpen, bgClass: 'bg-amber-950/50 border border-amber-800/30', iconClass: 'text-amber-400' },
  malware: { icon: ShieldAlert, bgClass: 'bg-sky-950/50 border border-sky-800/30', iconClass: 'text-sky-400' },
  fraud: { icon: Users, bgClass: 'bg-pink-950/50 border border-pink-800/30', iconClass: 'text-pink-400' },
}
const DEFAULT_ICON = { icon: FolderOpen, bgClass: 'bg-indigo-950/50 border border-indigo-800/30', iconClass: 'text-indigo-400' }

interface CaseCardProps {
  caseData: Case
  isRecording: boolean
  captureCount?: number
  entityCount?: number
  onClick: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  animDelay?: string
}

export function CaseCard({
  caseData,
  isRecording,
  captureCount,
  entityCount,
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

  const { icon: IconComponent, bgClass, iconClass } = CASE_ICONS[caseData.type ?? ''] ?? DEFAULT_ICON

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
      role="button"
      tabIndex={0}
      aria-label={`Open case ${caseData.name}`}
      className={`anim-scale ${animDelay} neu-card rounded-2xl p-5 cursor-pointer group relative`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
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
        ) : (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800/40">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-[9px] font-bold text-emerald-400">Active</span>
          </div>
        )}
      </div>

      {/* Title */}
      {editingName !== null ? (
        <input
          ref={inputRef}
          className="font-display font-bold text-sm text-slate-50 mb-1 bg-transparent border border-slate-700 rounded px-1 py-0.5 w-full outline-none focus:border-indigo-500"
          defaultValue={editingName}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => handleRenameSubmit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRenameSubmit((e.target as HTMLInputElement).value)
            if (e.key === 'Escape') setEditingName(null)
          }}
        />
      ) : (
        <h3 className="font-display font-bold text-sm text-slate-50 mb-1 group-hover:text-indigo-400 transition-colors">
          {caseData.name}
        </h3>
      )}

      {/* Description */}
      <p className="text-[11px] text-slate-500 leading-relaxed mb-4 line-clamp-2">
        {caseData.description || 'No description'}
      </p>

      {/* Stats row */}
      <div className="flex items-center gap-4 mb-3">
        <div className="flex items-center gap-1.5">
          <Camera className="h-3 w-3 text-slate-600" />
          <span
            className="text-[11px] font-bold text-slate-300"
            aria-label={
              captureCount === undefined
                ? 'Capture count unavailable'
                : `${captureCount} ${captureCount === 1 ? 'capture' : 'captures'}`
            }
          >
            {captureCount ?? 'N/A'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Fingerprint className="h-3 w-3 text-slate-600" />
          <span
            className="text-[11px] font-bold text-slate-300"
            aria-label={
              entityCount === undefined
                ? 'Entity count unavailable'
                : `${entityCount} ${entityCount === 1 ? 'entity' : 'entities'}`
            }
          >
            {entityCount ?? 'N/A'}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-slate-800/60 flex justify-between items-center">
        <span className="text-[10px] text-slate-600">Updated {timeAgo(caseData.updatedAt)}</span>
        <ArrowUpRight className="h-4 w-4 text-slate-700 group-hover:text-indigo-400 transition-colors" />
      </div>

      {/* Context menu */}
      <div ref={menuRef} className="absolute right-2 top-2">
        <button
          type="button"
          aria-label="Case actions"
          className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-slate-800 transition-all"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen(!menuOpen)
            setDeletingId(null)
          }}
        >
          <MoreVertical className="h-4 w-4 text-slate-500" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-8 z-50 w-32 rounded-lg bg-slate-900 border border-slate-800 shadow-xl py-1">
            {deletingId === caseData.id ? (
              <div className="px-2 py-1.5">
                <p className="text-[11px] text-red-400 font-bold mb-2">Delete?</p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
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
                    type="button"
                    className="flex-1 text-[10px] font-bold px-2 py-1 rounded bg-slate-800 text-slate-400 hover:bg-slate-700"
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
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-slate-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingName(caseData.name)
                    setMenuOpen(false)
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-[11px] text-red-400 hover:bg-slate-800 hover:text-red-300"
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
}
