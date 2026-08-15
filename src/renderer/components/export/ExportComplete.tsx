import { useState } from 'react'
import { motion } from 'motion/react'
import type { TargetAndTransition, Transition } from 'motion/react'
import { CheckCircle2, FolderOpen, ExternalLink } from 'lucide-react'
import { Button } from '@renderer/components/ui'
import { revealInFolder, openPath } from '@renderer/lib/api/system'

interface ExportCompleteProps {
  filePath: string
  onClose: () => void
  celebrationProps?: { animate?: TargetAndTransition; transition?: Transition }
}

function splitPath(filePath: string): { dir: string; name: string } {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return idx === -1
    ? { dir: '', name: filePath }
    : { dir: filePath.slice(0, idx), name: filePath.slice(idx + 1) }
}

export function ExportComplete({ filePath, onClose, celebrationProps }: ExportCompleteProps) {
  const [actionError, setActionError] = useState('')
  const { dir, name } = splitPath(filePath)

  const reveal = async () => {
    setActionError('')
    try {
      await revealInFolder(filePath)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const open = async () => {
    setActionError('')
    try {
      await openPath(filePath)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="flex flex-col items-center text-center">
      <motion.div className="mb-3 text-emerald-500" {...celebrationProps}>
        <CheckCircle2 className="h-12 w-12" strokeWidth={1.5} />
      </motion.div>
      <p className="mb-1 text-base font-medium text-text-primary">Export complete</p>

      <div className="mb-4 w-full rounded-lg bg-elevated px-3 py-2 text-left" title={filePath}>
        <p className="truncate font-mono text-sm text-text-primary">{name}</p>
        {dir && <p className="truncate font-mono text-xs text-text-muted">{dir}</p>}
      </div>

      {actionError && (
        <div className="mb-3 w-full rounded bg-elevated px-3 py-2 text-left text-sm text-red-400">
          {actionError}
        </div>
      )}

      <div className="flex w-full justify-end gap-2">
        <Button variant="outline" size="sm" onClick={reveal}>
          <FolderOpen className="mr-1.5 h-4 w-4" />
          Reveal in folder
        </Button>
        <Button variant="outline" size="sm" onClick={open}>
          <ExternalLink className="mr-1.5 h-4 w-4" />
          Open file
        </Button>
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  )
}
