import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { launchedBrowserStatusQueryOptions } from '@renderer/lib/api/launchedBrowser'
import { useParams } from '@tanstack/react-router'
import { motion, AnimatePresence } from 'motion/react'
import { useAppStore } from '@renderer/stores/appStore'
import { casesQueryOptions, useSessionMutations } from '@renderer/lib/queries'
import { presets } from '@renderer/lib/motion'
import { confirmContact } from '@renderer/lib/vpnWarning'

export function SessionControls() {
  const sessionActive = useAppStore((s) => s.sessionActive)
  const setSessionActive = useAppStore((s) => s.setSessionActive)
  const connectedToExtension = useAppStore((s) => s.connectedToExtension)
  const { data: cases = [] } = useQuery(casesQueryOptions)
  const { data: launched } = useQuery(launchedBrowserStatusQueryOptions)
  const [toggling, setToggling] = useState(false)
  const { activateCase, start, stop } = useSessionMutations()
  const setStopConfirmOpen = useAppStore((s) => s.setStopConfirmOpen)

  const params = useParams({ strict: false })
  const activeCaseId = (params as { caseId?: string }).caseId ?? null

  // Shown while the extension is connected or a launched browser is open (S2), and while the
  // Capture Session a launched browser left running on closing still runs.
  const launchedSession = launched?.state === 'open' || launched?.state === 'closed'
  if (!connectedToExtension && !launchedSession) return null

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
        // A session's Captures contact sites, so its start passes the VPN warning (ADR-0032).
        if (!(await confirmContact({ caseId: activeCaseId }, 'session'))) return
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
    <div className="flex items-center gap-2 whitespace-nowrap">
      <label className="flex cursor-pointer items-center gap-1.5">
        <span className="text-xs text-text-muted">Capture Session</span>
        <button
          type="button"
          role="switch"
          aria-checked={sessionActive}
          aria-label="Capture Session"
          // Stopping closes an open launched browser, so the switch asks first (`1i`).
          onClick={
            sessionActive && launched?.state === 'open'
              ? () => setStopConfirmOpen(true)
              : handleToggleSession
          }
          disabled={toggling || (!sessionActive && !activeCaseId)}
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
            title={activeCase.name}
            className="hidden max-w-[140px] truncate text-xs text-text-muted lg:inline"
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
