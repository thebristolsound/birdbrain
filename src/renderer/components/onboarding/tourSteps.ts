/**
 * The coach-mark tour's chapter definitions and every decision that can be made
 * without a DOM (#404).
 *
 * Deliberately free of React and of `document`: the step list, the counters,
 * the forward-only jump scan, the auto-fire rule and the completion write are
 * all pure functions here, so they are tested directly rather than through a
 * rendered tour. The one environment read is the accelerator label (#902),
 * which is why the chapter lists are built per call rather than frozen at
 * import.
 */

import { accelerator } from '@renderer/lib/accelerator'

export type TourChapter = 'intro' | 'ext' | 'case'

/** The screens a step can pin itself to. */
export type TourRoute = 'dashboard' | 'overview' | 'captures' | 'signals' | 'notes'

/**
 * What a step needs the app to do before its anchor can be rung (#405, Q2).
 *
 * Two of the case chapter's anchors do not exist under default state: the
 * viewer tab list is not rendered until a capture is selected, and the note
 * editor is not mounted until the composer is open. The tour drives both as
 * step side effects rather than the app auto-selecting on route entry, which
 * would change behaviour for every operator whether or not they are being
 * toured.
 */
export type TourEffect = 'select-capture' | 'open-note-composer'

export interface TourStep {
  /** The centered welcome card. Only the intro chapter's first step. */
  welcome?: true
  /** A screen card notched off the sidebar rail, rather than a coach mark. */
  screen?: string
  /** The `data-tour` value this step rings. */
  target?: string
  route?: TourRoute
  title?: string
  body?: string
  kbd?: string
  kbdNote?: string
  /** Renders the collapsible three-step install walkthrough. */
  install?: true
  /** Overrides the 'Next' label. */
  last?: string
  /** Last step of the case chapter. */
  final?: true
  /** Run before the anchor is measured. See `TourEffect`. */
  effect?: TourEffect
}

/**
 * One clause of the mock's copy is still dropped here rather than transcribed.
 *
 * The mock's Browser button opens a simulated Chrome window, which this app has
 * no equivalent of, so the copy must not promise it (#707). The other dropped
 * clause — an intro promising a seeded demo case — is restored below, because
 * #405 ships the demo case it promises.
 */
const EXT_BODY_INTRO =
  'Right-click any page in Chrome to log it to your active case. Install the extension ' +
  'below, then open the demo case waiting on your dashboard.'

const EXT_BODY_REPLAY =
  'Right-click any page in Chrome to log it to your active case. Install it below — the ' +
  'folder ships inside this Birdbrain build.'

const EXT_BODY_NO_DEMO =
  'Right-click any page in Chrome to log it to your active case. Install the extension ' +
  'below, then start your first investigation.'

function extStep(chapter: 'intro' | 'ext', demoCase: boolean): TourStep {
  const introBody = demoCase ? EXT_BODY_INTRO : EXT_BODY_NO_DEMO
  return {
    target: 'browser',
    route: 'dashboard',
    title: 'The extension does the capturing',
    body: chapter === 'ext' ? EXT_BODY_REPLAY : introBody,
    install: true,
    last: 'Done'
  }
}

const caseSteps = (demoCase: boolean): TourStep[] => [
  {
    screen: 'Captures',
    route: 'captures',
    target: 'nav-captures',
    body: demoCase
      ? 'The evidence locker. This demo case already holds three captures; every page you log ' +
        'lands in the same list, and the viewer on the right shows exactly what was saved.'
      : 'The evidence locker. Every page you log lands in the list on the left; the viewer on ' +
        'the right shows exactly what was saved, pixel for pixel.'
  },
  {
    target: 'viewertabs',
    route: 'captures',
    title: 'Four views of every capture',
    body: 'Screenshot, full page, extracted text, and archive.org snapshots — one tab each.',
    effect: 'select-capture'
  },
  {
    target: 'caseswitcher',
    route: 'captures',
    title: 'You’re inside a case',
    body:
      'Everything you see is scoped to this investigation. Click the name to switch cases or ' +
      'start a new one.',
    kbd: accelerator('K', { join: ' ' }),
    kbdNote: 'opens the switcher anywhere'
  },
  {
    screen: 'Signals',
    route: 'signals',
    target: 'nav-signals',
    body:
      'The watchlist. Define selectors — emails, wallets, IPs — and Birdbrain flags every ' +
      'capture that matches, past and future.'
  },
  {
    target: 'selectors',
    route: 'signals',
    title: 'Selectors watch for patterns',
    body:
      'Emails, wallets, panel IPs — matches are highlighted across every capture, and ' +
      'auto-capture can log pages that hit.'
  },
  {
    screen: 'Notes',
    route: 'notes',
    target: 'nav-notes',
    body:
      'Your case narrative. Write up findings here and link them straight to the evidence ' +
      'they came from.'
  },
  {
    target: 'noteeditor',
    route: 'notes',
    title: 'Notes link to evidence',
    body:
      'Type @ to mention a capture or selector, # for a tag. Mentions become live links in ' +
      'both directions.',
    kbd: '@ #',
    kbdNote: 'work in any note',
    effect: 'open-note-composer'
  },
  {
    screen: 'Overview',
    route: 'overview',
    target: 'nav-overview',
    body:
      'The case at a glance — stats, recent activity, and a map of how everything you’ve ' +
      'gathered connects.'
  },
  {
    target: 'linkmap',
    route: 'overview',
    title: 'The link map ties it together',
    body:
      'Notes, captures, selectors, and tags, connected by their mentions. Click any node to ' +
      'jump to it.'
  },
  {
    target: 'export',
    route: 'overview',
    title: 'Court-ready exports',
    body: demoCase
      ? 'Every artifact is hashed on capture and sealed in a signed manifest — and a package ' +
        'built from this demo case says so on its cover sheet. Delete it when you are done, or ' +
        'keep it and carry on.'
      : 'Every artifact is hashed on capture and sealed in a signed manifest — export the whole ' +
        'case or just a selection, cover sheet included.',
    final: true
  }
]

const introSteps = (demoCase: boolean): TourStep[] => [
  { welcome: true },
  {
    target: 'newcase',
    route: 'dashboard',
    title: 'Everything lives in a case',
    body: demoCase
      ? 'Start one per investigation — captures, selectors, notes, and exports stay scoped to ' +
        'it. A worked demo case is already here to look through.'
      : 'Start one per investigation — captures, selectors, notes, and exports stay scoped to it.',
    kbd: accelerator('N', { join: ' ' }),
    kbdNote: 'starts one from anywhere'
  },
  extStep('intro', demoCase)
]

/**
 * `demoCase` says whether the seeded demonstration case is in play — for the
 * case chapter, that the open case IS it; for the intro, that one exists on the
 * dashboard. Copy that names the demo case is written only when it is there, so
 * an install whose fixture failed to import is never told to go and look at it.
 */
export function tourSteps(chapter: TourChapter, opts?: { demoCase?: boolean }): TourStep[] {
  const demoCase = opts?.demoCase ?? false
  if (chapter === 'ext') return [extStep('ext', demoCase)]
  if (chapter === 'intro') return introSteps(demoCase)
  return caseSteps(demoCase)
}

/** Steps that render a coach mark, i.e. everything the mark counter counts. */
export function markSteps(steps: TourStep[]): TourStep[] {
  return steps.filter((s) => s.target && !s.screen)
}

/** Steps that render a screen card. */
export function screenSteps(steps: TourStep[]): TourStep[] {
  return steps.filter((s) => Boolean(s.screen))
}

/** The number in the badge. Zero for the welcome card, which carries no badge. */
export function markNumber(steps: TourStep[], index: number): number {
  const step = steps[index]
  if (!step || step.welcome || step.screen) return 0
  return markSteps(steps).indexOf(step) + 1
}

/** Footer counter for a coach mark, e.g. '2 of 6'. */
export function markCountLabel(steps: TourStep[], index: number): string {
  return `${markNumber(steps, index)} of ${markSteps(steps).length}`
}

/** Eyebrow for a screen card, e.g. 'Screen 3 of 4'. */
export function screenCountLabel(steps: TourStep[], index: number): string {
  const step = steps[index]
  const screens = screenSteps(steps)
  const position = step ? screens.indexOf(step) + 1 : 0
  return `Screen ${position} of ${screens.length}`
}

/** The next step, or null when the chapter is over. */
export function nextStepIndex(steps: TourStep[], index: number): number | null {
  return index + 1 < steps.length ? index + 1 : null
}

/**
 * Where a user-driven navigation moves the tour to.
 *
 * Forward only, by design: the operator clicking ahead skips the steps in
 * between, but clicking back never rewinds the tour into steps it has already
 * shown. Returns null when the destination is not ahead of the current step,
 * in which case the tour stays put.
 */
export function jumpAheadIndex(
  steps: TourStep[],
  index: number,
  route: TourRoute
): number | null {
  for (let i = index + 1; i < steps.length; i += 1) {
    if (steps[i].route === route) return i
  }
  return null
}

/** The pathname a step's route resolves to, or null when it cannot be reached. */
export function pathForRoute(route: TourRoute, caseId: string | null): string | null {
  if (route === 'dashboard') return '/'
  return caseId ? `/cases/${caseId}/${route}` : null
}

/** Which tour route a pathname is, if any. */
export function routeOfPath(pathname: string): TourRoute | null {
  if (pathname === '/') return 'dashboard'
  const match = /^\/cases\/[^/]+\/(overview|captures|signals|notes)\/?$/.exec(pathname)
  return match ? (match[1] as TourRoute) : null
}

interface AutoFireSettings {
  isFreshInstall?: boolean
  onboardingChapters?: Record<string, boolean>
}

/**
 * Auto-fire is confined to fresh installs. An install that already had a
 * settings.json when this release landed has `isFreshInstall` false and is
 * never toured, which is what keeps an upgrade from ambushing an operator
 * mid-case.
 */
export function shouldAutoFire(
  settings: AutoFireSettings | undefined,
  chapter: TourChapter
): boolean {
  if (!settings?.isFreshInstall) return false
  return !settings.onboardingChapters?.[chapter]
}

export const ALL_CHAPTERS: TourChapter[] = ['intro', 'ext', 'case']

export type TourOutcome = 'finished' | 'skipped'

/**
 * What to persist when a chapter closes, or null to persist nothing.
 *
 * Three rules, and the second two are the ones the prototype gets wrong:
 *
 * - Closing a replay writes nothing at all. Replaying the extension chapter
 *   from the dashboard banner must not mark the case chapter — which has never
 *   run — complete. The prototype sets that flag from any chapter and
 *   permanently suppresses a chapter the operator never saw. Note this is a
 *   rule about the chapter being closed, not about how it started: `auto` is
 *   read off the closing chapter, so a replay that displaces a running auto
 *   chapter still persists that one. See `useTourEngine.start`.
 * - Skip completes the whole tour, per the 2026-08-21 ruling. Dismissing it
 *   means dismissing it; a tour that reappears next launch is the worse
 *   failure. It stays replayable on demand.
 * - Finishing a chapter completes that chapter alone.
 */
export function completionAfter(
  previous: Record<string, boolean> | undefined,
  chapter: TourChapter,
  outcome: TourOutcome,
  auto: boolean
): Record<string, boolean> | null {
  if (!auto) return null
  const base = { ...(previous ?? {}) }
  if (outcome === 'skipped') {
    for (const key of ALL_CHAPTERS) base[key] = true
    return base
  }
  base[chapter] = true
  return base
}
