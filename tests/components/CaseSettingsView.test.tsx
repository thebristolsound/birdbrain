// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { CaseSettingsView } from '@renderer/components/sharing/CaseSettingsView'
import { fakeBridge } from '../renderer/fakeBridge'
import { CASE_ID, members, settings } from './sharingFixtures'

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<CaseSettingsView caseId={CASE_ID} />, { wrapper: Wrapper })
}

beforeEach(() => {
  fakeBridge({
    settings: { get: vi.fn(async () => settings()) },
    sharing: {
      isAvailable: vi.fn(async () => true),
      getMembers: vi.fn(async () => members({ members: [] }))
    }
  })
})

afterEach(cleanup)

// Only the Members tab ships (feasibility item 19). General and Export keep
// their current homes, so the nav draws no placeholder for them and no note
// explaining their absence.
describe('CaseSettingsView', () => {
  it('opens on Members and offers no other tab', () => {
    renderView()
    expect(screen.getByText('Case settings')).toBeTruthy()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Members'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(screen.queryByText(/First slice ships Members only/)).toBeNull()
    expect(screen.queryByText(/reads as settings/)).toBeNull()
  })

  it('renders the Members tab content', async () => {
    renderView()
    expect(await screen.findByTestId('members-tab')).toBeTruthy()
  })

  it('marks the sharing panel as early access', () => {
    renderView()
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByTestId('sharing-early-access').textContent).toBe('Early access')
  })
})
