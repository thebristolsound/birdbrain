import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { Radar, Puzzle, FolderPlus, ArrowRight, Check } from 'lucide-react'
import { useAppStore } from '@renderer/stores/appStore'
import { useCasesMutations } from '@renderer/lib/queries'

export function OnboardingWizard() {
  const navigate = useNavigate()
  const connectedToExtension = useAppStore((s) => s.connectedToExtension)
  const { create } = useCasesMutations()

  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleContinue = () => {
    setStep(1)
  }

  const handleSubmit = async () => {
    if (!name.trim() || submitting) return
    setSubmitting(true)
    try {
      const newCase = await create.mutateAsync({ name: name.trim() })
      navigate({ to: '/cases/$caseId/captures', params: { caseId: newCase.id } })
    } catch {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSubmit()
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-canvas">
      <div className="flex w-full max-w-md flex-col items-center">
        {/* Logo */}
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent shadow-[var(--shadow-btn)]">
          <Radar className="h-7 w-7 text-white" />
        </div>

        {/* Progress dots */}
        <div className="mb-8 flex items-center gap-2">
          <div
            className={`rounded-full transition-all duration-300 ${step === 0 ? 'w-6 bg-accent' : 'w-1.5 bg-elevated'} h-1.5`}
          />
          <div
            className={`rounded-full transition-all duration-300 ${step === 1 ? 'w-6 bg-accent' : 'w-1.5 bg-elevated'} h-1.5`}
          />
        </div>

        {/* Step cards */}
        <div className="relative w-full overflow-hidden">
          <AnimatePresence mode="wait">
            {step === 0 ? (
              <motion.div
                key="step-0"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="neu-card rounded-2xl p-8"
              >
                {/* Step header */}
                <div className="mb-6 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-subtle">
                    <Puzzle className="h-5 w-5 text-accent" />
                  </div>
                  <div>
                    <h2 className="font-display text-lg font-bold text-text-primary">
                      Connect Extension
                    </h2>
                    <p className="text-sm text-text-muted">Step 1 of 2</p>
                  </div>
                </div>

                {/* Body */}
                <p className="mb-6 text-sm leading-relaxed text-text-secondary">
                  Birdbrain works with the Chrome extension to capture web content for your
                  investigations. Install the extension to start capturing pages, screenshots, and
                  MHTML archives directly from your browser.
                </p>

                {/* Connection status */}
                <div className="mb-8 flex items-center gap-3 rounded-xl border border-border-strong bg-elevated px-4 py-3">
                  {connectedToExtension ? (
                    <>
                      <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
                      <span className="flex-1 text-sm text-text-secondary">
                        Extension connected
                      </span>
                      <Check className="h-4 w-4 text-emerald-500" />
                    </>
                  ) : (
                    <>
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-slate-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-slate-400" />
                      </span>
                      <span className="flex-1 text-sm text-text-muted">
                        Waiting for extension...
                      </span>
                    </>
                  )}
                </div>

                {/* Footer */}
                <div className="flex justify-end">
                  <button
                    onClick={handleContinue}
                    className="flex items-center gap-2 rounded-xl bg-accent px-6 py-2.5 text-sm font-medium text-white shadow-[var(--shadow-btn)] transition hover:bg-accent-hover"
                  >
                    {connectedToExtension ? 'Continue' : 'Skip for now'}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="neu-card rounded-2xl p-8"
              >
                {/* Step header */}
                <div className="mb-6 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-subtle">
                    <FolderPlus className="h-5 w-5 text-accent" />
                  </div>
                  <div>
                    <h2 className="font-display text-lg font-bold text-text-primary">
                      Create Investigation
                    </h2>
                    <p className="text-sm text-text-muted">Step 2 of 2</p>
                  </div>
                </div>

                {/* Body */}
                <p className="mb-6 text-sm leading-relaxed text-text-secondary">
                  Investigations are workspaces for organizing your captures, notes, and analysis.
                  Give this investigation a name that describes what you're looking into.
                </p>

                {/* Input */}
                <div className="mb-8">
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                    Investigation Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="e.g. Phishing Campaign Analysis"
                    className="w-full rounded-xl border border-border-strong bg-elevated px-4 py-2.5 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
                    autoFocus
                  />
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setStep(0)}
                    className="text-sm text-text-muted transition hover:text-text-primary"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!name.trim() || submitting}
                    className="flex items-center gap-2 rounded-xl bg-accent px-6 py-2.5 text-sm font-medium text-white shadow-[var(--shadow-btn)] transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? 'Creating...' : 'Create & Start'}
                    {!submitting && <ArrowRight className="h-4 w-4" />}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Keyboard hint */}
        <p className="mt-6 text-xs text-text-faint">
          <kbd className="rounded border border-border-strong px-1.5 py-0.5 font-mono text-[10px]">
            Ctrl + K
          </kbd>{' '}
          to search investigations
        </p>
      </div>
    </div>
  )
}
