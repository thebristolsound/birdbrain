// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OlderCases } from '@renderer/components/dashboard/OlderCases'
import type { Case } from '@shared/types'
import { fakeBridge } from '../renderer/fakeBridge'
import { members } from './sharingFixtures'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

function makeCase(index: number, extra: Partial<Case> = {}): Case {
  return {
    id: `case-${index}`,
    name: `Investigation ${index}`,
    description: '',
    isDemo: false,
    archived: false,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...extra
  }
}

// Five Cases by recency: three for the grid, two for the list, the last shared.
const CASES = [
  makeCase(0),
  makeCase(1),
  makeCase(2),
  makeCase(3, { type: 'crypto' }),
  makeCase(4, { sharedAt: '2026-09-19T14:00:00.000Z' })
]

const handlers = {
  onSelectCase: vi.fn(),
  onRenameCase: vi.fn(),
  onDeleteCase: vi.fn()
}

function renderList(cases: Case[]) {
  fakeBridge({ sharing: { getMembers: vi.fn(async () => members()) } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <OlderCases cases={cases} captureCounts={{ 'case-3': 9 }} {...handlers} />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  navigate.mockClear()
  for (const handler of Object.values(handlers)) handler.mockClear()
})

// Frame E of docs/design-handoff/2026-10-28-share-a-case/: every Case after
// the three cards, with the card's own menu.
describe('the Older Cases list', () => {
  it('is absent with three Cases or fewer', () => {
    renderList(CASES.slice(0, 3))
    expect(screen.queryByTestId('older-cases')).toBeNull()
  })

  it('lists every Case after the three most recent, with captures and sharing', async () => {
    renderList(CASES)
    expect(screen.getByText('Older Cases · 2')).toBeTruthy()
    const rows = screen.getAllByTestId('older-case-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Investigation 3')).toBeTruthy()
    expect(within(rows[0]).getByText('9')).toBeTruthy()
    expect(within(rows[0]).getByTestId('older-case-share').textContent).toBe('Share this Case…')
    expect(within(rows[0]).queryByTestId('case-role-line')).toBeNull()
    expect(rows[0].querySelector('.bg-orange-500')).toBeTruthy()
    const sharedLine = await within(rows[1]).findByTestId('case-role-line')
    expect(sharedLine.textContent).toBe('ARYou own · 4 members')
  })

  it('opens the Case from the row and the card’s menu from an always-visible kebab', () => {
    renderList(CASES)
    const [row] = screen.getAllByTestId('older-case-row')
    fireEvent.click(row)
    expect(handlers.onSelectCase).toHaveBeenCalledWith('case-3')

    const trigger = within(row).getByRole('button', { name: 'Actions for Investigation 3' })
    expect(trigger.className).not.toContain('opacity-0')
    fireEvent.click(trigger)
    const items = within(row)
      .getAllByRole('menuitem')
      .map((item) => item.textContent)
    expect(items).toEqual(['Rename', 'Share this Case…', 'Delete'])
    fireEvent.click(within(row).getByRole('menuitem', { name: 'Share this Case…' }))
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/settings',
      params: { caseId: 'case-3' }
    })
    expect(within(row).queryByRole('menu')).toBeNull()
    // The menu item never reaches the row's own click.
    expect(handlers.onSelectCase).toHaveBeenCalledTimes(1)
  })

  it('opens Members, not the Case, from a local Case’s Sharing cell', () => {
    renderList(CASES)
    const [row, sharedRow] = screen.getAllByTestId('older-case-row')
    fireEvent.click(within(row).getByTestId('older-case-share'))
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/settings',
      params: { caseId: 'case-3' }
    })
    expect(handlers.onSelectCase).not.toHaveBeenCalled()
    expect(within(sharedRow).queryByTestId('older-case-share')).toBeNull()
  })

  it('reads Members on a shared Case', () => {
    renderList(CASES)
    const [, row] = screen.getAllByTestId('older-case-row')
    fireEvent.click(within(row).getByRole('button', { name: 'Actions for Investigation 4' }))
    expect(within(row).getByRole('menuitem', { name: 'Members' })).toBeTruthy()
  })

  it('renames inline from the menu', () => {
    renderList(CASES)
    const [row] = screen.getAllByTestId('older-case-row')
    fireEvent.click(within(row).getByRole('button', { name: 'Actions for Investigation 3' }))
    fireEvent.click(within(row).getByRole('menuitem', { name: 'Rename' }))
    const input = within(row).getByTestId('case-rename-input') as HTMLInputElement
    expect(input.value).toBe('Investigation 3')
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(handlers.onRenameCase).toHaveBeenCalledWith('case-3', 'Renamed')
    expect(within(row).queryByTestId('case-rename-input')).toBeNull()
  })

  it('deletes behind the same confirmation as the card', () => {
    renderList(CASES)
    const [row] = screen.getAllByTestId('older-case-row')
    fireEvent.click(within(row).getByRole('button', { name: 'Actions for Investigation 3' }))
    fireEvent.click(within(row).getByTestId('case-card-delete-btn'))
    fireEvent.click(within(row).getByTestId('case-card-delete-confirm-btn'))
    expect(handlers.onDeleteCase).toHaveBeenCalledWith('case-3')
  })
})
