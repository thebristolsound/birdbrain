import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { motion, AnimatePresence } from 'motion/react'
import { useAppStore } from '@renderer/stores/appStore'
import { casesQueryOptions, useSessionMutations } from '@renderer/lib/queries'
import { presets } from '@renderer/lib/motion'

export function SessionControls() {
  const sessionActive = useAppStore((s) => s.sessionActive)
  const setSessionActive = useAppStore((s) => s.setSessionActive)
  const connectedToExtension = useAppStore((s) => s.connectedToExtension)
  const { data: cases = [] } = useQuery(casesQueryOptions)
  const [toggling, setToggling] = useState(false)
  const { activateCase, start, stop } = useSessionMutations()

  const params = useParams({ strict: false })
  const activeCaseId = (params as { caseId?: string }).caseId ?? null

  if (!connectedToExtension) return null

  const activeCase = cases.find((c) => c.id === activeCaseId)

  const handleToggleSession = async () => {
    if (toggling) return
    setToggling(true)
    try {
      if (sessionActive) {
        await stop.mutateAsync()
        setSessionActive(false)
      } else {
        if (!activeCaseId) return
        // Activate before starting: the main-side start refuses without an
        // active case, same as the HTTP route it replaces.
        await activateCase.mutateAsync(activeCaseId)
        await start.mutateAsync()
        setSessionActive(true)
      }
    } catch (error) {
      console.error('Failed to toggle session:', error)
    } finally {
      setToggling(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label className="flex cursor-pointer items-center gap-1.5">
        <span className="text-xs text-text-muted">Auto-Capture</span>
        <button
          type="button"
          role="switch"
          aria-checked={sessionActive}
          aria-label="Auto-Capture"
          onClick={handleToggleSession}
          disabled={!activeCaseId || toggling}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
            sessionActive ? 'bg-accent' : 'bg-text-faint'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              sessionActive ? 'translate-x-4.5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </label>
      <AnimatePresence>
        {sessionActive && activeCase && (
          <motion.span
            className="text-xs text-text-muted"
            initial={presets.fadeIn.initial}
            animate={presets.fadeIn.animate}
            exit={presets.fadeIn.exit}
            transition={presets.fadeIn.transition}
          >
            {activeCase.name}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}
