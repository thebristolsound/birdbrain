import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  launchedBrowserName,
  launchedBrowserStatusQueryOptions
} from '@renderer/lib/api/launchedBrowser'
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
  const sessionCaseId = useAppStore((s) => s.activeCaseId)
  const { data: cases = [] } = useQuery(casesQueryOptions)
  const { data: launched } = useQuery(launchedBrowserStatusQueryOptions)
  const [toggling, setToggling] = useState(false)
  const { activateCase, start, stop } = useSessionMutations()

  const params = useParams({ strict: false })
  const activeCaseId = (params as { caseId?: string }).caseId ?? null

  // While a launched browser is open, or has closed with its Capture Session still running, the
  // Capture Session panel holds the one stop control, at most a click away in every form the
  // panel takes. The switch is for the extension's session, which has no panel.
  const launchedSession = launched?.state === 'open' || launched?.state === 'closed'
  const showSwitch = connectedToExtension && !launchedSession

  // A label shows only for what the rest of the window does not say, on Case screens: after the
  // switch for the extension's session, and alone for a launched browser's. The breadcrumb names
  // the Case on screen, and the Active Case, the one Captures go into, can be another: a launched
  // browser pins the Case it started in, and the extension can choose one too.
  const intoCase =
    activeCaseId && sessionCaseId !== activeCaseId
      ? cases.find((c) => c.id === sessionCaseId)
      : undefined
  // Beside an open launched browser the recording mark names no source on a Case screen, and
  // the Capture Session panel names only the browser, so both sources are named here while the
  // extension is connected too.
  const sources =
    activeCaseId && launched?.state === 'open' && connectedToExtension
      ? `${launchedBrowserName(launched.browser.label)}, and the extension`
      : null
  const label = [intoCase?.name, sources].filter(Boolean).join(' · ')
  if (!showSwitch && !(launchedSession && sessionActive && label)) return null

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
    <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
      {showSwitch && (
        <label className="flex cursor-pointer items-center gap-1.5">
          <span className="text-xs text-text-muted">Capture Session</span>
          <button
            type="button"
            role="switch"
            aria-checked={sessionActive}
            aria-label="Capture Session"
            onClick={handleToggleSession}
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
      )}
      <AnimatePresence>
        {sessionActive && label && (
          <motion.span
            data-testid="session-source-line"
            title={label}
            className="hidden min-w-0 text-xs text-text-muted lg:inline-flex"
            initial={presets.fadeIn.initial}
            animate={presets.fadeIn.animate}
            exit={presets.fadeIn.exit}
            transition={presets.fadeIn.transition}
          >
            {intoCase && <span className="max-w-[140px] truncate">{intoCase.name}</span>}
            {sources && (
              <span className="overflow-hidden text-ellipsis whitespace-pre">
                {intoCase ? ` · ${sources}` : sources}
              </span>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}
