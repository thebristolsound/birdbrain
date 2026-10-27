// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { routeTree } from '@renderer/routes/__root'
import { CaseSettingsRoute } from '@renderer/routes/cases/$caseId/settings'
import { CaseWorkspace } from '@renderer/components/dashboard/cases/CaseWorkspace'
import { fakeBridge } from '../renderer/fakeBridge'
import { CASE_ID, members, settings, snapshot, sync } from './sharingFixtures'

const SLOW = { timeout: 5000 }

afterEach(cleanup)

// Case settings (#1514) is declared under the Case workspace; its entry points
// are pinned in tests/components/CaseSettingsEntryPoints.test.tsx.
describe('the Case settings route', () => {
  it('sits under the Case workspace route in the app route tree', async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: [`/cases/${CASE_ID}/settings`] })
    })
    await router.load()
    const ids = router.state.matches.map(({ routeId }) => routeId)
    expect(ids.slice(-2)).toEqual(['/cases/$caseId', '/cases/$caseId/settings'])
    expect(router.state.matches[router.state.matches.length - 1].params).toEqual({
      caseId: CASE_ID
    })
  })

  it('is distinct from the app-wide /settings route', async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/settings'] })
    })
    await router.load()
    const ids = router.state.matches.map(({ routeId }) => routeId)
    expect(ids[ids.length - 1]).toBe('/settings')
  })
})

describe('the Case settings route in the Case workspace', () => {
  beforeEach(() => {
    const caseRow = {
      id: CASE_ID,
      name: 'Harbour inquiry',
      isDemo: false,
      archived: false,
      createdAt: '',
      updatedAt: ''
    }
    fakeBridge({
      cases: {
        list: vi.fn(async () => [caseRow]),
        get: vi.fn(async () => caseRow),
        ensureSearchFields: vi.fn(async () => ({ indexed: 0, noSource: 0, failed: 0 }))
      },
      session: { activateCase: vi.fn(async () => ({ sessionActive: false, activeCaseId: null })) },
      settings: { get: vi.fn(async () => settings()), update: vi.fn(async () => settings()) },
      selectors: { matchingCaptures: vi.fn(async () => []) },
      tags: { capturesWithAnyTag: vi.fn(async () => []), list: vi.fn(async () => []) },
      sharing: {
        isAvailable: vi.fn(async () => true),
        getMembers: vi.fn(async () => members()),
        getSyncState: vi.fn(async () => sync())
      },
      manifest: { snapshot: vi.fn(async () => snapshot()) }
    })
  })

  it('fills the workspace without its padding, so the page owns its scroll', async () => {
    const root = createRootRoute()
    const caseRoute = createRoute({
      getParentRoute: () => root,
      path: '/cases/$caseId',
      component: CaseWorkspace
    })
    const settingsRoute = createRoute({
      getParentRoute: () => caseRoute,
      path: '/settings',
      component: CaseSettingsRoute
    })
    const router = createRouter({
      routeTree: root.addChildren([caseRoute.addChildren([settingsRoute])]),
      history: createMemoryHistory({ initialEntries: [`/cases/${CASE_ID}/settings`] })
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
    const view = await screen.findByTestId('case-settings-view', undefined, SLOW)
    const outlet = view.parentElement as HTMLElement
    expect(outlet.className.split(/\s+/)).toEqual(['flex-1', 'overflow-hidden'])
    expect(await screen.findByTestId('members-tab', undefined, SLOW)).toBeTruthy()
  })
})
