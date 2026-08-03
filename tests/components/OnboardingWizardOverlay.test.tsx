// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const navigateSpy = vi.fn()
const createMutateSpy = vi.fn()
const settingsUpdateSpy = vi.fn().mockResolvedValue(undefined)

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy
}))

vi.mock('@renderer/lib/queries', () => ({
  useCasesMutations: () => ({
    create: { mutateAsync: createMutateSpy }
  })
}))

vi.mock('@renderer/assets/logo.png', () => ({ default: 'logo.png' }))

import { OnboardingWizard } from '@renderer/components/layout/OnboardingWizard'
import { fakeBridge } from '../renderer/fakeBridge'

function withClient(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('OnboardingWizard overlay mode', () => {
  let onClose: ReturnType<typeof vi.fn>
  let client: QueryClient

  beforeEach(() => {
    navigateSpy.mockClear()
    createMutateSpy.mockClear()
    settingsUpdateSpy.mockClear()
    onClose = vi.fn()
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    fakeBridge({ settings: { update: settingsUpdateSpy } })
  })

  afterEach(() => {
    cleanup()
  })

  function renderOverlay() {
    return render(<OnboardingWizard mode="overlay" onClose={onClose} />, {
      wrapper: withClient(client)
    })
  }

  it('renders an overlay with a close button', () => {
    renderOverlay()
    expect(screen.getByTestId('onboarding-wizard').getAttribute('data-mode')).toBe('overlay')
    expect(screen.getByTestId('onboarding-overlay-close')).toBeDefined()
  })

  it('calls onClose when X button clicked', () => {
    renderOverlay()
    fireEvent.click(screen.getByTestId('onboarding-overlay-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose (not navigate) when continue button clicked', () => {
    renderOverlay()
    fireEvent.click(screen.getByTestId('onboarding-skip-btn'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(navigateSpy).not.toHaveBeenCalled()
    expect(createMutateSpy).not.toHaveBeenCalled()
    expect(settingsUpdateSpy).not.toHaveBeenCalled()
  })

  it('exposes dialog semantics for assistive tech', () => {
    renderOverlay()
    const root = screen.getByTestId('onboarding-wizard')
    expect(root.getAttribute('role')).toBe('dialog')
    expect(root.getAttribute('aria-modal')).toBe('true')
    const labelledBy = root.getAttribute('aria-labelledby')
    expect(labelledBy).toBe('onboarding-overlay-title')
    expect(document.getElementById(labelledBy!)).not.toBeNull()
  })

  it('calls onClose when Escape is pressed', () => {
    renderOverlay()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when backdrop is clicked', () => {
    renderOverlay()
    fireEvent.click(screen.getByTestId('onboarding-wizard'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
