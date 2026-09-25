// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CaseWorkspace } from '@renderer/components/dashboard/cases/CaseWorkspace'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'

afterEach(cleanup)
it('retains capture selection after a real router case switch and the workspace reset', async () => {
  fakeBridge({
    cases: {
      list: vi.fn(async () =>
        ['case-1', 'case-2'].map((id) => ({
          id,
          name: id,
          isDemo: false,
          archived: false,
          createdAt: '',
          updatedAt: ''
        }))
      )
    },
    session: { activateCase: vi.fn(async () => ({ sessionActive: false, activeCaseId: null })) },
    settings: { update: vi.fn(async () => ({})) },
    selectors: { matchingCaptures: vi.fn(async () => []) },
    tags: { capturesWithAnyTag: vi.fn(async () => []), list: vi.fn(async () => []) }
  })
  const root = createRootRoute()
  const caseRoute = createRoute({
    getParentRoute: () => root,
    path: '/cases/$caseId',
    component: CaseWorkspace
  })
  const captures = createRoute({
    getParentRoute: () => caseRoute,
    path: '/captures',
    validateSearch: (search: Record<string, unknown>): { captureId?: string } => ({
      captureId: typeof search.captureId === 'string' ? search.captureId : undefined
    }),
    component: () => <div>Captures</div>
  })
  const router = createRouter({
    routeTree: root.addChildren([caseRoute.addChildren([captures])]),
    history: createMemoryHistory({ initialEntries: ['/cases/case-1/captures'] })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await waitFor(() => expect(router.state.status).toBe('idle'))
  act(() => {
    useAppStore.getState().setSelectedCaptureId('old-capture')
    useAppStore.getState().addTagFilter('old-filter')
  })
  await act(async () => {
    await router.navigate({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case-2' },
      search: { captureId: 'card-capture' }
    })
  })
  await waitFor(() => expect(useAppStore.getState().selectedCaptureId).toBe('card-capture'))
  expect(useAppStore.getState().activeTagFilters).toEqual([])
  expect(router.state.location.pathname).toBe('/cases/case-2/captures')
})
