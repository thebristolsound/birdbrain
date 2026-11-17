// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RecentCases } from '@renderer/components/dashboard/RecentCases'
import type { Case } from '@shared/types'

const cases: Case[] = Array.from({ length: 3 }, (_, index) => ({
  id: `case-${index}`,
  name: `Investigation ${index}`,
  description: '',
  isDemo: false,
  archived: false,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z'
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('includes New Case in the four-tile entrance and does not replay on return', () => {
  vi.useFakeTimers()
  const onNewCase = vi.fn()
  const onSelectCase = vi.fn()
  // The cards read a shared Case's roster through React Query; these are local.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const element = (
    <QueryClientProvider client={client}>
      <RecentCases
        cases={cases}
        captureCounts={{ 'case-1': 2 }}
        onNewCase={onNewCase}
        onSelectCase={onSelectCase}
        onRenameCase={vi.fn()}
        onDeleteCase={vi.fn()}
      />
    </QueryClientProvider>
  )
  const first = render(element)
  const grid = first.container.querySelector('.screen-stagger')!
  expect(grid.children).toHaveLength(4)
  expect(grid.lastElementChild?.textContent).toContain('New Case')
  fireEvent.click(screen.getByText('New Case'))
  expect(onNewCase).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByText('Investigation 1'))
  expect(onSelectCase).toHaveBeenCalledWith('case-1')
  act(() => vi.advanceTimersByTime(900))
  first.unmount()
  const second = render(element)
  expect(second.container.querySelector('.screen-stagger')).toBeNull()
})
