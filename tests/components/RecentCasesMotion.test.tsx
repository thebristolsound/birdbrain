// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RecentCases } from '@renderer/components/dashboard/RecentCases'
import { Sidebar } from '@renderer/components/layout/Sidebar'
import type { Case } from '@shared/types'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ caseId: 'case-1' }),
  useMatchRoute: () => () => false
}))

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
  const element = (
    <RecentCases
      cases={cases}
      captureCounts={{ 'case-1': 2 }}
      onNewCase={onNewCase}
      onSelectCase={onSelectCase}
      onRenameCase={vi.fn()}
      onDeleteCase={vi.fn()}
    />
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

it('shows each rail label on keyboard focus and hides the duplicate text from readers (#1537)', () => {
  render(<Sidebar />)
  for (const name of ['Home', 'Notes']) {
    const tooltip = screen.getByText(name).parentElement!
    expect(tooltip.getAttribute('aria-hidden')).toBe('true')
    expect(tooltip.className).toContain('group-focus-within:opacity-100')
    expect(screen.getAllByRole('button', { name })).toHaveLength(1)
  }
})

it('keeps rail navigation working with press feedback on home and section controls', () => {
  render(<Sidebar />)
  fireEvent.click(screen.getByRole('button', { name: 'Home' }))
  expect(navigate).toHaveBeenCalledWith({ to: '/' })
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }))
  expect(navigate).toHaveBeenCalledWith({
    to: '/cases/$caseId/notes',
    params: { caseId: 'case-1' }
  })
})
