// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const updateMutateSpy = vi.fn()

vi.mock('@renderer/lib/queries', () => ({
  useCasesMutations: () => ({ update: { mutateAsync: updateMutateSpy } })
}))

import { CaseSubhead } from '@renderer/components/overview/CaseSubhead'
import type { Case } from '@shared/types'

describe('CaseSubhead case number (#399)', () => {
  const CASE: Case = {
    id: 'case-1',
    name: 'Op Nightshade',
    description: 'desc',
    isDemo: false,
    archived: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z'
  }

  beforeEach(() => {
    updateMutateSpy.mockReset()
    updateMutateSpy.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the case number and saves an edited value', async () => {
    render(<CaseSubhead caseData={{ ...CASE, caseNumber: 'REF-1' }} />)

    expect(screen.getByText('No. REF-1')).toBeDefined()
    fireEvent.click(screen.getByTestId('case-subhead-number-btn'))
    const input = screen.getByTestId('case-subhead-number-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'CPS 2026/114' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(updateMutateSpy).toHaveBeenCalledWith({ id: 'case-1', caseNumber: 'CPS 2026/114' })
    )
  })

  it('offers to add a case number when none is set and saves nothing on an unchanged blur', async () => {
    render(<CaseSubhead caseData={CASE} />)

    expect(screen.getByText('Add case number…')).toBeDefined()
    fireEvent.click(screen.getByTestId('case-subhead-number-btn'))
    fireEvent.blur(screen.getByTestId('case-subhead-number-input'))

    await waitFor(() => expect(screen.getByTestId('case-subhead-number-btn')).toBeDefined())
    expect(updateMutateSpy).not.toHaveBeenCalled()
  })

  it('reverts on Escape without saving', () => {
    render(<CaseSubhead caseData={{ ...CASE, caseNumber: 'REF-1' }} />)

    fireEvent.click(screen.getByTestId('case-subhead-number-btn'))
    const input = screen.getByTestId('case-subhead-number-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'changed' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.getByText('No. REF-1')).toBeDefined()
    expect(updateMutateSpy).not.toHaveBeenCalled()
  })
})
