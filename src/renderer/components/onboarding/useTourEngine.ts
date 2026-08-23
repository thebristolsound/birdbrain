import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { settingsQueryOptions, useSettingsMutations } from '@renderer/lib/api/settings'
import {
  completionAfter,
  jumpAheadIndex,
  nextStepIndex,
  pathForRoute,
  routeOfPath,
  tourSteps,
  type TourChapter,
  type TourOutcome,
  type TourRoute,
  type TourStep
} from '@renderer/components/onboarding/tourSteps'
import {
  isRectVisible,
  rectMoved,
  type TourRect
} from '@renderer/components/onboarding/tourGeometry'

interface TourState {
  chapter: TourChapter
  step: number
  installOpen: boolean
  /** Auto-fired chapters persist completion; replays never do. */
  auto: boolean
}

/**
 * How long the engine keeps looking for an anchor before giving up on it.
 *
 * A step that has just navigated renders before its target mounts, so the first
 * measurement legitimately misses. Six retries at roughly a frame each covers a
 * route transition without leaving a step visibly stuck.
 */
const ANCHOR_RETRY_MS = 60
const ANCHOR_RETRY_LIMIT = 6

/**
 * The case-route patterns, kept as literals so `navigate` stays typed. The
 * dashboard is handled separately because it takes no params.
 */
const CASE_ROUTE_PATHS = {
  overview: '/cases/$caseId/overview',
  captures: '/cases/$caseId/captures',
  signals: '/cases/$caseId/signals',
  notes: '/cases/$caseId/notes'
} as const satisfies Record<Exclude<TourRoute, 'dashboard'>, string>

export interface TourEngine {
  chapter: TourChapter | null
  stepIndex: number
  installOpen: boolean
  step: TourStep | null
  steps: TourStep[]
  rect: TourRect | null
  /** True once the anchor has been looked for on a budget and not found. */
  anchorMissing: boolean
  start: (chapter: TourChapter, options?: { auto?: boolean }) => void
  next: () => void
  skip: () => void
  toggleInstall: () => void
}

function find(target: string | undefined): Element | null {
  return target ? document.querySelector(`[data-tour="${target}"]`) : null
}

function rectOf(el: Element): TourRect {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

function measure(target: string | undefined): TourRect | null {
  const el = find(target)
  return el ? rectOf(el) : null
}

function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight }
}

/**
 * The coach-mark state machine: which chapter is running, which step, where its
 * anchor is, and what gets persisted when it closes.
 *
 * `caseId` is the case the tour navigates into for the case chapter's steps.
 * Without one those steps have nowhere to go, so the chapter cannot run.
 */
export function useTourEngine(caseId: string | null): TourEngine {
  const [state, setState] = useState<TourState | null>(null)
  const [rect, setRect] = useState<TourRect | null>(null)
  const [anchorMissing, setAnchorMissing] = useState(false)
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { data: settings } = useQuery(settingsQueryOptions)
  const { update } = useSettingsMutations()

  const steps = state ? tourSteps(state.chapter) : []
  const step = state ? (steps[state.step] ?? null) : null
  const target = step?.target

  // Holds the path the engine itself navigated to, so that arrival is not read
  // back as the operator navigating and does not trigger the jump-ahead scan.
  const engineNav = useRef<string | null>(null)
  const lastPath = useRef(pathname)
  // Retained completion map, merged forward rather than re-reading stale settings.
  const completionMapRef = useRef<Record<string, boolean>>(settings?.onboardingChapters ?? {})
  // Sync it forward when settings update.
  useEffect(() => {
    if (settings?.onboardingChapters) {
      completionMapRef.current = settings.onboardingChapters
    }
  }, [settings?.onboardingChapters])
  // Mirrors `state` for the callbacks that have to know what is running without
  // depending on it. Assigned on render for the committed value, and again by
  // `start`/`close` because two of those can run in a single effect flush —
  // the intro and case auto-fires do exactly that — and the second must not
  // read the pre-flush value.
  const stateRef = useRef(state)
  stateRef.current = state

  const go = useCallback(
    (route: TourRoute, path: string) => {
      engineNav.current = path
      if (route === 'dashboard') {
        navigate({ to: '/' })
        return
      }
      navigate({ to: CASE_ROUTE_PATHS[route], params: { caseId: caseId ?? '' } })
    },
    [caseId, navigate]
  )

  /**
   * The completion write, without the teardown.
   *
   * `close` is not the only way a chapter ends: starting another one over the
   * top of it ends it too, and that path has to persist the same thing or the
   * chapter auto-fires again on the next launch.
   */
  const persistCompletion = useCallback(
    (chapter: TourChapter, auto: boolean, outcome: TourOutcome) => {
      const next = completionAfter(completionMapRef.current, chapter, outcome, auto)
      if (next) {
        completionMapRef.current = next
        update.mutate({ onboardingChapters: next })
      }
    },
    [update]
  )

  const close = useCallback(
    (chapter: TourChapter, auto: boolean, outcome: TourOutcome) => {
      stateRef.current = null
      setState(null)
      setRect(null)
      setAnchorMissing(false)
      persistCompletion(chapter, auto, outcome)
    },
    [persistCompletion]
  )

  /** Navigates to a step's route when it is not the one already on screen. */
  const routeTo = useCallback(
    (route: TourRoute | undefined) => {
      if (!route || routeOfPath(pathname) === route) return
      const path = pathForRoute(route, caseId)
      if (path) go(route, path)
    },
    [caseId, go, pathname]
  )

  const start = useCallback(
    (chapter: TourChapter, options?: { auto?: boolean }) => {
      if (chapter === 'case' && !caseId) return
      // A chapter starting over a running one displaces it, and the displaced
      // chapter never reaches `close`. Persist it here or its completion is
      // lost and it auto-fires again for good, because `isFreshInstall` is
      // latched once at settings.ts and never cleared. `finished` rather than
      // `skipped` so the chapters the operator has not reached can still fire.
      const displaced = stateRef.current
      if (displaced) persistCompletion(displaced.chapter, displaced.auto, 'finished')
      setRect(null)
      setAnchorMissing(false)
      // The extension chapter opens with the install walkthrough already
      // expanded — it is the whole reason its entry points exist.
      const opening = {
        chapter,
        step: 0,
        installOpen: chapter === 'ext',
        auto: options?.auto ?? false
      }
      stateRef.current = opening
      setState(opening)
      routeTo(tourSteps(chapter)[0]?.route)
    },
    [caseId, persistCompletion, routeTo]
  )

  const next = useCallback(() => {
    if (!state) return
    const chapterSteps = tourSteps(state.chapter)
    const index = nextStepIndex(chapterSteps, state.step)
    if (index === null) {
      close(state.chapter, state.auto, 'finished')
      return
    }
    setRect(null)
    setAnchorMissing(false)
    setState({ ...state, step: index, installOpen: false })
    routeTo(chapterSteps[index].route)
  }, [close, routeTo, state])

  const skip = useCallback(() => {
    if (!state) return
    close(state.chapter, state.auto, 'skipped')
  }, [close, state])

  const toggleInstall = useCallback(() => {
    setState((current) => (current ? { ...current, installOpen: !current.installOpen } : current))
  }, [])

  // Anchor measurement. Runs synchronously on every step and route change so the
  // ring is placed in the frame the step appears, then retries on a short budget
  // for anchors whose surface has not mounted yet. Once that budget is spent the
  // step is marked missing and renders centred, rather than painting a 296px
  // card at the viewport origin the way the prototype does.
  useLayoutEffect(() => {
    if (!state) return
    if (!target) {
      setRect(null)
      setAnchorMissing(false)
      return
    }
    let attempts = 0
    let timer = 0
    let cancelled = false
    let scrolled = false

    function attempt(): void {
      if (cancelled) return
      const el = find(target)
      if (el) {
        const found = rectOf(el)
        if (isRectVisible(found, viewport())) {
          setRect((previous) => (rectMoved(previous, found) ? found : previous))
          setAnchorMissing(false)
          return
        }
        // Below the fold: bring it up once, then re-measure. Without this the
        // ring lands on something off screen and takes the tooltip with it.
        if (!scrolled) {
          scrolled = true
          el.scrollIntoView({ block: 'center', inline: 'nearest' })
          timer = window.setTimeout(attempt, ANCHOR_RETRY_MS)
          return
        }
      }
      attempts += 1
      if (attempts > ANCHOR_RETRY_LIMIT) {
        setRect(null)
        setAnchorMissing(true)
        return
      }
      timer = window.setTimeout(attempt, ANCHOR_RETRY_MS)
    }

    attempt()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [state, target, pathname])

  // Four of the anchored surfaces sit inside scrolling panes, so a scroll during
  // a step would otherwise leave the ring behind the element it rings. Capture
  // phase because those panes scroll, not the window.
  useEffect(() => {
    if (!state || !target) return
    function remeasure(): void {
      const found = measure(target)
      if (found && isRectVisible(found, viewport())) {
        setRect((previous) => (rectMoved(previous, found) ? found : previous))
      }
    }
    window.addEventListener('resize', remeasure)
    window.addEventListener('scroll', remeasure, true)
    return () => {
      window.removeEventListener('resize', remeasure)
      window.removeEventListener('scroll', remeasure, true)
    }
  }, [state, target])

  // The operator navigating during the case chapter moves the tour forward to
  // wherever they went, and never backwards — clicking back through screens
  // already toured does not replay them.
  useEffect(() => {
    const previous = lastPath.current
    lastPath.current = pathname
    if (previous === pathname) return
    const wasEngine = engineNav.current === pathname
    engineNav.current = null
    if (wasEngine) return
    if (!state || state.chapter !== 'case') return
    const route = routeOfPath(pathname)
    if (!route) return
    const index = jumpAheadIndex(tourSteps(state.chapter), state.step, route)
    if (index === null) return
    setRect(null)
    setAnchorMissing(false)
    setState({ ...state, step: index, installOpen: false })
  }, [pathname, state])

  return {
    chapter: state?.chapter ?? null,
    stepIndex: state?.step ?? 0,
    installOpen: state?.installOpen ?? false,
    step,
    steps,
    rect,
    anchorMissing,
    start,
    next,
    skip,
    toggleInstall
  }
}
