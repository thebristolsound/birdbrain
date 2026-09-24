import { Camera } from 'lucide-react'
import { motion } from 'motion/react'
import { useReduceMotion } from '@renderer/hooks/useReduceMotion'
import { CLEAR_NARROWING_LABEL } from '@renderer/components/captures/captureListModel'

interface CaptureListEmptyStateProps {
  // Set when the case has captures and a narrowing hides every one of them.
  // The narrowing strip above the list already names each narrowing, so this
  // state only says that nothing matches and offers the one clear control.
  onClearNarrowing?: () => void
}

export function CaptureListEmptyState({ onClearNarrowing }: CaptureListEmptyStateProps) {
  const reduce = useReduceMotion()
  const narrowed = onClearNarrowing !== undefined

  return (
    <div
      data-testid={narrowed ? 'capture-list-narrowed-empty' : 'capture-list-empty-state'}
      className="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8 text-center"
    >
      <motion.div
        className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-canvas"
        animate={reduce ? undefined : { y: [0, -4, 0] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Camera className="h-4 w-4 text-text-faint" strokeWidth={1.6} />
      </motion.div>
      <div className="text-xs font-semibold text-text-secondary">
        {narrowed ? 'No captures match' : 'No captures yet'}
      </div>
      <p className="max-w-[200px] text-[11px] leading-[1.6] text-text-faint">
        {narrowed
          ? 'Nothing in this case matches the current filters.'
          : 'Browse the web with the Birdbrain extension active to start collecting captures for this case.'}
      </p>
      {narrowed && (
        <button
          type="button"
          onClick={onClearNarrowing}
          className="mt-0.5 rounded border border-border px-2.5 py-[5px] text-[11px] text-text-secondary hover:bg-elevated"
        >
          {CLEAR_NARROWING_LABEL}
        </button>
      )}
    </div>
  )
}
