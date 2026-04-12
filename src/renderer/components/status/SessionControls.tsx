import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { motion, AnimatePresence } from 'motion/react'
import { useAppStore } from '@renderer/stores/appStore'
import { casesQueryOptions } from '@renderer/lib/queries'
import { presets } from '@renderer/lib/motion'
import { captureServerFetch } from '@renderer/lib/captureServerFetch'

export function SessionControls() {
  const sessionActive = useAppStore((s) => s.sessionActive)
  const setSessionActive = useAppStore((s) => s.setSessionActive)
  const connectedToExtension = useAppStore((s) => s.connectedToExtension)
  const { data: cases = [] } = useQuery(casesQueryOptions)
  const [toggling, setToggling] = useState(false)

  const params = useParams({ strict: false })
  const activeCaseId = (params as { caseId?: string }).caseId ?? null

  if (!connectedToExtension) return null

  const activeCase = cases.find((c) => c.id === activeCaseId)

  const handleToggleSession = async () => {
    if (toggling) return
    setToggling(true)
    try {
      if (sessionActive) {
        const res = await captureServerFetch('/api/session/stop', { method: 'POST' })
        if (!res.ok) {
          console.error('Failed to stop session:', res.status)
          return
        }
        setSessionActive(false)
      } else {
        if (!activeCaseId) return
        const activateRes = await captureServerFetch(`/api/cases/${activeCaseId}/activate`, {
          method: 'POST'
        })
        if (!activateRes.ok) {
          console.error('Failed to activate case:', activateRes.status)
          return
        }
        const startRes = await captureServerFetch('/api/session/start', { method: 'POST' })
        if (!startRes.ok) {
          console.error('Failed to start session:', startRes.status)
          return
        }
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
