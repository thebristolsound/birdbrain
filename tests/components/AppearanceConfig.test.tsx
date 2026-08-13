// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AppearanceConfig } from '@renderer/components/settings/AppearanceConfig'
import { fakeBridge } from '../renderer/fakeBridge'

function renderConfig() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<AppearanceConfig />, { wrapper: Wrapper })
}

describe('AppearanceConfig density control', () => {
  let update: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.density
    update = vi.fn(async () => ({}))
    fakeBridge({ settings: { update } })
  })

  afterEach(cleanup)

  it('starts on compact when nothing is stored', () => {
    renderConfig()
    expect(screen.getByTestId('density-compact').getAttribute('aria-pressed')).toBe('true')
    expect(document.documentElement.dataset.density).toBe('compact')
  })

  it('reflects the stored step on mount', () => {
    localStorage.setItem('density', 'comfortable')
    renderConfig()
    expect(screen.getByTestId('density-comfortable').getAttribute('aria-pressed')).toBe('true')
    expect(document.documentElement.dataset.density).toBe('comfortable')
  })

  // A hand-edited or downgraded localStorage value must not put <html> into a
  // density step that globals.css does not declare.
  it('falls back to compact when the stored step is unrecognised', () => {
    localStorage.setItem('density', 'cosy')
    renderConfig()
    expect(screen.getByTestId('density-compact').getAttribute('aria-pressed')).toBe('true')
    expect(document.documentElement.dataset.density).toBe('compact')
  })

  it('applies a new step to <html>, localStorage, and the settings file', async () => {
    renderConfig()
    fireEvent.click(screen.getByTestId('density-comfortable'))

    expect(document.documentElement.dataset.density).toBe('comfortable')
    expect(localStorage.getItem('density')).toBe('comfortable')
    await waitFor(() => expect(update).toHaveBeenCalledWith({ density: 'comfortable' }))
  })

  it('does not re-persist the step already selected', () => {
    renderConfig()
    fireEvent.click(screen.getByTestId('density-compact'))
    expect(update).not.toHaveBeenCalled()
  })

  it('offers all three steps', () => {
    renderConfig()
    for (const step of ['compact', 'default', 'comfortable']) {
      expect(screen.getByTestId(`density-${step}`)).toBeTruthy()
    }
  })
})
