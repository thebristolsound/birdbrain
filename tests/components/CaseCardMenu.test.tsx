// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CaseCard } from '@renderer/components/dashboard/CaseCard'
import type { Case } from '@shared/types'

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

function renderCard() {
  return render(
    <CaseCard
      caseData={caseData}
      isRecording={false}
      isActive={false}
      captureCount={0}
      onClick={openCase}
      onRename={vi.fn()}
      onDelete={vi.fn()}
    />
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

// The Case's way into Case settings → Members (#1514), shared or not, since the
// top-bar sync pill only shows once a member has joined.
it('opens Members for this Case and closes the menu', () => {
  navigate.mockClear()
  openCase.mockClear()
  renderCard()
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Investigation One' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Members' }))
  expect(navigate).toHaveBeenCalledWith({
    to: '/cases/$caseId/settings',
    params: { caseId: 'case-1' }
  })
  expect(screen.queryByRole('menu')).toBeNull()
  // The card itself opens the Case; the menu item must not reach it.
  expect(openCase).not.toHaveBeenCalled()
})
