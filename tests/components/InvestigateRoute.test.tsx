// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { routeTree } from '@renderer/routes/__root'
import {
  InvestigateRoute,
  validateInvestigateSearch
} from '@renderer/routes/cases/$caseId/investigate'
import { CaseWorkspace } from '@renderer/components/dashboard/cases/CaseWorkspace'
import { FIXTURE_BEFORE_RUN_VIEW, FIXTURE_POPULATED_VIEW } from '@shared/investigationFixture'
import type { InvestigationView } from '@shared/investigation'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubResizeObserverWithWidth } from './resizeObserverStub'

const CASE_ID = 'c0ffee00-0000-4000-8000-000000000002'
const SLOW = { timeout: 5000 }

afterEach(cleanup)

describe('the Investigate route', () => {
  it('sits under the Case workspace route in the app route tree', async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({
        initialEntries: [`/cases/${CASE_ID}/investigate?jointId=j1&subjectId=7`]
      })
    })
    await router.load()
    const ids = router.state.matches.map(({ routeId }) => routeId)
    expect(ids.slice(-2)).toEqual(['/cases/$caseId', '/cases/$caseId/investigate'])
    const match = router.state.matches[router.state.matches.length - 1]
    expect(match.params).toEqual({ caseId: CASE_ID })
    expect(match.search).toMatchObject({ jointId: 'j1', subjectId: undefined, spanId: undefined })
  })

  it('keeps the selection keys only when each is a string', () => {
    expect(validateInvestigateSearch({ jointId: 'j1', subjectId: 's1', spanId: 'p1' })).toEqual({
      jointId: 'j1',
      subjectId: 's1',
      spanId: 'p1'
    })
    expect(validateInvestigateSearch({ jointId: 7, subjectId: null, spanId: ['p1'] })).toEqual({
      jointId: undefined,
      subjectId: undefined,
      spanId: undefined
    })
  })
})

describe('the Investigate route in the Case workspace', () => {
  let reportWidth: (width: number) => void
  let view: InvestigationView

  beforeEach(() => {
    reportWidth = stubResizeObserverWithWidth()
    view = FIXTURE_POPULATED_VIEW
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
      settings: { update: vi.fn(async () => ({})) },
      selectors: { matchingCaptures: vi.fn(async () => []) },
      tags: { capturesWithAnyTag: vi.fn(async () => []), list: vi.fn(async () => []) },
      investigation: { getView: vi.fn(async () => view) }
    })
  })

  function mountAt(path: string) {
    const root = createRootRoute()
    const caseRoute = createRoute({
      getParentRoute: () => root,
      path: '/cases/$caseId',
      component: CaseWorkspace
    })
    const investigate = createRoute({
      getParentRoute: () => caseRoute,
      path: '/investigate',
      validateSearch: validateInvestigateSearch,
      component: InvestigateRoute
    })
    const router = createRouter({
      routeTree: root.addChildren([caseRoute.addChildren([investigate])]),
      history: createMemoryHistory({ initialEntries: [path] })
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
    return router
  }

  it('fills the workspace without its padding, so the view measures the room it has', async () => {
    view = FIXTURE_BEFORE_RUN_VIEW
    mountAt(`/cases/${CASE_ID}/investigate`)
    const root = await screen.findByTestId('investigate-view', undefined, SLOW)
    const outlet = root.parentElement as HTMLElement
    expect(outlet.className.split(/\s+/)).toEqual(['flex-1', 'overflow-hidden'])
    expect(outlet.className).not.toContain('p-[var(--d-pad)]')
    expect(await screen.findByText('Harbour inquiry', undefined, SLOW)).toBeTruthy()
  })

  it('keeps the selection in the search through a tab switch and width changes', async () => {
    const router = mountAt(`/cases/${CASE_ID}/investigate?jointId=j1`)
    await screen.findByTestId('investigate-header', undefined, SLOW)
    await waitFor(() => expect(router.state.status).toBe('idle'), SLOW)

    act(() => reportWidth(1000))
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Source' }), { button: 0 })
    expect(router.state.location.search).toEqual({ jointId: 'j1' })
    act(() => reportWidth(1152))
    expect(router.state.location.search).toEqual({ jointId: 'j1' })
    act(() => reportWidth(1000))
    expect(screen.getByRole('tab', { name: 'Source' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('region', { name: 'Source inspector' })).toBeTruthy()
    expect(router.state.location.search).toEqual({ jointId: 'j1' })
  })
})
