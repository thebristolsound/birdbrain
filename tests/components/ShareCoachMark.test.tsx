// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { BirdbrainSettings, Case } from '@shared/types'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubMatchMedia } from './matchMediaStub'
import { queryKeys } from '@renderer/lib/api/keys'
import { useAppStore } from '@renderer/stores/appStore'

const navigate = vi.hoisted(() => vi.fn())
const routerState = vi.hoisted(() => ({
  pathname: '/cases/case-1/overview',
  caseId: 'case-1' as string | undefined
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ caseId: routerState.caseId }),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: routerState.pathname } })
}))

import { ShareCoachMark } from '@renderer/components/onboarding/ShareCoachMark'

const LOCAL_CASE: Case = {
  id: 'case-1',
  name: 'Investigation One',
  isDemo: false,
  archived: false,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z'
}

let updated: Array<Partial<BirdbrainSettings>>

interface Install {
  settings?: Partial<BirdbrainSettings>
  cases?: Case[]
  available?: boolean
}

function install({ settings, cases = [LOCAL_CASE], available = true }: Install = {}) {
  updated = []
  const full = { isFreshInstall: false, onboardingChapters: {}, ...settings } as BirdbrainSettings
  fakeBridge({
    settings: {
      get: vi.fn().mockResolvedValue(full),
      update: vi.fn().mockImplementation((partial: Partial<BirdbrainSettings>) => {
        updated.push(partial)
        return Promise.resolve({ ...full, ...partial })
      })
    },
    cases: { list: vi.fn(async () => cases) },
    sharing: { isAvailable: vi.fn(async () => available) }
  })
}

/** A stand-in for the pill, with a rect the mark can measure. */
function anchor() {
  const el = document.createElement('button')
  el.setAttribute('data-tour', 'share')
  el.setAttribute('data-testid', 'anchor-share')
  const box = { top: 10, left: 800, width: 70, height: 28 }
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

function renderMark() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return { ...render(<ShareCoachMark />, { wrapper: Wrapper }), client }
}

async function settled(client: QueryClient) {
  await waitFor(() => {
    expect(client.getQueryState(queryKeys.settings)?.status).toBe('success')
    expect(client.getQueryState(queryKeys.cases)?.status).toBe('success')
    expect(client.getQueryState(queryKeys.sharingAvailable)?.status).toBe('success')
  })
}

beforeEach(() => {
  stubMatchMedia(false)
  navigate.mockClear()
  routerState.pathname = '/cases/case-1/overview'
  routerState.caseId = 'case-1'
})

afterEach(() => {
  cleanup()
  document.querySelectorAll('[data-tour="share"]').forEach((el) => el.remove())
  useAppStore.setState({ shareMarkOpen: false })
})

// Frame A of docs/design-handoff/2026-10-28-share-a-case/: one card, once,
// under the pill, and the exception to the tour's upgrade rule.
describe('ShareCoachMark', () => {
  it('shows under the pill the first time an existing install opens a Case, and rings it', async () => {
    anchor()
    install()
    renderMark()
    const mark = await screen.findByTestId('share-mark')
    expect(screen.getByRole('dialog', { name: 'New: share a Case with teammates' })).toBeTruthy()
    expect(mark.textContent).toContain(
      'Up to four other people who run Birdbrain, each with a full copy that stays in sync. ' +
        'You approve every join.'
    )
    expect(useAppStore.getState().shareMarkOpen).toBe(true)
    expect(mark.dataset.flipped).toBe('false')
  })

  it('Got it dismisses it for good', async () => {
    anchor()
    install()
    renderMark()
    fireEvent.click(await screen.findByTestId('share-mark-got-it'))
    await waitFor(() => expect(screen.queryByTestId('share-mark')).toBeNull())
    expect(updated).toEqual([{ onboardingChapters: { share: true } }])
    expect(useAppStore.getState().shareMarkOpen).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('Show me opens Members and dismisses it', async () => {
    anchor()
    install()
    renderMark()
    fireEvent.click(await screen.findByTestId('share-mark-show-me'))
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/settings',
      params: { caseId: 'case-1' }
    })
    await waitFor(() => expect(screen.queryByTestId('share-mark')).toBeNull())
    expect(updated).toEqual([{ onboardingChapters: { share: true } }])
  })

  it('treats a click on the pill as a dismissal', async () => {
    const pill = anchor()
    install()
    renderMark()
    await screen.findByTestId('share-mark')
    fireEvent.click(pill)
    await waitFor(() => expect(screen.queryByTestId('share-mark')).toBeNull())
    expect(updated).toEqual([{ onboardingChapters: { share: true } }])
  })

  it('keeps the chapters already recorded when it writes its own key', async () => {
    anchor()
    install({ settings: { onboardingChapters: { intro: true, ext: true, case: true } } })
    renderMark()
    fireEvent.click(await screen.findByTestId('share-mark-got-it'))
    await waitFor(() => expect(updated).toHaveLength(1))
    expect(updated[0]).toEqual({
      onboardingChapters: { intro: true, ext: true, case: true, share: true }
    })
  })

  it('never shows again once dismissed', async () => {
    anchor()
    install({ settings: { onboardingChapters: { share: true } } })
    const { client } = renderMark()
    await settled(client)
    expect(screen.queryByTestId('share-mark')).toBeNull()
    expect(useAppStore.getState().shareMarkOpen).toBe(false)
  })

  it('waits while a fresh install still has its tour to auto-fire', async () => {
    anchor()
    install({ settings: { isFreshInstall: true, onboardingChapters: {} } })
    const { client } = renderMark()
    await settled(client)
    expect(screen.queryByTestId('share-mark')).toBeNull()
  })

  it('shows once a fresh install has finished the intro and case chapters', async () => {
    anchor()
    install({ settings: { isFreshInstall: true, onboardingChapters: { intro: true, case: true } } })
    renderMark()
    expect(await screen.findByTestId('share-mark')).toBeTruthy()
  })

  it('stays off the dashboard and the wizard', async () => {
    anchor()
    install()
    routerState.pathname = '/'
    routerState.caseId = undefined
    const { client } = renderMark()
    await settled(client)
    expect(screen.queryByTestId('share-mark')).toBeNull()
  })

  it('stays off where sharing is unavailable', async () => {
    anchor()
    install({ available: false })
    const { client } = renderMark()
    await settled(client)
    expect(screen.queryByTestId('share-mark')).toBeNull()
  })

  it('stays off once any Case on this installation is shared or joined', async () => {
    anchor()
    install({
      cases: [LOCAL_CASE, { ...LOCAL_CASE, id: 'case-2', sharedAt: '2026-09-19T14:00:00.000Z' }]
    })
    const { client } = renderMark()
    await settled(client)
    expect(screen.queryByTestId('share-mark')).toBeNull()
  })

  it('renders nothing while the pill has not mounted', async () => {
    install()
    const { client } = renderMark()
    await settled(client)
    expect(screen.queryByTestId('share-mark')).toBeNull()
    expect(useAppStore.getState().shareMarkOpen).toBe(false)
  })
})
