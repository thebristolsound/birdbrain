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
  expect(trigger.getAttribute('aria-expanded')).toBe('false')

  fireEvent.click(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  const menu = screen.getByRole('menu', { name: 'Actions for Investigation One' })
  expect(menu.querySelectorAll('[role="menuitem"]').length).toBe(2)

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
