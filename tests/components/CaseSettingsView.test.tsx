// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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

// Only the Members tab ships in this slice (feasibility item 19): General and
// Export are drawn so the screen reads as settings, and cannot be opened.
describe('CaseSettingsView', () => {
  it('offers General and Export as disabled placeholders and opens on Members', () => {
    renderView()
    expect(screen.getByText('Case settings')).toBeTruthy()
    const general = screen.getByRole('tab', { name: 'General' })
    const exportTab = screen.getByRole('tab', { name: 'Export' })
    const membersTab = screen.getByRole('tab', { name: 'Members' })
    expect(general.hasAttribute('disabled')).toBe(true)
    expect(exportTab.hasAttribute('disabled')).toBe(true)
    expect(membersTab.hasAttribute('disabled')).toBe(false)
    expect(membersTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  })

  it('carries the nav footnote verbatim', () => {
    renderView()
    expect(
      screen.getByText(
        'First slice ships Members only. General and Export keep their current homes; the tabs ' +
          'are here so the screen reads as settings.'
      )
    ).toBeTruthy()
  })

  it('renders the Members tab content', async () => {
    renderView()
    expect(await screen.findByTestId('members-tab')).toBeTruthy()
  })
})
