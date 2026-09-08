import { describe, it, expect, afterEach } from 'vitest'
import { MAC_PLATFORM, restorePlatform, stubPlatform } from './platformStub'
import {
  ALL_CHAPTERS,
  completionAfter,
  jumpAheadIndex,
  markCountLabel,
  markNumber,
  markSteps,
  nextStepIndex,
  pathForRoute,
  routeOfPath,
  screenCountLabel,
  screenSteps,
  shouldAutoFire,
  tourSteps,
  type TourChapter
} from '@renderer/components/onboarding/tourSteps'

/** Every anchor the app emits, and the only values a step may target. */
const EMITTED_ANCHORS = new Set([
  'browser',
  'caseswitcher',
  'export',
  'linkmap',
  'newcase',
  'noteeditor',
  'selectors',
  'viewertabs',
  'nav-dashboard',
  'nav-overview',
  'nav-captures',
  'nav-notes',
  'nav-signals',
  'nav-data'
])

describe('tourSteps', () => {
  it('ships three chapters with the shapes the engine expects', () => {
    const intro = tourSteps('intro')
    expect(intro).toHaveLength(3)
    expect(intro[0].welcome).toBe(true)
    expect(markSteps(intro)).toHaveLength(2)

    const ext = tourSteps('ext')
    expect(ext).toHaveLength(1)
    expect(ext[0].install).toBe(true)
    expect(ext[0].target).toBe('browser')

    const kase = tourSteps('case')
    expect(kase).toHaveLength(10)
    expect(screenSteps(kase)).toHaveLength(4)
    expect(markSteps(kase)).toHaveLength(6)
    expect(kase[kase.length - 1].final).toBe(true)
  })

  it('targets only anchors the app actually emits', () => {
    for (const chapter of ALL_CHAPTERS) {
      for (const step of tourSteps(chapter)) {
        if (!step.target) continue
        expect(EMITTED_ANCHORS.has(step.target), `${chapter}: ${step.target}`).toBe(true)
      }
    }
  })

  it('never names the deleted Selectors or Tags screens', () => {
    const targets = ALL_CHAPTERS.flatMap((c) => tourSteps(c).map((s) => s.target))
    expect(targets).not.toContain('nav-selectors')
    expect(targets).not.toContain('nav-tags')
  })

  it('walks the case chapter through the four screens in order', () => {
    expect(tourSteps('case').map((s) => s.route)).toEqual([
      'captures',
      'captures',
      'captures',
      'signals',
      'signals',
      'notes',
      'notes',
      'overview',
      'overview',
      'overview'
    ])
  })

  // The mock promises a seeded demo case and a simulated browser window. Neither
  // exists, and both were sent back to design rather than built (#707), so no
  // step may promise them.
  it('promises nothing the app does not provide', () => {
    const copy = ALL_CHAPTERS.flatMap((c) => tourSteps(c).map((s) => `${s.title ?? ''} ${s.body ?? ''}`))
      .join(' ')
      .toLowerCase()
    expect(copy).not.toContain('demo case')
    expect(copy).not.toContain('simulated browser')
    expect(copy).not.toContain('we seeded')
  })

  it('labels the extension step Done in both chapters that hold it', () => {
    expect(tourSteps('ext')[0].last).toBe('Done')
    expect(tourSteps('intro')[2].last).toBe('Done')
  })

  it('varies the extension copy by chapter', () => {
    expect(tourSteps('ext')[0].body).not.toBe(tourSteps('intro')[2].body)
  })
})

describe('counters', () => {
  it('numbers marks and leaves the welcome card unbadged', () => {
    const intro = tourSteps('intro')
    expect(markNumber(intro, 0)).toBe(0)
    expect(markNumber(intro, 1)).toBe(1)
    expect(markNumber(intro, 2)).toBe(2)
    expect(markCountLabel(intro, 1)).toBe('1 of 2')
    expect(markCountLabel(intro, 2)).toBe('2 of 2')
  })

  it('does not badge a screen step', () => {
    expect(markNumber(tourSteps('case'), 0)).toBe(0)
  })

  it('counts the case chapter marks past its screen steps', () => {
    expect(markCountLabel(tourSteps('case'), 1)).toBe('1 of 6')
    expect(markCountLabel(tourSteps('case'), 9)).toBe('6 of 6')
  })

  it('counts screens separately', () => {
    expect(screenCountLabel(tourSteps('case'), 0)).toBe('Screen 1 of 4')
    expect(screenCountLabel(tourSteps('case'), 7)).toBe('Screen 4 of 4')
  })

  it('returns a zero position for an index that is not a screen', () => {
    expect(screenCountLabel(tourSteps('case'), 1)).toBe('Screen 0 of 4')
  })

  it('is safe on an out-of-range index', () => {
    expect(markNumber(tourSteps('ext'), 9)).toBe(0)
  })
})

describe('advancing', () => {
  it('reports the next index and then the end of the chapter', () => {
    expect(nextStepIndex(tourSteps('intro'), 0)).toBe(1)
    expect(nextStepIndex(tourSteps('intro'), 2)).toBeNull()
    expect(nextStepIndex(tourSteps('ext'), 0)).toBeNull()
  })
})

describe('jumpAheadIndex', () => {
  const steps = tourSteps('case')

  it('scans forward to the first step on the destination screen', () => {
    expect(jumpAheadIndex(steps, 0, 'notes')).toBe(5)
    expect(jumpAheadIndex(steps, 5, 'overview')).toBe(7)
  })

  it('never scans backwards', () => {
    expect(jumpAheadIndex(steps, 7, 'captures')).toBeNull()
    expect(jumpAheadIndex(steps, 5, 'signals')).toBeNull()
  })

  it('does not re-fire on the step it is already showing', () => {
    expect(jumpAheadIndex(steps, 9, 'overview')).toBeNull()
  })
})

describe('routes', () => {
  it('maps a pathname to a tour route', () => {
    expect(routeOfPath('/')).toBe('dashboard')
    expect(routeOfPath('/cases/abc/captures')).toBe('captures')
    expect(routeOfPath('/cases/abc/signals')).toBe('signals')
    expect(routeOfPath('/cases/abc/notes/')).toBe('notes')
    expect(routeOfPath('/cases/abc/overview')).toBe('overview')
  })

  it('returns null for screens the tour does not visit', () => {
    expect(routeOfPath('/settings')).toBeNull()
    expect(routeOfPath('/cases/abc/data')).toBeNull()
    expect(routeOfPath('/cases/new')).toBeNull()
  })

  it('builds a reachable path only when the case is known', () => {
    expect(pathForRoute('dashboard', null)).toBe('/')
    expect(pathForRoute('captures', 'abc')).toBe('/cases/abc/captures')
    expect(pathForRoute('captures', null)).toBeNull()
  })

  it('round-trips every case route it can build', () => {
    for (const route of ['overview', 'captures', 'signals', 'notes'] as const) {
      expect(routeOfPath(pathForRoute(route, 'abc') as string)).toBe(route)
    }
  })
})

describe('shouldAutoFire', () => {
  it('fires on a fresh install that has not seen the chapter', () => {
    expect(shouldAutoFire({ isFreshInstall: true, onboardingChapters: {} }, 'intro')).toBe(true)
  })

  it('never fires on an upgrade, whatever the chapter state', () => {
    expect(shouldAutoFire({ isFreshInstall: false, onboardingChapters: {} }, 'intro')).toBe(false)
    expect(shouldAutoFire({ onboardingChapters: {} }, 'case')).toBe(false)
    expect(shouldAutoFire(undefined, 'intro')).toBe(false)
  })

  it('never re-fires a completed chapter', () => {
    const settings = { isFreshInstall: true, onboardingChapters: { intro: true } }
    expect(shouldAutoFire(settings, 'intro')).toBe(false)
    expect(shouldAutoFire(settings, 'case')).toBe(true)
  })
})

describe('completionAfter', () => {
  it('writes nothing at all for a replay', () => {
    for (const outcome of ['finished', 'skipped'] as const) {
      for (const chapter of ALL_CHAPTERS) {
        expect(completionAfter({}, chapter, outcome, false)).toBeNull()
      }
    }
  })

  it('completes only the chapter that finished', () => {
    expect(completionAfter(undefined, 'intro', 'finished', true)).toEqual({ intro: true })
    expect(completionAfter({ intro: true }, 'case', 'finished', true)).toEqual({
      intro: true,
      case: true
    })
  })

  // The 2026-08-21 ruling: dismissing the tour dismisses the whole tour. A
  // chapter that reappears next launch is the worse failure, and replay stays
  // available on demand.
  it('completes every chapter on skip', () => {
    expect(completionAfter({}, 'intro', 'skipped', true)).toEqual({
      intro: true,
      ext: true,
      case: true
    })
  })

  // The prototype sets the case flag from any chapter, so replaying the
  // extension chapter suppresses a case chapter that never ran. Guarded here.
  it('does not let an extension replay suppress the case chapter', () => {
    expect(completionAfter({}, 'ext', 'skipped', false)).toBeNull()
    expect(completionAfter({}, 'ext', 'finished', false)).toBeNull()
  })

  it('preserves chapters already recorded', () => {
    const previous = { ext: true }
    expect(completionAfter(previous, 'intro', 'finished', true)).toEqual({
      ext: true,
      intro: true
    })
    expect(previous).toEqual({ ext: true })
  })
})

describe('chapter identifiers', () => {
  it('are exactly the three the settings key records', () => {
    expect(ALL_CHAPTERS).toEqual<TourChapter[]>(['intro', 'ext', 'case'])
  })
})

// #902. The tour teaches the same accelerators the chrome hints do, so the two
// cannot be allowed to name different modifiers on the same machine.
describe('accelerator hints', () => {
  afterEach(restorePlatform)

  function kbdOf(chapter: TourChapter): string[] {
    return tourSteps(chapter)
      .map((step) => step.kbd)
      .filter((kbd): kbd is string => kbd !== undefined)
  }

  it('names Ctrl off macOS', () => {
    expect(kbdOf('intro')).toEqual(['Ctrl N'])
    expect(kbdOf('case')).toEqual(['Ctrl K', '@ #'])
  })

  it('names the Command glyph on macOS, leaving the non-modifier hint alone', () => {
    stubPlatform(MAC_PLATFORM)
    expect(kbdOf('intro')).toEqual(['⌘N'])
    expect(kbdOf('case')).toEqual(['⌘K', '@ #'])
  })
})

// #405. The demo case is seeded, not guaranteed: a build shipping without the
// fixture, or an import that failed, leaves an install with no demo case at
// all. Copy that names one is therefore conditional, and the marks the tour
// walks are the same either way.
describe('copy that names the seeded demo case', () => {
  function bodies(chapter: TourChapter, demoCase: boolean): string[] {
    return tourSteps(chapter, { demoCase })
      .map((step) => step.body)
      .filter((body): body is string => body !== undefined)
  }

  it('promises a demo case in the intro only when one exists', () => {
    const withDemo = bodies('intro', true).join(' ')
    const without = bodies('intro', false).join(' ')

    expect(withDemo).toContain('demo case')
    expect(without).not.toContain('demo case')
  })

  it('names the demo case in the case chapter only when it is the case being toured', () => {
    expect(bodies('case', true).join(' ')).toContain('demo case')
    expect(bodies('case', false).join(' ')).not.toContain('demo case')
  })

  it('names the delete ending in the final step copy when the case is a demo', () => {
    const final = tourSteps('case', { demoCase: true }).at(-1)
    expect(final?.final).toBe(true)
    expect(final?.body).toContain('Delete it')
  })

  it('defaults to promising nothing', () => {
    expect(tourSteps('intro')).toEqual(tourSteps('intro', { demoCase: false }))
    expect(tourSteps('case')).toEqual(tourSteps('case', { demoCase: false }))
    expect(tourSteps('ext')).toEqual(tourSteps('ext', { demoCase: false }))
  })

  it('walks the same six marks and four screens either way', () => {
    for (const demoCase of [true, false]) {
      const steps = tourSteps('case', { demoCase })
      expect(markSteps(steps)).toHaveLength(6)
      expect(screenSteps(steps)).toHaveLength(4)
    }
  })
})

// #405, Q2. Two anchors do not exist under default state, so their steps carry
// the side effect that brings them into being.
describe('step side effects', () => {
  it('are declared on exactly the two steps whose anchors are not mounted', () => {
    const withEffects = tourSteps('case')
      .filter((step) => step.effect)
      .map((step) => [step.target, step.effect])

    expect(withEffects).toEqual([
      ['viewertabs', 'select-capture'],
      ['noteeditor', 'open-note-composer']
    ])
  })

  it('leaves the other chapters free of them', () => {
    expect(tourSteps('intro').some((step) => step.effect)).toBe(false)
    expect(tourSteps('ext').some((step) => step.effect)).toBe(false)
  })
})
