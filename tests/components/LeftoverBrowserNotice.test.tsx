// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { LaunchedBrowserLeftover } from '@shared/types'
import { LeftoverBrowserNotice } from '@renderer/components/launchedBrowser/LeftoverBrowserNotice'
import { fakeBridge } from '../renderer/fakeBridge'

const THROWAWAY: LaunchedBrowserLeftover = { label: 'Google Chrome', profile: 'session' }

function mount(checkLeftovers: () => Promise<LaunchedBrowserLeftover[]>) {
  fakeBridge({ launchedBrowser: { checkLeftovers } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <LeftoverBrowserNotice />
    </QueryClientProvider>
  )
}

afterEach(cleanup)

// State 13, raised at startup (spec failure table; the revision assessment's state 13).
describe('LeftoverBrowserNotice', () => {
  it('shows nothing when no browser is left from an earlier run', async () => {
    const checkLeftovers = vi.fn(async () => [])
    mount(checkLeftovers)
    await waitFor(() => expect(checkLeftovers).toHaveBeenCalledOnce())
    expect(screen.queryByText(/still open/)).toBeNull()
  })

  it('names a throwaway profile and says what to do, without refusing a launch', async () => {
    mount(async () => [THROWAWAY])
    const notice = await screen.findByRole('status')
    expect(notice.textContent).toContain('An old launched browser is still open')
    expect(notice.textContent).toContain(
      'Google Chrome on a throwaway browser profile. Close that browser, then select Check again.'
    )
    expect(
      screen.getByRole('img', {
        name:
          'Google Chrome on a throwaway browser profile, from an earlier run of Birdbrain. ' +
          'Birdbrain cannot reconnect to it and is not recording it.'
      })
    ).toBeDefined()
    expect(notice.textContent).not.toMatch(/launch a new one|refus/i)
  })

  it("names a Persona's profile", async () => {
    mount(async () => [{ label: 'Brave', profile: 'persona' }])
    const notice = await screen.findByRole('status')
    expect(notice.textContent).toContain(
      "Brave on a Persona's browser profile. Close that browser, then select Check again."
    )
  })

  it('counts more than one', async () => {
    mount(async () => [THROWAWAY, { label: 'Chromium', profile: 'session' }])
    const notice = await screen.findByRole('status')
    expect(notice.textContent).toContain('2 old launched browsers are still open')
    expect(notice.textContent).toContain('Chromium on a throwaway browser profile.')
  })

  it('checks again and goes once the browser has closed', async () => {
    const checkLeftovers = vi.fn().mockResolvedValueOnce([THROWAWAY]).mockResolvedValue([])
    mount(checkLeftovers)
    await screen.findByRole('status')
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(checkLeftovers).toHaveBeenCalledTimes(2)
  })

  it('stays while the browser is still open', async () => {
    const checkLeftovers = vi.fn(async () => [THROWAWAY])
    mount(checkLeftovers)
    await screen.findByRole('status')
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(checkLeftovers).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('status')).toBeDefined()
  })

  it('hides on Dismiss without checking again', async () => {
    const checkLeftovers = vi.fn(async () => [THROWAWAY])
    mount(checkLeftovers)
    await screen.findByRole('status')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(checkLeftovers).toHaveBeenCalledOnce()
  })
})
