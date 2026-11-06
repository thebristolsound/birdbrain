// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
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

function renderView(props: Parameters<typeof SettingsView>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<SettingsView {...props} />, { wrapper: Wrapper })
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

// The VPN warning's "Set up a proxy" opens Settings on the Egress setting (ADR-0032).
describe('SettingsView on the Egress section', () => {
  beforeEach(() => {
    const egressSettings = { ...settings, tsaUrl: '', egress: { kind: 'direct' } }
    fakeBridge({
      settings: {
        get: vi.fn(async () => egressSettings),
        update: vi.fn(async () => egressSettings),
        getIdentity: vi.fn(async () => ({
          operatorName: 'Operator One',
          operatorRole: '',
          operatorOrganization: ''
        }))
      }
    })
  })

  it('opens the Network tab and focuses the chosen Egress, then reports it shown', async () => {
    const onSectionShown = vi.fn()
    renderView({ section: 'egress', onSectionShown })
    const group = await screen.findByRole('radiogroup', { name: 'Egress' })
    const direct = group.querySelector<HTMLInputElement>('input[value="direct"]')!
    await waitFor(() => expect(document.activeElement).toBe(direct))
    expect(onSectionShown).toHaveBeenCalledOnce()
  })

  // The launch start dialog's "Set operator name" opens Settings on the operator name.
  it('opens the Operator tab and focuses the operator name, then reports it shown', async () => {
    const onSectionShown = vi.fn()
    renderView({ section: 'operator', onSectionShown })
    const name = await screen.findByLabelText(/Operator Name/)
    await waitFor(() => expect(document.activeElement).toBe(name))
    expect(screen.getByRole('tab', { name: 'Operator', selected: true })).toBeDefined()
    expect(screen.queryByRole('radiogroup', { name: 'Egress' })).toBeNull()
    expect(onSectionShown).toHaveBeenCalledOnce()
  })

  it('switches to the tab of a section asked for after it opened', async () => {
    const view = renderView()
    expect(await screen.findByRole('tab', { name: 'Capture', selected: true })).toBeDefined()
    view.rerender(<SettingsView section="egress" />)
    expect(await screen.findByRole('tab', { name: 'Network', selected: true })).toBeDefined()
  })
})
