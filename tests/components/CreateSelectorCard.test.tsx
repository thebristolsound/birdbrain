// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { CreateSelectorCard } from '@renderer/components/selectors/CreateSelectorCard'
import { fakeBridge } from '../renderer/fakeBridge'

function renderCard() {
  const onCreated = vi.fn()
  render(<CreateSelectorCard isOpen onToggle={vi.fn()} onCreated={onCreated} caseId="case-1" />)
  return { onCreated }
}

function typePattern(value: string) {
  fireEvent.change(screen.getByPlaceholderText('e.g. John Doe'), { target: { value } })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CreateSelectorCard', () => {
  it('creates the selector and notifies its owner', async () => {
    const create = vi.fn(async () => ({ id: 's1' }))
    fakeBridge({ selectors: { create } })
    const { onCreated } = renderCard()

    typePattern('  acme  ')
    fireEvent.click(screen.getByText('Create'))

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce())
    // Trimmed pattern, and an empty label sent as undefined rather than ''.
    expect(create).toHaveBeenCalledWith({
      caseId: 'case-1',
      pattern: 'acme',
      isRegex: false,
      label: undefined,
      // Typed into the Selectors screen by hand, so 'manual' (#395).
      origin: 'manual'
    })
  })

  it('keeps the typed pattern when the create fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeBridge({ selectors: { create: vi.fn(async () => Promise.reject(new Error('nope'))) } })
    const { onCreated } = renderCard()

    typePattern('acme')
    fireEvent.click(screen.getByText('Create'))

    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(onCreated).not.toHaveBeenCalled()
    expect((screen.getByPlaceholderText('e.g. John Doe') as HTMLInputElement).value).toBe('acme')
  })

  it('refuses to create an invalid regex', async () => {
    const create = vi.fn(async () => ({ id: 's1' }))
    fakeBridge({ selectors: { create } })
    renderCard()

    fireEvent.click(screen.getByText('.*'))
    const input = screen.getByPlaceholderText('e.g. \\b\\d{3}-\\d{3}-\\d{4}\\b')
    fireEvent.change(input, { target: { value: '([' } })

    expect(screen.getByText(/Invalid regular expression/)).toBeDefined()
    expect((screen.getByText('Create').closest('button') as HTMLButtonElement).disabled).toBe(true)

    // Enter bypasses the disabled Create button and reaches handleCreate
    // directly, so this is what pins the guard inside it rather than the
    // button's disabled attribute.
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getByText(/Invalid regular expression/)).toBeDefined())
    expect(create).not.toHaveBeenCalled()
  })
})
