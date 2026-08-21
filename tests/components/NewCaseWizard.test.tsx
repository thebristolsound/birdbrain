// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { NewCaseWizard } from '@renderer/components/dashboard/cases/NewCaseWizard'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn()
}))

vi.mock('@renderer/lib/queries', () => ({
  useCasesMutations: () => ({ create: { mutateAsync: vi.fn() } }),
  useSettingsMutations: () => ({ update: { mutateAsync: vi.fn() } })
}))

vi.mock('@renderer/lib/api/selectors', () => ({
  createSelector: vi.fn()
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('NewCaseWizard', () => {
  // cn() runs twMerge, so a rounded-* at the call site replaces the primitive's own.
  // The screen notes ask for a 6px description textarea only (#425 N1; rounded-xl aliases
  // to 6px via the globals.css radius collapse), which is the whole reason the two fields
  // differ — assert both halves so a sweep that "harmonises" them has to revisit the note
  // rather than silently win.
  it('rounds the name input from the primitive base and the description to rounded-xl', () => {
    render(<NewCaseWizard />)

    const name = screen.getByTestId('case-name-input')
    expect(name.className).toContain('rounded-md')
    expect(name.className).not.toMatch(/\brounded-(sm|lg|xl|2xl|full)\b/)

    const description = screen.getByTestId('case-description-input')
    expect(description.className).toContain('rounded-xl')
    expect(description.className).not.toMatch(/\brounded-md\b/)
  })

  // The V2 handoff bundle rules this field "6px, recessed fill" — bg-canvas +
  // border-border-strong — superseding the V1 note's bg-elevated (#563). Pin the fill so a
  // sweep that raises the field has to revisit the note rather than silently win.
  it('keeps the description textarea on the recessed bg-canvas fill', () => {
    render(<NewCaseWizard />)

    const description = screen.getByTestId('case-description-input')
    expect(description.className).toContain('bg-canvas')
    expect(description.className).not.toMatch(/\bbg-elevated\b/)
  })
})
