// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Case, LaunchedBrowserStatus, LaunchedBrowserSummary } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'
import { StopSessionDialog } from '@renderer/components/launchedBrowser/StopSessionDialog'

const FERRY: Case = {
  id: 'case-1',
  name: 'Ferry Line',
  isDemo: false,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  archived: false
}
const SUMMARY: LaunchedBrowserSummary = {
  family: 'chrome',
  label: 'Google Chrome',
  caseId: 'case-1',
  version: '149.0.7827.55',
  extensionWarnings: [],
  sessionStartedAt: 1_000,
  tabs: []
}
const OPEN: LaunchedBrowserStatus = { state: 'open', browser: SUMMARY }

function mount(endSession: () => Promise<LaunchedBrowserStatus> = async () => ({ state: 'none' })) {
  const end = vi.fn(endSession)
  fakeBridge({
    cases: { list: vi.fn(async () => [FERRY]) },
    launchedBrowser: { status: vi.fn(async () => OPEN), endSession: end }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <StopSessionDialog />
    </QueryClientProvider>
  )
  return { client, end }
}

function openConfirm() {
  act(() => useAppStore.getState().setStopConfirmOpen(true))
}

beforeEach(() => {
  useAppStore.setState({ stopConfirmOpen: false })
})

afterEach(() => {
  cleanup()
})

describe('StopSessionDialog (1i)', () => {
  it('names the browser that will close, and the Capture Session it shares', async () => {
    mount()
    openConfirm()
    const dialog = await screen.findByRole('dialog', { name: 'Stop the Capture Session?' })
    expect(within(dialog).getByText('Launched Google Chrome will close.')).toBeTruthy()
    await waitFor(() =>
      expect(within(dialog).getByRole('img').getAttribute('title')).toBe(
        'The extension records into the same Capture Session in Ferry Line, so stopping ends ' +
          'it there too. Birdbrain deletes the throwaway browser profile.'
      )
    )
  })

  it('stops the Capture Session on confirmation and closes once it has', async () => {
    let finish: (status: LaunchedBrowserStatus) => void = () => {}
    const { end } = mount(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    openConfirm()
    const dialog = await screen.findByRole('dialog', { name: 'Stop the Capture Session?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop and close browser' }))
    expect(end).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByRole('button', { name: 'Stopping…' })).toBeTruthy()
    await act(async () => finish({ state: 'none' }))
    await waitFor(() => expect(useAppStore.getState().stopConfirmOpen).toBe(false))
  })

  it('keeps the Capture Session running when the Operator keeps it', async () => {
    const { end } = mount()
    openConfirm()
    const dialog = await screen.findByRole('dialog', { name: 'Stop the Capture Session?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep running' }))
    expect(end).not.toHaveBeenCalled()
    expect(useAppStore.getState().stopConfirmOpen).toBe(false)
  })

  it('says so, and stays, when the Capture Session could not be stopped', async () => {
    mount(async () => {
      throw new Error('gone')
    })
    openConfirm()
    const dialog = await screen.findByRole('dialog', { name: 'Stop the Capture Session?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop and close browser' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'The Capture Session could not be stopped.'
    )
    expect(useAppStore.getState().stopConfirmOpen).toBe(true)
  })

  it('closes itself when the browser is no longer open', async () => {
    const { client } = mount()
    openConfirm()
    await screen.findByRole('dialog', { name: 'Stop the Capture Session?' })
    act(() => {
      client.setQueryData(queryKeys.launchedBrowserStatus, { state: 'closed', browser: SUMMARY })
    })
    await waitFor(() => expect(useAppStore.getState().stopConfirmOpen).toBe(false))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
