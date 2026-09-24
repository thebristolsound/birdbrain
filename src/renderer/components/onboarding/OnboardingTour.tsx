import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { settingsQueryOptions } from '@renderer/lib/api/settings'
import { casesQueryOptions, useCasesMutations } from '@renderer/lib/api/cases'
import { capturesQueryOptions } from '@renderer/lib/api/captures'
import { presets } from '@renderer/lib/motion'
import { useAppStore } from '@renderer/stores/appStore'
import { trapTab, useModalEscape, useModalFocus } from '@renderer/components/ui'
import { useTourEngine } from '@renderer/components/onboarding/useTourEngine'
import { shouldAutoFire } from '@renderer/components/onboarding/tourSteps'
import { dimOpacity, type Viewport } from '@renderer/components/onboarding/tourGeometry'
import { TOUR_EVENT, type TourEventDetail } from '@renderer/components/onboarding/startTour'
import { openNoteComposer } from '@renderer/components/onboarding/tourEffects'
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
  const { data: cases = [] } = useQuery(casesQueryOptions)
  const params = useParams({ strict: false }) as Record<string, string | undefined>
  const caseId = params.caseId ?? null
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  const { removeDemo } = useCasesMutations()

  // The seeded demonstration case (#405). Read off the cases list rather than a
  // second per-case query so both questions are answered from one cache entry.
  const demoContext = useMemo(
    () => ({
      hasDemoCase: cases.some((c) => c.isDemo),
      currentCaseIsDemo: cases.some((c) => c.id === caseId && c.isDemo)
    }),
    [cases, caseId]
  )

  const engine = useTourEngine(caseId, demoContext)
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

  const {
    chapter,
    step,
    steps,
    stepIndex,
    rect,
    anchorMissing,
    installOpen,
    next,
    skip,
    toggleInstall
  } = engine

  const { data: captures = [] } = useQuery({
    ...capturesQueryOptions(caseId ?? ''),
    enabled: Boolean(caseId) && step?.effect === 'select-capture'
  })
  const setSelectedCaptureId = useAppStore((s) => s.setSelectedCaptureId)

  // Step side effects (#405, Q2). Keyed on the step the tour is showing, so a
  // re-render never re-runs one, and scoped to the tour: nothing here happens
  // to an operator who is not being toured.
  const effect = step?.effect
  const firstCaptureId = captures[0]?.id
  useEffect(() => {
    if (!effect) return
    if (effect === 'select-capture') {
      // Read imperatively rather than subscribed: this is a do-not-clobber
      // guard on the capture the operator already has open, not a condition the
      // step should re-run on when the selection later changes.
      if (!useAppStore.getState().selectedCaptureId && firstCaptureId) {
        setSelectedCaptureId(firstCaptureId)
      }
      return
    }
    openNoteComposer()
  }, [chapter, stepIndex, effect, firstCaptureId, setSelectedCaptureId])

  // The final step's "Delete demo case" ending (#405, Q1/W19). Offered only on
  // the seeded demo case, because the case chapter fires on whichever case a
  // fresh install opens first — ungated it would offer one-click deletion of an
  // operator's own case, artifacts included.
  // Leaving the case is conditional on it actually having gone: main refuses
  // anything not flagged `is_demo`, and `removeDemo` raises that refusal so it
  // lands on the failure toast rather than in onSuccess. Closing the tour is
  // not conditional — the operator picked an ending either way, and a tour that
  // stayed open on a failed delete would trap them on its final step.
  const deleteDemo = useCallback(() => {
    if (!caseId) return
    removeDemo.mutate(caseId, {
      onSuccess: () => {
        void navigate({ to: '/' })
      }
    })
    next()
  }, [caseId, navigate, next, removeDemo])
  const onDeleteDemo = demoContext.currentCaseIsDemo ? deleteDemo : undefined

  const kind = step ? (step.welcome ? 'welcome' : step.screen ? 'screen' : 'mark') : null
  // A measured rect means the ring's own 100vmax spread shadow is dimming the
  // page, so the flat layer goes to zero rather than dimming it twice.
  const dim = kind ? dimOpacity(kind, Boolean(rect)) : 0
  // An anchored step holds back its card until the anchor either resolves or is
  // declared missing, so a step that navigates does not flash a centred card and
  // then jump to the target a frame later.
  const placed = Boolean(rect) || anchorMissing

  // The tour is modal for the keyboard, on the dialog primitive's hooks: focus
  // moves in when it opens and back to the opener when it closes, Tab stays
  // inside, and Escape is the skip link. Registering as an open dialog also
  // keeps the captures list from clearing its selection on the same Escape.
  const tourRef = useRef<HTMLDivElement>(null)
  useModalFocus(Boolean(step), tourRef)
  useModalEscape(Boolean(step), skip)

  // Each step lands on its forward action, the last control on every card, once
  // the card is on screen: a step change can unmount the focused Next under the
  // keyboard, and an anchored card only appears after its anchor is measured.
  useEffect(() => {
    if (!kind) return
    const buttons = tourRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
    buttons?.[buttons.length - 1]?.focus()
  }, [chapter, stepIndex, kind, placed])

  return (
    <AnimatePresence>
      {step ? (
        <motion.div
          key="tour"
          {...presets.overlay}
          data-testid="onboarding-tour"
          ref={tourRef}
          // A fallback landing while an anchored card is still being placed.
          tabIndex={-1}
          onKeyDown={(e) => trapTab(e, tourRef.current)}
        >
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
              onDeleteDemo={onDeleteDemo}
            />
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
