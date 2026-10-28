// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CaseCard } from '@renderer/components/dashboard/CaseCard'
import type { Case } from '@shared/types'
import { fakeBridge } from '../renderer/fakeBridge'
import { members } from './sharingFixtures'

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

function renderCard(data: Case = caseData) {
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
        onDelete={vi.fn()}
      />
    </QueryClientProvider>
  )
}

afterEach(() => cleanup())

it('names the kebab, exposes the menu state and closes on Escape back to the trigger', () => {
  renderCard()
  const trigger = screen.getByRole('button', { name: 'Actions for Investigation One' })
  // Visible while focused or open, not only on hover (#1537).
  expect(trigger.className).toContain('focus-visible:opacity-100')
  expect(trigger.className).toContain('aria-expanded:opacity-100')
  expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
  expect(trigger.getAttribute('aria-expanded')).toBe('false')

  fireEvent.click(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  const menu = screen.getByRole('menu', { name: 'Actions for Investigation One' })
  const [rename, members, remove] = screen.getAllByRole('menuitem')
  expect(document.activeElement).toBe(rename)

  fireEvent.keyDown(menu, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(members)
  fireEvent.keyDown(menu, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(remove)
  fireEvent.keyDown(menu, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(rename)
  fireEvent.keyDown(menu, { key: 'ArrowUp' })
  expect(document.activeElement).toBe(remove)
  fireEvent.keyDown(menu, { key: 'Home' })
  expect(document.activeElement).toBe(rename)
  fireEvent.keyDown(menu, { key: 'End' })
  expect(document.activeElement).toBe(remove)
  fireEvent.keyDown(menu, { key: 'a' })
  expect(document.activeElement).toBe(remove)

  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('ignores keys other than Escape while the menu is open', () => {
  renderCard()
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Investigation One' }))
  fireEvent.keyDown(document, { key: 'Enter' })
  expect(screen.getByRole('menu')).toBeTruthy()
})

it('lands on Cancel when Delete is chosen, so a second Enter cannot delete, and Tab closes', () => {
  renderCard()
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Investigation One' }))
  fireEvent.click(screen.getByTestId('case-card-delete-btn'))
  const [confirm, cancel] = screen.getAllByRole('menuitem')
  expect(confirm).toBe(screen.getByTestId('case-card-delete-confirm-btn'))
  expect(document.activeElement).toBe(cancel)
  // Confirm and Cancel stay inside the menu model.
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' })
  expect(document.activeElement).toBe(confirm)

  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' })
  expect(screen.queryByRole('menu')).toBeNull()
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
