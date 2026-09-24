import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CaseWorkspace } from '@renderer/components/dashboard/cases/CaseWorkspace'
import { fakeBridge } from '../renderer/fakeBridge'

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: 'case-1' }),
  useSearch: () => ({}),
  useMatchRoute:
    () =>
    ({ to }: { to: string }) =>
      to.endsWith('/notes') ? {} : false,
  Outlet: () => <div data-testid="workspace-outlet" />
}))

afterEach(cleanup)

it('gives Notes the full-height shell so its list and editor scroll independently', async () => {
  fakeBridge({
    cases: { list: vi.fn(async () => [{ id: 'case-1' }]) },
    session: { activateCase: vi.fn(async () => ({ sessionActive: false, activeCaseId: null })) },
    settings: { update: vi.fn(async () => ({})) },
    selectors: { matchingCaptures: vi.fn(async () => []) },
    tags: { capturesWithAnyTag: vi.fn(async () => []), list: vi.fn(async () => []) }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CaseWorkspace />
    </QueryClientProvider>
  )
  const outlet = await screen.findByTestId('workspace-outlet')
  expect(outlet.parentElement?.className).toBe('flex-1 overflow-hidden')
})
