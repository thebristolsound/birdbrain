import { useEffect, useRef, useState } from 'react'
import { useParams, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { settingsQueryOptions } from '@renderer/lib/api/settings'
import { presets } from '@renderer/lib/motion'
import { useTourEngine } from '@renderer/components/onboarding/useTourEngine'
import { shouldAutoFire } from '@renderer/components/onboarding/tourSteps'
import { dimOpacity, type Viewport } from '@renderer/components/onboarding/tourGeometry'
import { TOUR_EVENT, type TourEventDetail } from '@renderer/components/onboarding/startTour'
import { WelcomeCard } from '@renderer/components/onboarding/WelcomeCard'
import { CoachMark } from '@renderer/components/onboarding/CoachMark'
import { ScreenCard } from '@renderer/components/onboarding/ScreenCard'

function readViewport(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight }
}

/**
 * The one mounted tour.
 *
 * Owns auto-firing, the replay listener, and which of the three surfaces the
 * current step renders. Everything measurable lives in `useTourEngine`, and
 * everything decidable without a DOM lives in `tourSteps`/`tourGeometry`.
 */
export function OnboardingTour() {
  const { data: settings } = useQuery(settingsQueryOptions)
  const params = useParams({ strict: false }) as Record<string, string | undefined>
  const caseId = params.caseId ?? null
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const engine = useTourEngine(caseId)
  const [viewport, setViewport] = useState<Viewport>(readViewport)

  const { start } = engine
  // Auto-fire happens once per mount per chapter regardless of what the
  // settings write does, so a slow round trip cannot fire the same chapter
  // twice.
  const fired = useRef<Record<string, boolean>>({})

  useEffect(() => {
    function onResize(): void {
      setViewport(readViewport())
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    function onTour(e: Event): void {
      const detail = (e as CustomEvent<TourEventDetail>).detail
      if (detail?.chapter) start(detail.chapter)
    }
    window.addEventListener(TOUR_EVENT, onTour)
    return () => window.removeEventListener(TOUR_EVENT, onTour)
  }, [start])

  // The intro chapter, on a fresh install that has not seen it.
  useEffect(() => {
    if (!settings || fired.current.intro) return
    if (!shouldAutoFire(settings, 'intro')) return
    fired.current.intro = true
    start('intro', { auto: true })
  }, [settings, start])

  // The case chapter, the first time a fresh install opens a case. It always
  // opens on Captures, whichever case tab the operator actually clicked.
  useEffect(() => {
    if (!settings || !caseId || fired.current.case) return
    if (!pathname.startsWith('/cases/') || pathname === '/cases/new') return
    if (!shouldAutoFire(settings, 'case')) return
    fired.current.case = true
    start('case', { auto: true })
  }, [caseId, pathname, settings, start])

  const { step, steps, stepIndex, rect, anchorMissing, installOpen, next, skip, toggleInstall } =
    engine

  const kind = step ? (step.welcome ? 'welcome' : step.screen ? 'screen' : 'mark') : null
  // A measured rect means the ring's own 100vmax spread shadow is dimming the
  // page, so the flat layer goes to zero rather than dimming it twice.
  const dim = kind ? dimOpacity(kind, Boolean(rect)) : 0
  // An anchored step holds back its card until the anchor either resolves or is
  // declared missing, so a step that navigates does not flash a centred card and
  // then jump to the target a frame later.
  const placed = Boolean(rect) || anchorMissing

  return (
    <AnimatePresence>
      {step ? (
        <motion.div key="tour" {...presets.overlay} data-testid="onboarding-tour">
          <div
            data-testid="tour-dim"
            className="pointer-events-none fixed inset-0 z-[70]"
            style={{ background: `rgba(6, 6, 10, ${dim})` }}
          />
          {kind === 'welcome' ? <WelcomeCard onStart={next} onSkip={skip} /> : null}
          {kind === 'screen' && placed ? (
            <ScreenCard
              step={step}
              steps={steps}
              index={stepIndex}
              rect={rect}
              viewport={viewport}
              onNext={next}
              onSkip={skip}
            />
          ) : null}
          {kind === 'mark' && placed ? (
            <CoachMark
              step={step}
              steps={steps}
              index={stepIndex}
              rect={rect}
              viewport={viewport}
              installOpen={installOpen}
              onNext={next}
              onSkip={skip}
              onToggleInstall={toggleInstall}
            />
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
