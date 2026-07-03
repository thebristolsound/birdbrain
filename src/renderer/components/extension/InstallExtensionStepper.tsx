import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Check, FolderOpen } from 'lucide-react'
import { Button } from '@renderer/components/ui'
import { INSTALL_STEPS } from './installSteps'

interface InstallExtensionStepperProps {
  className?: string
  /** Controlled step index — pass with onStepChange to drive navigation externally */
  step?: number
  onStepChange?: (step: number) => void
  /** Hide the built-in Back/Next row when the host renders its own controls */
  showNav?: boolean
}

export function InstallExtensionStepper({
  className,
  step: controlledStep,
  onStepChange,
  showNav = true
}: InstallExtensionStepperProps) {
  const [internalStep, setInternalStep] = useState(0)
  const step = controlledStep ?? internalStep
  const setStep = (next: number) => {
    setInternalStep(next)
    onStepChange?.(next)
  }
  const current = INSTALL_STEPS[step]
  const isLast = step === INSTALL_STEPS.length - 1
  const [openFolderError, setOpenFolderError] = useState<string | null>(null)

  const handleOpenFolder = async () => {
    try {
      setOpenFolderError(null)
      await window.birdbrain.extension.openFolder()
    } catch (err) {
      console.error('Failed to open extension folder:', err)
      setOpenFolderError('Could not open the extension folder. Please try again.')
    }
  }

  return (
    <div data-testid="install-stepper" className={className}>
      {/* Step tiles */}
      <div className="mb-5 flex items-center gap-2">
        {INSTALL_STEPS.map((s, i) => (
          <div key={s.title} className="flex flex-1 items-center gap-2 last:flex-none">
            <button
              type="button"
              data-testid={`install-stepper-tile-${i + 1}`}
              onClick={() => setStep(i)}
              aria-label={`Step ${i + 1}: ${s.title}`}
              aria-current={i === step ? 'step' : undefined}
              className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-[10px] border font-mono text-[13px] font-semibold transition-colors ${
                i === step
                  ? 'border-accent bg-accent text-white'
                  : i < step
                    ? 'border-accent/20 bg-accent-subtle text-accent'
                    : 'border-border-strong bg-surface text-text-muted hover:border-accent/40 hover:text-text-secondary'
              }`}
            >
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </button>
            {i < INSTALL_STEPS.length - 1 && <div className="step-connector flex-1" />}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.15, ease: 'easeInOut' }}
        >
          <div className="mb-3">
            <div className="font-display text-sm font-bold text-text-primary">{current.title}</div>
            <div className="text-[11px] text-text-muted">{current.sub}</div>
          </div>
          <div
            aria-hidden
            className="flex min-h-[220px] flex-col overflow-hidden rounded-xl border border-border-strong bg-surface"
          >
            <current.Visual />
          </div>
          <div className="mt-3 text-xs leading-relaxed text-text-muted">{current.caption}</div>
          {step === 1 && (
            <>
              <Button
                variant="outline"
                size="xs"
                onClick={handleOpenFolder}
                className="mt-3 gap-1.5"
              >
                <FolderOpen className="h-3 w-3" />
                Open extension folder
              </Button>
              {openFolderError && (
                <div
                  role="alert"
                  className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400"
                >
                  {openFolderError}
                </div>
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Step navigation */}
      {showNav && (
        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="ghost"
            size="xs"
            data-testid="install-stepper-back"
            onClick={() => setStep(step - 1)}
            disabled={step === 0}
            className={`gap-1 ${step === 0 ? 'invisible' : ''}`}
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </Button>
          <span className="font-mono text-[10px] text-text-faint">
            {step + 1} / {INSTALL_STEPS.length}
          </span>
          <Button
            variant="outline"
            size="xs"
            data-testid="install-stepper-next"
            onClick={() => setStep(step + 1)}
            disabled={isLast}
            className={`gap-1 ${isLast ? 'invisible' : ''}`}
          >
            Next
            <ArrowRight className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  )
}
