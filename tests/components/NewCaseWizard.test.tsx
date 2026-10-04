// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { NewCaseWizard } from '@renderer/components/dashboard/cases/NewCaseWizard'

// Hoisted so the wizard's own module graph shares the instances the
// assertions read, and so `create` can resolve to a case with an id.
const createCase = vi.hoisted(() => vi.fn(async () => ({ id: 'case-1' })))
const createSelector = vi.hoisted(() => vi.fn())
const navigate = vi.hoisted(() => vi.fn())
const notifySuccess = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate
}))

vi.mock('@renderer/lib/notify', () => ({
  notify: { success: notifySuccess }
}))

vi.mock('@renderer/lib/queries', () => ({
  useCasesMutations: () => ({ create: { mutateAsync: createCase } }),
  useSettingsMutations: () => ({ update: { mutateAsync: vi.fn() } })
}))

vi.mock('@renderer/lib/api/selectors', () => ({
  createSelector
}))

afterEach(() => {
  cleanup()
  createSelector.mockReset()
  navigate.mockReset()
  notifySuccess.mockReset()
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

  // Presets are picked by the operator during case creation, so the selectors
  // they produce are 'manual' (#395). Without this the wizard's rows would land
  // with no origin and read as legacy, which is the hole the column exists to
  // close.
  it('stamps preset selectors as added by hand', async () => {
    render(<NewCaseWizard />)

    fireEvent.change(screen.getByTestId('case-name-input'), { target: { value: 'Case' } })
    fireEvent.click(screen.getByText('Email Addresses'))
    fireEvent.click(screen.getByTestId('case-create-btn'))

    await waitFor(() => expect(createSelector).toHaveBeenCalledOnce())
    expect(createSelector).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'case-1', label: 'Email Addresses', origin: 'manual' })
    )
  })

  it('labels both fields and exposes which preset chips are chosen (#1537)', () => {
    render(<NewCaseWizard />)

    expect(screen.getByLabelText('Case Name')).toBe(screen.getByTestId('case-name-input'))
    expect(screen.getByLabelText('Description')).toBe(screen.getByTestId('case-description-input'))

    const group = screen.getByRole('group', { name: 'Initial Selectors' })
    const chip = within(group).getByRole('button', { name: 'Email Addresses' })
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(chip)
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  // The mock's post-create confirmation (Birdbrain.dc.html 5872): the case name
  // and how many selectors the wizard armed, pluralised the same way.
  it('confirms the new case and its armed selector count in a toast', async () => {
    render(<NewCaseWizard />)

    fireEvent.change(screen.getByTestId('case-name-input'), { target: { value: '  Nightjar ' } })
    fireEvent.click(screen.getByText('Email Addresses'))
    fireEvent.click(screen.getByText('IP Addresses'))
    fireEvent.click(screen.getByTestId('case-create-btn'))

    await waitFor(() => expect(notifySuccess).toHaveBeenCalledOnce())
    expect(notifySuccess).toHaveBeenCalledWith('Case created', {
      description: '“Nightjar” is ready — 2 selectors armed.'
    })
    expect(navigate).toHaveBeenCalledWith({ to: '/cases/$caseId', params: { caseId: 'case-1' } })
  })

  it('uses the singular for one armed selector', async () => {
    render(<NewCaseWizard />)

    fireEvent.change(screen.getByTestId('case-name-input'), { target: { value: 'Nightjar' } })
    fireEvent.click(screen.getByText('Usernames'))
    fireEvent.click(screen.getByTestId('case-create-btn'))

    await waitFor(() => expect(notifySuccess).toHaveBeenCalledOnce())
    expect(notifySuccess.mock.calls[0][1].description).toBe(
      '“Nightjar” is ready — 1 selector armed.'
    )
  })
})
