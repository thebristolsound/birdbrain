// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CaseCard } from '@renderer/components/dashboard/CaseCard'
import type { Case } from '@shared/types'
import { fakeBridge } from '../renderer/fakeBridge'
import { members } from './sharingFixtures'
import { nextTurn, press } from './menuKeys'

const caseData: Case = {
  id: 'case-1',
  name: 'Investigation One',
  description: '',
  isDemo: false,
  archived: false,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z'
}

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

const openCase = vi.fn()

function renderCard(data: Case = caseData, onDelete: (id: string) => void = vi.fn()) {
  fakeBridge({ sharing: { getMembers: vi.fn(async () => members()) } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CaseCard
        caseData={data}
        isRecording={false}
        isActive={false}
        captureCount={0}
        onClick={openCase}
        onRename={vi.fn()}
        onDelete={onDelete}
      />
    </QueryClientProvider>
  )
}

afterEach(() => cleanup())

it('names the kebab, exposes the menu state and closes on Escape back to the trigger', async () => {
  openCase.mockClear()
  renderCard()
  const trigger = screen.getByRole('button', { name: 'Actions for Investigation One' })
  // Visible while focused or open, not only on hover (#1537).
  expect(trigger.className).toContain('focus-visible:opacity-100')
  expect(trigger.className).toContain('aria-expanded:opacity-100')
  expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
  expect(trigger.getAttribute('aria-expanded')).toBe('false')

  trigger.focus()
  await press('Enter')
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('menu', { name: 'Actions for Investigation One' })).toBeTruthy()
  const [rename, members, remove] = screen.getAllByRole('menuitem')
  await waitFor(() => expect(document.activeElement).toBe(rename))

  await press('ArrowDown', members)
  await press('ArrowDown', remove)
  await press('ArrowDown', rename)
  await press('ArrowUp', remove)
  await press('Home', rename)
  await press('End', remove)
  await press('a')
  await nextTurn()
  expect(document.activeElement).toBe(remove)

  await press('Escape')
  expect(screen.queryByRole('menu')).toBeNull()
  await waitFor(() => expect(document.activeElement).toBe(trigger))
  // The card under the menu opens the Case on a key or a click; none of these reached it.
  expect(openCase).not.toHaveBeenCalled()
})

it('ignores keys other than Escape while the menu is open', () => {
  renderCard()
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Investigation One' }))
  fireEvent.keyDown(document, { key: 'Enter' })
  expect(screen.getByRole('menu')).toBeTruthy()
})

it('lands on Cancel when Delete is chosen, so a second Enter cannot delete, and Tab closes', async () => {
  const onDelete = vi.fn()
  renderCard(caseData, onDelete)
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Investigation One' }))
  fireEvent.click(screen.getByTestId('case-card-delete-btn'))
  // Delete keeps the menu open and swaps its items.
  expect(screen.getByRole('menu')).toBeTruthy()
  const [confirm, cancel] = screen.getAllByRole('menuitem')
  expect(confirm).toBe(screen.getByTestId('case-card-delete-confirm-btn'))
  expect(document.activeElement).toBe(cancel)
  // Confirm and Cancel stay inside the menu model.
  await press('ArrowUp', confirm)

  await press('Tab')
  expect(screen.queryByRole('menu')).toBeNull()
  expect(onDelete).not.toHaveBeenCalled()
})

it('deletes on Confirm, and closes the menu', () => {
  const onDelete = vi.fn()
  openCase.mockClear()
  renderCard(caseData, onDelete)
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Investigation One' }))
  fireEvent.click(screen.getByTestId('case-card-delete-btn'))
  fireEvent.click(screen.getByTestId('case-card-delete-confirm-btn'))
  expect(onDelete).toHaveBeenCalledWith('case-1')
  expect(screen.queryByRole('menu')).toBeNull()
  expect(openCase).not.toHaveBeenCalled()
})

it('opens on the items again after a confirmation left open was closed', () => {
  renderCard()
  const trigger = screen.getByRole('button', { name: 'Actions for Investigation One' })
  fireEvent.click(trigger)
  fireEvent.click(screen.getByTestId('case-card-delete-btn'))
  fireEvent.click(trigger)
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.click(trigger)
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
    'Rename',
    'Share this Case…',
    'Delete'
  ])
})

// The Case's way into Case settings → Members (#1514): offered as sharing until
// the Case is shared (docs/design-handoff/2026-10-28-share-a-case/, frame E).
it('offers Share this Case… for a local Case, opening Members, and closes the menu', () => {
  navigate.mockClear()
  openCase.mockClear()
  renderCard()
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Investigation One' }))
  expect(screen.queryByRole('menuitem', { name: 'Members' })).toBeNull()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Share this Case…' }))
  expect(navigate).toHaveBeenCalledWith({
    to: '/cases/$caseId/settings',
    params: { caseId: 'case-1' }
  })
  expect(screen.queryByRole('menu')).toBeNull()
  // The card itself opens the Case; the menu item must not reach it.
  expect(openCase).not.toHaveBeenCalled()
})

it('reads Members once the Case is shared', () => {
  renderCard({ ...caseData, sharedAt: '2026-09-19T14:00:00.000Z' })
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Investigation One' }))
  expect(screen.getByRole('menuitem', { name: 'Members' })).toBeTruthy()
  expect(screen.queryByRole('menuitem', { name: 'Share this Case…' })).toBeNull()
})

it('starts a rename on the card and closes the menu', () => {
  renderCard()
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Investigation One' }))
  fireEvent.click(screen.getByTestId('case-card-rename-btn'))
  expect(screen.queryByRole('menu')).toBeNull()
  expect((screen.getByTestId('case-rename-input') as HTMLInputElement).value).toBe(
    'Investigation One'
  )
})

it('closes when a press lands outside it, and stays open for a press inside', async () => {
  renderCard()
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Investigation One' }))
  // Radix starts listening for a press outside on the turn after the menu opens.
  await nextTurn()
  act(() => {
    fireEvent.pointerDown(screen.getByRole('menu'))
  })
  expect(screen.getByRole('menu')).toBeTruthy()
  act(() => {
    fireEvent.pointerDown(document.body)
  })
  expect(screen.queryByRole('menu')).toBeNull()
})

it('returns from the delete confirmation to the items on Cancel, deleting nothing', () => {
  const onDelete = vi.fn()
  renderCard(caseData, onDelete)
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Investigation One' }))
  fireEvent.click(screen.getByTestId('case-card-delete-btn'))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel' }))
  const items = screen.getAllByRole('menuitem')
  expect(items.map((item) => item.textContent)).toEqual(['Rename', 'Share this Case…', 'Delete'])
  // Cancel is gone, so focus goes to the first item, not out of the menu.
  expect(document.activeElement).toBe(items[0])
  expect(onDelete).not.toHaveBeenCalled()
})
