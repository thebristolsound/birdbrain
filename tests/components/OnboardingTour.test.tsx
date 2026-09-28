// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { BirdbrainSettings } from '@shared/types'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubMatchMedia } from './matchMediaStub'

const navigate = vi.hoisted(() => vi.fn())
const routerState = vi.hoisted(() => ({ pathname: '/', caseId: undefined as string | undefined }))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ caseId: routerState.caseId }),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: routerState.pathname } })
}))

import { OnboardingTour } from '@renderer/components/onboarding/OnboardingTour'
import { startTour } from '@renderer/components/onboarding/startTour'
import { NOTE_COMPOSER_EVENT } from '@renderer/components/onboarding/tourEffects'
import { queryKeys } from '@renderer/lib/api/keys'
import { useAppStore } from '@renderer/stores/appStore'

let updated: Array<Partial<BirdbrainSettings>>

function settingsFixture(overrides: Partial<BirdbrainSettings> = {}): BirdbrainSettings {
  return {
    isFreshInstall: false,
    onboardingChapters: {},
    ...overrides
  } as BirdbrainSettings
}

function install(settings: BirdbrainSettings) {
  updated = []
  fakeBridge({
    settings: {
      get: vi.fn().mockResolvedValue(settings),
      update: vi.fn().mockImplementation((partial: Partial<BirdbrainSettings>) => {
        updated.push(partial)
        return Promise.resolve({ ...settings, ...partial })
      })
    }
  })
}

/** A stand-in for a real anchor, with a rect the tour can measure. */
function anchor(name: string, rect: Partial<DOMRect> = {}) {
  const el = document.createElement('div')
  el.setAttribute('data-tour', name)
  el.setAttribute('data-testid', `anchor-${name}`)
  const box = { top: 100, left: 200, width: 120, height: 40, ...rect }
  el.getBoundingClientRect = () =>
    ({
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
      x: box.left,
      y: box.top
    }).valueOf() as DOMRect
  document.body.appendChild(el)
  return el
}

/**
 * The tour fades out through AnimatePresence, so the node outlives the state
 * change that closed it. Waits for the detach rather than the state.
 */
async function expectTourClosed() {
  await waitFor(() => expect(screen.queryByTestId('onboarding-tour')).toBeNull(), {
    timeout: 5000
  })
}

function renderTour() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  // The client comes back out so a test can watch what a mutation invalidates.
  return { ...render(<OnboardingTour />, { wrapper: Wrapper }), client }
}

/** Stands in for the operator navigating: moves the route, then re-renders. */
async function navigateTo(pathname: string, rerender: () => void) {
  routerState.pathname = pathname
  await act(async () => {
    rerender()
  })
}

beforeEach(() => {
  stubMatchMedia()
  navigate.mockClear()
  routerState.pathname = '/'
  routerState.caseId = undefined
  window.innerWidth = 1280
  window.innerHeight = 800
  install(settingsFixture())
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('auto-fire', () => {
  it('does not tour an install that already existed', async () => {
    renderTour()
    await waitFor(() => expect(updated).toEqual([]))
    expect(screen.queryByTestId('onboarding-tour')).toBeNull()
  })

  it('raises the welcome card on a fresh install', async () => {
    install(settingsFixture({ isFreshInstall: true }))
    renderTour()
    const card = await screen.findByTestId('tour-welcome')
    expect(card).toBeTruthy()
    expect(screen.getByText('Welcome to Birdbrain')).toBeTruthy()
    expect(screen.getByText('replays this tour anytime')).toBeTruthy()
    // The card can sit over the captures route, where Escape otherwise clears
    // the capture selection. It opts out by attribute since the guard stopped
    // reading role="dialog" from the DOM (#686).
    expect(card.hasAttribute('data-selection-escape-guard')).toBe(true)
  })

  it('does not re-fire a chapter already recorded complete', async () => {
    install(settingsFixture({ isFreshInstall: true, onboardingChapters: { intro: true } }))
    renderTour()
    await waitFor(() => expect(updated).toEqual([]))
    expect(screen.queryByTestId('tour-welcome')).toBeNull()
  })
})

describe('the intro chapter', () => {
  beforeEach(() => {
    install(settingsFixture({ isFreshInstall: true }))
  })

  it('rings the new-case button as its first mark', async () => {
    anchor('newcase')
    renderTour()
    fireEvent.click(await screen.findByTestId('tour-next'))

    const mark = await screen.findByTestId('tour-mark')
    expect(mark.getAttribute('data-anchored')).toBe('true')
    expect(screen.getByTestId('tour-badge').textContent).toBe('1')
    expect(screen.getByTestId('tour-count').textContent).toContain('1 of 2')
    expect(screen.getByText(/Everything lives in a case/)).toBeTruthy()

    const ring = screen.getByTestId('tour-ring')
    expect(ring.style.top).toBe('96px')
    expect(ring.style.left).toBe('196px')
    expect(ring.className).toContain('pointer-events-none')
    expect(screen.getByTestId('tour-badge').className).toContain('pointer-events-none')
  })

  it('leaves the ringed control clickable and does not advance when it is clicked', async () => {
    const target = anchor('newcase')
    const clicked = vi.fn()
    target.addEventListener('click', clicked)
    renderTour()
    fireEvent.click(await screen.findByTestId('tour-next'))
    await screen.findByTestId('tour-mark')

    fireEvent.click(target)
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('tour-count').textContent).toContain('1 of 2')
  })

  it('expands the install walkthrough on the extension step', async () => {
    anchor('newcase')
    anchor('browser')
    renderTour()
    fireEvent.click(await screen.findByTestId('tour-next'))
    fireEvent.click(await screen.findByTestId('tour-next'))

    expect(screen.getByTestId('tour-count').textContent).toContain('2 of 2')
    expect(screen.getByTestId('tour-next').textContent).toBe('Done')
    expect(screen.queryByTestId('tour-install-steps')).toBeNull()

    fireEvent.click(screen.getByTestId('tour-install-toggle'))
    expect(screen.getAllByTestId('tour-install-step')).toHaveLength(3)
    expect(screen.getByText(/chrome:\/\/extensions/)).toBeTruthy()

    fireEvent.click(screen.getByTestId('tour-install-toggle'))
    expect(screen.queryByTestId('tour-install-steps')).toBeNull()
  })

  it('completes the chapter, and only that chapter, when it is finished', async () => {
    anchor('newcase')
    anchor('browser')
    renderTour()
    fireEvent.click(await screen.findByTestId('tour-next'))
    fireEvent.click(await screen.findByTestId('tour-next'))
    fireEvent.click(await screen.findByTestId('tour-next'))

    await waitFor(() => expect(updated).toEqual([{ onboardingChapters: { intro: true } }]))
    await expectTourClosed()
  })

  // The 2026-08-21 ruling: skip dismisses the whole tour, not just the chapter.
  it('completes every chapter when the operator skips', async () => {
    renderTour()
    fireEvent.click(await screen.findByTestId('tour-skip'))
    await waitFor(() =>
      expect(updated).toEqual([{ onboardingChapters: { intro: true, ext: true, case: true } }])
    )
  })
})

describe('replay', () => {
  it('opens the extension chapter with the install steps already expanded', async () => {
    anchor('browser')
    renderTour()
    act(() => startTour('ext'))

    expect(await screen.findByTestId('tour-mark')).toBeTruthy()
    expect(screen.getAllByTestId('tour-install-step')).toHaveLength(3)
    expect(screen.getByTestId('tour-count').textContent).toContain('1 of 1')
  })

  // The design prints each step's brief alone: no bold title and dash ahead of
  // it, which made the second step name Load unpacked twice.
  it('prints each install step as its brief alone', async () => {
    anchor('browser')
    renderTour()
    act(() => startTour('ext'))

    await screen.findByTestId('tour-mark')
    const steps = screen.getAllByTestId('tour-install-step').map((s) => s.textContent)
    expect(steps).toEqual([
      '1Open chrome://extensions and switch on Developer mode (top right).',
      '2Click Load unpacked in the toolbar that appears.',
      '3Use Open extension folder on the dashboard to reveal the Birdbrain extension in your ' +
        'file manager. Pick that folder containing manifest.json.'
    ])
  })

  // AC: replay never resets completion state — so it must not write it either.
  it('writes no completion state, however it is closed', async () => {
    anchor('browser')
    renderTour()
    act(() => startTour('ext'))
    fireEvent.click(await screen.findByTestId('tour-skip'))
    await expectTourClosed()
    expect(updated).toEqual([])

    act(() => startTour('ext'))
    fireEvent.click(await screen.findByTestId('tour-next'))
    await expectTourClosed()
    expect(updated).toEqual([])
  })

  it('replays the intro even once every chapter is complete', async () => {
    install(settingsFixture({ onboardingChapters: { intro: true, ext: true, case: true } }))
    renderTour()
    act(() => startTour('intro'))
    expect(await screen.findByTestId('tour-welcome')).toBeTruthy()
  })
})

describe('one chapter displacing another', () => {
  // Neither of these paths reaches `close`, so the displaced chapter's
  // completion has to be written where the displacement happens. Without that
  // the intro is never recorded, `isFreshInstall` is latched once and never
  // cleared, and the welcome card returns on every launch from then on. Every
  // other case-chapter test pre-seeds `{ intro: true }`, which is why this
  // survived the first pass.
  beforeEach(() => {
    install(settingsFixture({ isFreshInstall: true }))
  })

  it('records the intro complete when creating a case pre-empts it', async () => {
    anchor('nav-captures', { top: 120, left: 4, width: 40, height: 40 })
    const { rerender } = renderTour()
    expect(await screen.findByTestId('tour-welcome')).toBeTruthy()

    routerState.caseId = 'case-1'
    await navigateTo('/cases/case-1/overview', () => rerender(<OnboardingTour />))

    expect(await screen.findByTestId('tour-screen')).toBeTruthy()
    await waitFor(() => expect(updated).toEqual([{ onboardingChapters: { intro: true } }]))
  })

  it('records the intro complete when the button it is ringing replays another chapter', async () => {
    anchor('newcase')
    anchor('browser')
    renderTour()
    fireEvent.click(await screen.findByTestId('tour-next'))
    fireEvent.click(await screen.findByTestId('tour-next'))
    // Now on the step that rings the whole extension banner. The ring is
    // pointer-events-none, so the Setup Guide button inside it is live and
    // dispatches exactly this.
    expect(screen.getByTestId('tour-count').textContent).toContain('2 of 2')
    act(() => startTour('ext'))

    await waitFor(() => expect(updated).toEqual([{ onboardingChapters: { intro: true } }]))

    // The replay that displaced it still writes nothing of its own.
    fireEvent.click(await screen.findByTestId('tour-skip'))
    await expectTourClosed()
    expect(updated).toEqual([{ onboardingChapters: { intro: true } }])
  })

  // Mounting straight onto a case route runs both auto-fire effects in one
  // passive-effect flush, so the case chapter displaces an intro that has not
  // rendered yet. Reading the displaced chapter off a ref assigned only during
  // render would see null here and lose the write all over again.
  it('records the intro complete when both chapters auto-fire in one flush', async () => {
    routerState.caseId = 'case-1'
    routerState.pathname = '/cases/case-1/overview'
    anchor('nav-captures', { top: 120, left: 4, width: 40, height: 40 })
    renderTour()

    expect(await screen.findByTestId('tour-screen')).toBeTruthy()
    await waitFor(() => expect(updated).toEqual([{ onboardingChapters: { intro: true } }]))
  })

  // #771, ruled 2026-08-30: a chapter displaced on its very first card is
  // recorded complete, however little of it the operator saw. The concrete path
  // is a fresh install whose first case is empty — the case chapter auto-fires
  // on step 0 and the palette replays the extension chapter over it.
  it('records a chapter displaced on its first card complete', async () => {
    routerState.caseId = 'case-1'
    routerState.pathname = '/cases/case-1/captures'
    install(settingsFixture({ isFreshInstall: true, onboardingChapters: { intro: true } }))
    anchor('nav-captures')
    anchor('browser')
    renderTour()
    // Step 0 of ten, the Captures screen card, and nothing else seen.
    await screen.findByTestId('tour-screen')
    expect(updated).toEqual([])

    act(() => startTour('ext'))

    await waitFor(() =>
      expect(updated).toEqual([{ onboardingChapters: { intro: true, case: true } }])
    )
  })

  it('writes nothing when the displaced chapter was itself a replay', async () => {
    install(settingsFixture({ onboardingChapters: { intro: true, ext: true, case: true } }))
    anchor('browser')
    renderTour()
    act(() => startTour('ext'))
    await screen.findByTestId('tour-mark')
    act(() => startTour('intro'))

    expect(await screen.findByTestId('tour-welcome')).toBeTruthy()
    expect(updated).toEqual([])
  })
})

describe('a missing anchor', () => {
  // Six of the nine anchor families live on surfaces the rest of the redesign
  // rebuilt, so anchor slip is the expected failure. The prototype leaves the
  // rect null and paints the 296px card at the viewport origin.
  it('centres the card instead of pinning it to the viewport origin', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    install(settingsFixture({ isFreshInstall: true }))
    renderTour()
    fireEvent.click(await screen.findByTestId('tour-next'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    const mark = await screen.findByTestId('tour-mark')
    expect(mark.getAttribute('data-anchored')).toBe('false')
    expect(mark.style.top).toBe('')
    expect(mark.style.left).toBe('')
    expect(screen.queryByTestId('tour-ring')).toBeNull()
    expect(screen.queryByTestId('tour-badge')).toBeNull()
    // The copy still gets shown, so the step is skipped rather than broken.
    expect(screen.getByText(/Everything lives in a case/)).toBeTruthy()
    expect(screen.getByTestId('tour-dim').style.background).toContain('0.38')
  })

  it('still lets the operator move on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    install(settingsFixture({ isFreshInstall: true }))
    renderTour()
    fireEvent.click(await screen.findByTestId('tour-next'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    fireEvent.click(screen.getByTestId('tour-skip'))
    // Fake timers hold motion's exit open, so the close is asserted through the
    // completion write it produced rather than through the node detaching.
    await waitFor(() =>
      expect(updated).toEqual([{ onboardingChapters: { intro: true, ext: true, case: true } }])
    )
  })
})

describe('the case chapter', () => {
  beforeEach(() => {
    routerState.caseId = 'case-1'
    routerState.pathname = '/cases/case-1/overview'
    install(settingsFixture({ isFreshInstall: true, onboardingChapters: { intro: true } }))
  })

  it('opens on Captures whichever case tab was clicked', async () => {
    anchor('nav-captures', { top: 120, left: 4, width: 40, height: 40 })
    renderTour()

    expect(await screen.findByTestId('tour-screen')).toBeTruthy()
    expect(screen.getByTestId('tour-screen-count').textContent).toBe('Screen 1 of 4')
    expect(screen.getByText('Captures')).toBeTruthy()
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case-1' }
    })
    expect(screen.getByTestId('tour-nav-ring')).toBeTruthy()
  })

  it('jumps forward to wherever the operator navigated, and never back', async () => {
    anchor('nav-captures', { top: 120, left: 4, width: 40, height: 40 })
    anchor('nav-notes', { top: 200, left: 4, width: 40, height: 40 })
    anchor('nav-overview', { top: 280, left: 4, width: 40, height: 40 })
    const { rerender } = renderTour()
    const again = () => rerender(<OnboardingTour />)
    await screen.findByTestId('tour-screen')
    routerState.pathname = '/cases/case-1/captures'
    await act(async () => again())

    // Straight past Signals to Notes: the skipped steps are not replayed.
    await navigateTo('/cases/case-1/notes', again)
    expect(screen.getByTestId('tour-screen-count').textContent).toBe('Screen 3 of 4')
    expect(screen.getByText('Notes')).toBeTruthy()

    // Back to Captures does not rewind the tour into a step already shown.
    await navigateTo('/cases/case-1/captures', again)
    expect(screen.getByTestId('tour-screen-count').textContent).toBe('Screen 3 of 4')

    // A screen the tour does not visit leaves it where it was.
    await navigateTo('/cases/case-1/data', again)
    expect(screen.getByTestId('tour-screen-count').textContent).toBe('Screen 3 of 4')

    await navigateTo('/cases/case-1/overview', again)
    expect(screen.getByTestId('tour-screen-count').textContent).toBe('Screen 4 of 4')
  })

  it('does not treat its own navigation as the operator navigating', async () => {
    anchor('nav-captures', { top: 120, left: 4, width: 40, height: 40 })
    const { rerender } = renderTour()
    await screen.findByTestId('tour-screen')
    // The engine navigated to Captures itself; arriving there must not jump the
    // tour past the step that did the navigating.
    await navigateTo('/cases/case-1/captures', () => rerender(<OnboardingTour />))
    expect(screen.getByTestId('tour-screen-count').textContent).toBe('Screen 1 of 4')
  })

  it('does not fire without a case to run in', async () => {
    routerState.caseId = undefined
    routerState.pathname = '/'
    renderTour()
    await waitFor(() => expect(updated).toEqual([]))
    expect(screen.queryByTestId('tour-screen')).toBeNull()
  })
})

describe('an anchor below the fold', () => {
  // The extension banner is under the hero on any dashboard with content above
  // it, so the ring — and with it the tooltip — landed off screen.
  it('scrolls the anchor into view and rings it there', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    install(settingsFixture({ isFreshInstall: true }))
    const target = anchor('newcase', { top: 1400 })
    const scrollIntoView = vi.fn(() => {
      target.getBoundingClientRect = () =>
        ({
          top: 380,
          left: 200,
          width: 120,
          height: 40,
          right: 320,
          bottom: 420,
          x: 200,
          y: 380
        }).valueOf() as DOMRect
    })
    target.scrollIntoView = scrollIntoView

    renderTour()
    fireEvent.click(await screen.findByTestId('tour-next'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
    expect(screen.getByTestId('tour-ring').style.top).toBe('376px')
    expect(screen.getByTestId('tour-mark').getAttribute('data-anchored')).toBe('true')
  })

  it('falls back to the centred card when it cannot be brought into view', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    install(settingsFixture({ isFreshInstall: true }))
    const target = anchor('newcase', { top: 1400 })
    target.scrollIntoView = vi.fn()

    renderTour()
    fireEvent.click(await screen.findByTestId('tour-next'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })

    expect(screen.getByTestId('tour-mark').getAttribute('data-anchored')).toBe('false')
    expect(screen.queryByTestId('tour-ring')).toBeNull()
  })
})

describe('measurement', () => {
  it('follows a target that scrolls inside its pane', async () => {
    install(settingsFixture({ isFreshInstall: true }))
    const target = anchor('newcase')
    renderTour()
    fireEvent.click(await screen.findByTestId('tour-next'))
    await screen.findByTestId('tour-ring')
    expect(screen.getByTestId('tour-ring').style.top).toBe('96px')

    target.getBoundingClientRect = () =>
      ({
        top: 40,
        left: 200,
        width: 120,
        height: 40,
        right: 320,
        bottom: 80,
        x: 200,
        y: 40
      }).valueOf() as DOMRect
    await act(async () => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(screen.getByTestId('tour-ring').style.top).toBe('36px')
  })

  it('re-clamps the tooltip when the window is resized', async () => {
    install(settingsFixture({ isFreshInstall: true }))
    anchor('newcase', { left: 1200 })
    renderTour()
    fireEvent.click(await screen.findByTestId('tour-next'))
    const before = (await screen.findByTestId('tour-mark')).style.left

    window.innerWidth = 600
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(screen.getByTestId('tour-mark').style.left).not.toBe(before)
  })
})

describe('the dim layer', () => {
  it('hands the dimming to the ring once an anchor is measured', async () => {
    install(settingsFixture({ isFreshInstall: true }))
    anchor('newcase')
    renderTour()
    expect(screen.queryByTestId('tour-dim')).toBeNull()
    const welcome = await screen.findByTestId('tour-welcome')
    expect(welcome).toBeTruthy()
    expect(screen.getByTestId('tour-dim').style.background).toContain('0.5')

    fireEvent.click(screen.getByTestId('tour-next'))
    await screen.findByTestId('tour-ring')
    expect(screen.getByTestId('tour-dim').style.background).toContain('rgba(6, 6, 10, 0)')
  })
})

describe('the seeded demo case', () => {
  const demoCase = { id: 'case-1', name: 'Demo: Nightjar Exchange', isDemo: true }
  const ownCase = { id: 'case-1', name: 'Operation Kingfisher', isDemo: false }
  let deleteDemo: ReturnType<typeof vi.fn>
  let list: ReturnType<typeof vi.fn>

  function installWithCases(cases: Array<Record<string, unknown>>, settings: BirdbrainSettings) {
    updated = []
    deleteDemo = vi.fn().mockResolvedValue(true)
    list = vi.fn().mockResolvedValue(cases)
    fakeBridge({
      settings: {
        get: vi.fn().mockResolvedValue(settings),
        update: vi.fn().mockImplementation((partial: Partial<BirdbrainSettings>) => {
          updated.push(partial)
          return Promise.resolve({ ...settings, ...partial })
        })
      },
      cases: { list, deleteDemo },
      captures: { list: vi.fn().mockResolvedValue([{ id: 'capture-1' }, { id: 'capture-2' }]) }
    })
  }

  /**
   * One step forward. Steps whose anchor is not mounted spend the engine's
   * retry budget before falling back to a centred card, so each advance waits
   * for a rendered surface rather than assuming one is already there.
   */
  async function clickNext(rerender: () => void) {
    const button = await screen.findByTestId('tour-next', undefined, { timeout: 3000 })
    fireEvent.click(button)
    await act(async () => rerender())
  }

  /** Walks the case chapter to its last step, which is the one that branches. */
  async function reachFinalStep(rerender: () => void) {
    await screen.findByTestId('tour-screen')
    for (let i = 0; i < 9; i += 1) await clickNext(rerender)
    await screen.findByTestId('tour-next', undefined, { timeout: 3000 })
  }

  /**
   * Every anchor the case chapter rings. Mounting them all keeps the walk to
   * the last step off the engine's per-step retry budget, which the ten-step
   * chapter would otherwise spend nine times over.
   */
  function anchorWholeChapter() {
    for (const name of [
      'nav-captures',
      'viewertabs',
      'caseswitcher',
      'nav-signals',
      'selectors',
      'nav-notes',
      'noteeditor',
      'nav-overview',
      'linkmap',
      'export'
    ]) {
      anchor(name)
    }
  }

  beforeEach(() => {
    routerState.caseId = 'case-1'
    routerState.pathname = '/cases/case-1/overview'
  })

  it('offers the delete ending only on a demo case', async () => {
    installWithCases(
      [demoCase],
      settingsFixture({ isFreshInstall: true, onboardingChapters: { intro: true } })
    )
    anchorWholeChapter()
    const { rerender } = renderTour()
    await reachFinalStep(() => rerender(<OnboardingTour />))

    expect(screen.getByTestId('tour-delete-demo')).toBeTruthy()
    expect(screen.getByTestId('tour-next').textContent).toBe('Keep exploring')
  })

  it('withholds the delete ending on a case the operator made', async () => {
    installWithCases(
      [ownCase],
      settingsFixture({ isFreshInstall: true, onboardingChapters: { intro: true } })
    )
    anchorWholeChapter()
    const { rerender } = renderTour()
    await reachFinalStep(() => rerender(<OnboardingTour />))

    // The case chapter fires on whichever case a fresh install opens first, so
    // an ungated ending would offer one-click deletion of real evidence (#405).
    expect(screen.queryByTestId('tour-delete-demo')).toBeNull()
    expect(screen.getByTestId('tour-next').textContent).toBe('Keep exploring')
  })

  it('deletes the demo case, leaves the case, and closes the tour', async () => {
    installWithCases(
      [demoCase],
      settingsFixture({ isFreshInstall: true, onboardingChapters: { intro: true } })
    )
    anchorWholeChapter()
    const { rerender } = renderTour()
    await reachFinalStep(() => rerender(<OnboardingTour />))

    fireEvent.click(screen.getByTestId('tour-delete-demo'))
    await act(async () => rerender(<OnboardingTour />))

    await waitFor(() => expect(deleteDemo).toHaveBeenCalledWith('case-1'))
    // The case it was touring is gone, so the tour leaves it rather than
    // sitting on a dead route.
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }))
    // The chapter is closed through its completion write rather than through
    // the node detaching: the rerenders that drive this walk hold motion's exit
    // animation open, the same reason the fake-timer test above asserts on
    // `updated`.
    await waitFor(() =>
      expect(updated).toEqual([{ onboardingChapters: { intro: true, case: true } }])
    )
  })

  it('refreshes the tag caches the demo delete empties', async () => {
    installWithCases(
      [demoCase],
      settingsFixture({ isFreshInstall: true, onboardingChapters: { intro: true } })
    )
    anchorWholeChapter()
    const { rerender, client } = renderTour()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await reachFinalStep(() => rerender(<OnboardingTour />))

    fireEvent.click(screen.getByTestId('tour-delete-demo'))
    await act(async () => rerender(<OnboardingTour />))

    // The demo delete takes the demo's own tag rows with it, and tags are
    // global: a picker left holding the cached list would offer one whose row
    // is gone and fail its foreign-key write.
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.tags }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.cases })
  })

  it('does not leave the case when main refuses the delete', async () => {
    installWithCases(
      [demoCase],
      settingsFixture({ isFreshInstall: true, onboardingChapters: { intro: true } })
    )
    // main answers a refusal with `false` rather than an error, so nothing
    // downstream would notice it without the mutation raising it.
    deleteDemo.mockResolvedValue(false)
    anchorWholeChapter()
    const { rerender } = renderTour()
    await reachFinalStep(() => rerender(<OnboardingTour />))

    fireEvent.click(screen.getByTestId('tour-delete-demo'))
    await act(async () => rerender(<OnboardingTour />))

    await waitFor(() => expect(deleteDemo).toHaveBeenCalledWith('case-1'))
    // The case is still there, so navigating to the dashboard would present a
    // refused delete as a completed one.
    expect(navigate).not.toHaveBeenCalledWith({ to: '/' })
    // The tour still ends: the operator chose an ending, and leaving them on
    // its final step with nothing to click is the worse failure.
    await waitFor(() =>
      expect(updated).toEqual([{ onboardingChapters: { intro: true, case: true } }])
    )
  })

  it('leaves the demo case alone when the operator keeps exploring', async () => {
    installWithCases(
      [demoCase],
      settingsFixture({ isFreshInstall: true, onboardingChapters: { intro: true } })
    )
    anchorWholeChapter()
    const { rerender } = renderTour()
    await reachFinalStep(() => rerender(<OnboardingTour />))

    await clickNext(() => rerender(<OnboardingTour />))

    await waitFor(() =>
      expect(updated).toEqual([{ onboardingChapters: { intro: true, case: true } }])
    )
    // Keep exploring leaves the demo case exactly where it is: an ordinary case
    // the operator can carry on using.
    expect(deleteDemo).not.toHaveBeenCalled()
  })

  it('selects a capture so the viewer-tabs step has something to ring', async () => {
    installWithCases(
      [demoCase],
      settingsFixture({ isFreshInstall: true, onboardingChapters: { intro: true } })
    )
    anchorWholeChapter()
    const { rerender } = renderTour()
    await screen.findByTestId('tour-screen')

    await clickNext(() => rerender(<OnboardingTour />))

    await waitFor(() => expect(useAppStore.getState().selectedCaptureId).toBe('capture-1'))
  })

  it('does not clobber a capture the operator already had open', async () => {
    installWithCases(
      [demoCase],
      settingsFixture({ isFreshInstall: true, onboardingChapters: { intro: true } })
    )
    useAppStore.getState().setSelectedCaptureId('capture-2')
    anchorWholeChapter()
    const { rerender } = renderTour()
    await screen.findByTestId('tour-screen')

    await clickNext(() => rerender(<OnboardingTour />))

    expect(useAppStore.getState().selectedCaptureId).toBe('capture-2')
  })

  it('asks the Notes screen to open its composer for the note-editor step', async () => {
    installWithCases(
      [demoCase],
      settingsFixture({ isFreshInstall: true, onboardingChapters: { intro: true } })
    )
    const opened = vi.fn()
    window.addEventListener(NOTE_COMPOSER_EVENT, opened)
    anchorWholeChapter()
    const { rerender } = renderTour()
    await screen.findByTestId('tour-screen')

    // Six Nexts reach the note-editor step; the composer request fires with it.
    for (let i = 0; i < 6; i += 1) await clickNext(() => rerender(<OnboardingTour />))

    expect(opened).toHaveBeenCalled()
    window.removeEventListener(NOTE_COMPOSER_EVENT, opened)
  })
})

// The tour is modal for the keyboard (#1536): it takes focus, holds Tab,
// dismisses on Escape and hands focus back to whatever opened it.
describe('keyboard', () => {
  function opener() {
    const button = document.createElement('button')
    button.textContent = 'Setup Guide'
    document.body.appendChild(button)
    button.focus()
    return button
  }

  afterEach(() => {
    useAppStore.setState({ openDialogCount: 0 })
  })

  it('moves focus onto the coach mark’s forward action and marks it modal', async () => {
    anchor('browser')
    opener()
    renderTour()
    act(() => startTour('ext'))

    const mark = await screen.findByTestId('tour-mark')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('tour-next')))
    const dialog = within(mark).getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBeTruthy()
    expect(screen.getByTestId('tour-copy').getAttribute('aria-live')).toBe('polite')
  })

  it('keeps Tab inside the tour instead of walking the page behind it', async () => {
    anchor('browser')
    const button = opener()
    renderTour()
    act(() => startTour('ext'))
    const next = await screen.findByTestId('tour-next')
    await waitFor(() => expect(document.activeElement).toBe(next))

    fireEvent.keyDown(next, { key: 'Tab' })

    expect(document.activeElement).toBe(screen.getByTestId('tour-install-toggle'))
    expect(document.activeElement).not.toBe(button)
  })

  it('dismisses on Escape, writes nothing on a replay, and hands focus back', async () => {
    anchor('browser')
    const button = opener()
    renderTour()
    act(() => startTour('ext'))
    await screen.findByTestId('tour-mark')
    expect(useAppStore.getState().openDialogCount).toBe(1)

    fireEvent.keyDown(window, { key: 'Escape' })

    // Keyed on the tour closing, not on its exit animation finishing, so it is
    // asserted straight away. Waiting for the detach as well timed out when
    // this block ran after the rest of the file, though not on its own.
    expect(document.activeElement).toBe(button)
    expect(updated).toEqual([])
    expect(useAppStore.getState().openDialogCount).toBe(0)
  })

  it('lands on Start tour when the welcome card opens, and marks it modal', async () => {
    install(settingsFixture({ isFreshInstall: true }))
    renderTour()

    const card = await screen.findByTestId('tour-welcome')

    expect(card.getAttribute('aria-modal')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('tour-next')))
  })

  it('marks the screen card modal and names it after its screen', async () => {
    routerState.caseId = 'case-1'
    routerState.pathname = '/cases/case-1/overview'
    install(settingsFixture({ isFreshInstall: true, onboardingChapters: { intro: true } }))
    anchor('nav-captures', { top: 120, left: 4, width: 40, height: 40 })
    renderTour()

    const screenCard = await screen.findByTestId('tour-screen')

    const dialog = within(screenCard).getByRole('dialog', { name: 'Captures' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('tour-next')))
  })
})
