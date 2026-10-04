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

function renderCard() {
  return render(
    <CaseCard
      caseData={caseData}
      isRecording={false}
      isActive={false}
      captureCount={0}
      onClick={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
    />
  )
}

afterEach(() => cleanup())

it('names the kebab, exposes the menu state and closes on Escape back to the trigger', () => {
  renderCard()
  const trigger = screen.getByRole('button', { name: 'Actions for Investigation One' })
  expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
  // Hidden until hover, so keyboard focus has to reveal it as well.
  expect(trigger.className).toContain('focus-visible:opacity-100')
  expect(trigger.getAttribute('aria-expanded')).toBe('false')

  fireEvent.click(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  const menu = screen.getByRole('menu', { name: 'Actions for Investigation One' })
  const [rename, remove] = screen.getAllByRole('menuitem')
  expect(document.activeElement).toBe(rename)

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

it('moves focus to the confirmation when Delete is chosen, and Tab closes the menu', () => {
  renderCard()
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Investigation One' }))
  fireEvent.click(screen.getByTestId('case-card-delete-btn'))
  const confirm = screen.getByTestId('case-card-delete-confirm-btn')
  expect(document.activeElement).toBe(confirm)
  // Confirm and Cancel stay inside the menu model.
  const items = screen.getAllByRole('menuitem')
  expect(items.length).toBe(2)
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
  expect(document.activeElement).toBe(items[1])

  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' })
  expect(screen.queryByRole('menu')).toBeNull()
})
