// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
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
    ({ ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top })
      .valueOf() as DOMRect
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
  return render(<OnboardingTour />, { wrapper: Wrapper })
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
    expect(await screen.findByTestId('tour-welcome')).toBeTruthy()
    expect(screen.getByText('Welcome to Birdbrain')).toBeTruthy()
    expect(screen.getByText('replays this tour anytime')).toBeTruthy()
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
    install(
      settingsFixture({ onboardingChapters: { intro: true, ext: true, case: true } })
    )
    renderTour()
    act(() => startTour('intro'))
    expect(await screen.findByTestId('tour-welcome')).toBeTruthy()
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

describe('measurement', () => {
  it('follows a target that scrolls inside its pane', async () => {
    install(settingsFixture({ isFreshInstall: true }))
    const target = anchor('newcase')
    renderTour()
    fireEvent.click(await screen.findByTestId('tour-next'))
    await screen.findByTestId('tour-ring')
    expect(screen.getByTestId('tour-ring').style.top).toBe('96px')

    target.getBoundingClientRect = () =>
      ({ top: 40, left: 200, width: 120, height: 40, right: 320, bottom: 80, x: 200, y: 40 })
        .valueOf() as DOMRect
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
