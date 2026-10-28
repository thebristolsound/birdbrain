import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { presets } from '@renderer/lib/motion'
import { settingsQueryOptions, useSettingsMutations } from '@renderer/lib/api/settings'
import { casesQueryOptions } from '@renderer/lib/api/cases'
import { sharingAvailableQueryOptions } from '@renderer/lib/api/sharing'
import { useAppStore } from '@renderer/stores/appStore'
import { SHARE_MARK_KEY, shouldShowShareMark } from '@renderer/components/onboarding/tourSteps'
import {
  isRectVisible,
  markLayout,
  rectMoved,
  TOOLTIP_WIDTH,
  type TourRect,
  type Viewport
} from '@renderer/components/onboarding/tourGeometry'
import { COPY } from '@renderer/components/sharing/memberModel'

// The one-time Share mark (docs/design-handoff/2026-10-28-share-a-case/,
// frame A): a card under the top bar's Share pill the first time a Case is
// opened after the pill arrives. A feature mark, not a tour chapter: no
// counter, no skip link, no spotlight, and the rest of the screen stays
// usable. The pill wears a ring while it shows (SharePill reads the store
// flag), and any dismissal is recorded once under `onboardingChapters.share`.
const ANCHOR = 'share'
// The pill mounts once its reads land, which is later than a route change, so
// this looks longer than the tour engine does before giving up.
const ANCHOR_RETRY_MS = 60
const ANCHOR_RETRY_LIMIT = 20

function readViewport(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight }
}

function measure(): TourRect | null {
  const el = document.querySelector(`[data-tour="${ANCHOR}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

export function ShareCoachMark() {
  const { data: settings } = useQuery(settingsQueryOptions)
  const { data: cases = [] } = useQuery(casesQueryOptions)
  const { data: available } = useQuery(sharingAvailableQueryOptions)
  const { update } = useSettingsMutations()
  const params = useParams({ strict: false }) as Record<string, string | undefined>
  const caseId = params.caseId ?? null
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  const setShareMarkOpen = useAppStore((s) => s.setShareMarkOpen)
  const [rect, setRect] = useState<TourRect | null>(null)
  const [viewport, setViewport] = useState<Viewport>(readViewport)
  // Dismissed for this window before the settings write lands.
  const [dismissed, setDismissed] = useState(false)

  // Inside a Case, where the pill is; never where sharing is unavailable, and
  // never once any Case on this installation is shared or joined.
  const eligible =
    !dismissed &&
    caseId !== null &&
    pathname.startsWith('/cases/') &&
    pathname !== '/cases/new' &&
    available === true &&
    shouldShowShareMark(settings) &&
    !cases.some((c) => c.sharedAt)

  useLayoutEffect(() => {
    if (!eligible) {
      setRect(null)
      return
    }
    let attempts = 0
    let timer = 0
    let cancelled = false
    function attempt(): void {
      if (cancelled) return
      const found = measure()
      if (found && isRectVisible(found, readViewport())) {
        setRect((previous) => (rectMoved(previous, found) ? found : previous))
        return
      }
      attempts += 1
      if (attempts > ANCHOR_RETRY_LIMIT) return
      timer = window.setTimeout(attempt, ANCHOR_RETRY_MS)
    }
    attempt()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [eligible, pathname])

  useEffect(() => {
    if (!eligible) return
    function remeasure(): void {
      setViewport(readViewport())
      const found = measure()
      if (found && isRectVisible(found, readViewport())) {
        setRect((previous) => (rectMoved(previous, found) ? found : previous))
      }
    }
    window.addEventListener('resize', remeasure)
    return () => window.removeEventListener('resize', remeasure)
  }, [eligible])

  const open = eligible && rect !== null

  useEffect(() => {
    setShareMarkOpen(open)
    return () => setShareMarkOpen(false)
  }, [open, setShareMarkOpen])

  const dismiss = useCallback(() => {
    setDismissed(true)
    update.mutate({
      onboardingChapters: { ...(settings?.onboardingChapters ?? {}), [SHARE_MARK_KEY]: true }
    })
  }, [settings?.onboardingChapters, update])

  // Clicking the pill itself is a dismissal too: the pill opens Members, which
  // is what Show me does.
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent): void {
      const target = e.target as Element | null
      if (target?.closest?.(`[data-tour="${ANCHOR}"]`)) dismiss()
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [dismiss, open])

  if (!open || !rect || !caseId) return null
  const layout = markLayout(rect, viewport)
  const arrowStyle = (below: boolean) => ({
    margin: below
      ? `0 0 -5px ${layout.arrow.marginLeft}px`
      : `-5px 0 0 ${layout.arrow.marginLeft}px`
  })

  return (
    <div
      data-testid="share-mark"
      data-flipped={layout.tooltip.flipped ? 'true' : 'false'}
      className="fixed z-[73]"
      style={{
        width: TOOLTIP_WIDTH,
        top: layout.tooltip.top,
        left: layout.tooltip.left,
        transform: layout.tooltip.flipped ? 'translateY(-100%)' : undefined
      }}
    >
      <motion.div {...presets.fadeIn}>
        {layout.arrow.below ? (
          <div
            className="h-2.5 w-2.5 rotate-45 border-l border-t border-border-strong bg-elevated"
            style={arrowStyle(true)}
          />
        ) : null}
        <div
          role="dialog"
          aria-label={COPY.shareMarkTitle}
          className="rounded-md border border-border-strong bg-elevated px-4 py-3.5 shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
        >
          <p className="text-xs font-semibold text-text-primary">{COPY.shareMarkTitle}</p>
          <p className="mt-1 text-[11px] leading-[1.55] text-text-secondary">
            {COPY.shareMarkBody}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              data-testid="share-mark-show-me"
              onClick={() => {
                dismiss()
                navigate({ to: '/cases/$caseId/settings', params: { caseId } })
              }}
              className="h-[26px] shrink-0 rounded border-none bg-accent px-2.5 text-[11px] font-medium text-white hover:bg-accent-hover"
            >
              {COPY.showMe}
            </button>
            <button
              data-testid="share-mark-got-it"
              onClick={dismiss}
              className="h-[26px] shrink-0 border-none bg-transparent px-2 text-[11px] text-text-muted hover:text-text-primary"
            >
              {COPY.gotIt}
            </button>
          </div>
        </div>
        {layout.arrow.below ? null : (
          <div
            className="h-2.5 w-2.5 rotate-45 border-b border-r border-border-strong bg-elevated"
            style={arrowStyle(false)}
          />
        )}
      </motion.div>
    </div>
  )
}
