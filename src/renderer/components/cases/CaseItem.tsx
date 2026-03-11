import { useState, useRef, useEffect } from 'react'
import type { Case } from '@shared/types'

interface CaseItemProps {
  caseData: Case
  isActive: boolean
  isRecording: boolean
  onClick: () => void
  onDelete: () => void
  onRename: (name: string) => void
}

export function CaseItem({ caseData, isActive, isRecording, onClick, onDelete, onRename }: CaseItemProps) {
  const [showMenu, setShowMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(caseData.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const handleRename = () => {
    if (editName.trim() && editName !== caseData.name) {
      onRename(editName.trim())
    }
    setEditing(false)
  }

  return (
    <div
      data-testid="case-item"
      className={`group relative flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ${
        isActive ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200'
      }`}
      onClick={!editing ? onClick : undefined}
      onContextMenu={(e) => {
        e.preventDefault()
        setShowMenu(true)
      }}
    >
      {isRecording && (
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
      )}
      {editing ? (
        <input
          ref={inputRef}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRename()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="flex-1 rounded bg-neutral-700 px-1 text-sm text-neutral-100 outline-none"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 truncate">{caseData.name}</span>
      )}

      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className="absolute left-full top-0 z-50 ml-1 rounded border border-neutral-700 bg-neutral-800 py-1 shadow-lg">
            <button
              data-testid="case-rename-btn"
              className="block w-full px-3 py-1 text-left text-xs text-neutral-300 hover:bg-neutral-700"
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(false)
                setEditing(true)
                setEditName(caseData.name)
              }}
            >
              Rename
            </button>
            <button
              data-testid="case-delete-btn"
              className="block w-full px-3 py-1 text-left text-xs text-red-400 hover:bg-neutral-700"
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(false)
                onDelete()
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}
