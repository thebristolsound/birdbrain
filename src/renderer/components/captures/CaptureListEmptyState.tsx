import { Layers, Plus } from 'lucide-react'
import { motion } from 'motion/react'
import { useReduceMotion } from '@renderer/hooks/useReduceMotion'

export function CaptureListEmptyState() {
  const reduce = useReduceMotion()

  return (
    <div
      data-testid="capture-list-empty-state"
      className="flex flex-1 flex-col items-center justify-center px-8 py-10"
    >
      <div className="relative mb-5">
        <motion.div
          className="flex h-20 w-20 items-center justify-center rounded-2xl bg-accent-subtle"
          animate={reduce ? undefined : { y: [0, -8, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Layers className="h-7 w-7 text-accent" />
        </motion.div>
        <div className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10">
          <Plus className="h-3 w-3 text-amber-500" />
        </div>
      </div>
      <h3 className="mb-1.5 text-sm font-semibold text-text-primary">No captures yet</h3>
      <p className="max-w-[240px] text-center text-xs leading-relaxed text-text-muted">
        Browse the web with the Birdbrain extension active to start collecting captures for this
        case.
      </p>
    </div>
  )
}
