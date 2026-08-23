import { motion } from 'motion/react'
import { presets } from '@renderer/lib/motion'
import logoImg from '@renderer/assets/logo.png'

interface WelcomeCardProps {
  onStart: () => void
  onSkip: () => void
}

/** The centred card the intro chapter opens on. */
export function WelcomeCard({ onStart, onSkip }: WelcomeCardProps) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[73] flex items-center justify-center">
      <motion.div
        {...presets.modal}
        data-testid="tour-welcome"
        // Not aria-modal: the backdrop is pointer-events-none and the page
        // underneath stays usable on purpose, so claiming modality would tell
        // assistive tech the opposite of what the tour does. There is no focus
        // trap or Escape handling here either.
        role="dialog"
        aria-label="Welcome to Birdbrain"
        className="pointer-events-auto w-[380px] rounded-md border border-border-strong bg-elevated p-5 shadow-[0_16px_40px_rgba(0,0,0,0.5)]"
      >
        <img src={logoImg} alt="" className="mb-3 h-8 w-8" />
        <h2 className="mb-1.5 font-display text-base font-extrabold tracking-[-0.025em] text-text-primary">
          Welcome to Birdbrain
        </h2>
        <div className="mb-3 text-xs leading-relaxed text-text-muted">
          A quick tour of how evidence gets captured, organized, and exported. Two minutes here,
          three more inside your first case — skippable anytime.
        </div>
        <div className="mb-4 flex items-center gap-1.5">
          <span className="shrink-0 whitespace-nowrap rounded border border-border-strong bg-canvas px-[5px] py-px font-mono text-[10px] text-text-muted">
            Ctrl K
          </span>
          <span className="text-[11px] text-text-faint">replays this tour anytime</span>
        </div>
        <div className="flex items-center justify-between">
          <button
            data-testid="tour-skip"
            onClick={onSkip}
            className="border-none bg-transparent p-0 text-[11px] text-text-faint underline"
          >
            skip
          </button>
          <button
            data-testid="tour-next"
            onClick={onStart}
            className="h-7 shrink-0 whitespace-nowrap rounded border-none bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover"
          >
            Start tour
          </button>
        </div>
      </motion.div>
    </div>
  )
}
