// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { BirdbrainSettings } from '@shared/types'
import { SettingsView } from '@renderer/components/settings/SettingsView'
import { fakeBridge } from '../renderer/fakeBridge'

// Asserted, not annotated: the default Capture pane reads two fields.
const settings = {
  captureScreenshots: true,
  ignoredUrlPatterns: []
} as unknown as BirdbrainSettings

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<SettingsView />, { wrapper: Wrapper })
}

beforeEach(() => {
  fakeBridge({
    settings: { get: vi.fn(async () => settings), update: vi.fn(async () => settings) }
  })
})

afterEach(cleanup)

// The Appearance helper says density scales Settings; before #1540 only the
// route wrapper did, so every pane measured the same on every step.
describe('SettingsView density', () => {
  it('pads the content pane from the density pad step', async () => {
    renderView()
    const panel = await screen.findByRole('tabpanel')
    const pane = panel.parentElement!
    expect(pane.className).toContain('p-[var(--d-pad)]')
    expect(pane.className).not.toContain('p-6')
  })

  it('pads the open card from the density card step', async () => {
    renderView()
    const panel = await screen.findByRole('tabpanel')
    const content = panel.querySelector('.neu-card > div')!
    expect(content.className).toContain('p-[var(--d-card)]')
    expect(content.className).not.toContain('p-5')
  })
})
