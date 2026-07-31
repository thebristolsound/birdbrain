import { motion } from 'motion/react'

interface ExportProgressProps {
  step: string
  percent: number
}

// Determinate progress driven by real export events. The bar width is always the
// true percent; the shimmer is a "still working" affordance for the long stages
// (verify / screenshots) so the bar never looks frozen between updates.
export function ExportProgress({ step, percent }: ExportProgressProps) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)))

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-text-secondary">{step}</span>
        <span className="tabular-nums text-text-muted">{pct}%</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-elevated"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={step}
      >
        <div
          className="relative h-full overflow-hidden rounded-full bg-accent transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        >
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
            animate={{ x: ['-100%', '100%'] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
          />
        </div>
      </div>
    </div>
  )
}
