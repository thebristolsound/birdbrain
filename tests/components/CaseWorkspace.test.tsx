// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fakeBridge } from '../renderer/fakeBridge'
import { CaseWorkspace } from '@renderer/components/dashboard/cases/CaseWorkspace'
import { useAppStore } from '@renderer/stores/appStore'

let currentCaseId = 'case-1'

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: currentCaseId }),
  useMatchRoute: () => () => false,
  Outlet: () => null
}))

const store = () => useAppStore.getState()

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = () => (
    <QueryClientProvider client={client}>
      <CaseWorkspace />
    </QueryClientProvider>
  )
  const { rerender } = render(tree())
  return { rerender: () => rerender(tree()) }
}

beforeEach(() => {
  currentCaseId = 'case-1'
  store().clearTagFilters()
  store().clearSelectorFilters()
  fakeBridge({
    cases: { list: vi.fn(async () => []) },
    session: { activateCase: vi.fn(async () => ({ sessionActive: false, activeCaseId: null })) },
    settings: { update: vi.fn(async () => ({})) },
    selectors: { matchingCaptures: vi.fn(async () => []) },
    tags: { capturesWithAnyTag: vi.fn(async () => []), list: vi.fn(async () => []) }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Tags are app-global, but a tag filter is per-case UI state: carrying one
// across would narrow the new case by a tag picked while looking at another.
describe('CaseWorkspace per-case reset (#918)', () => {
  it('clears the tag filter alongside the selector filter on a case switch', async () => {
    const { rerender } = renderWorkspace()

    act(() => {
      store().addTagFilter('t1')
      store().setTagFilteredCaptureIds(['c1'])
      store().addSelectorFilter('s1')
    })
    expect(store().activeTagFilters).toEqual(['t1'])

    currentCaseId = 'case-2'
    rerender()

    await waitFor(() => expect(store().activeTagFilters).toEqual([]))
    expect(store().tagFilteredCaptureIds).toBeNull()
    expect(store().activeSelectorFilters).toEqual([])
  })
})
