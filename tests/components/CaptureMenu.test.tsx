// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Capture } from '@shared/types'
import { CaptureMenu } from '@renderer/components/captures/CaptureMenu'
import { settleVpnWarning, useVpnWarningStore } from '@renderer/lib/vpnWarning'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'
import { isDisabledItem, press } from './menuKeys'

const capture: Capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/evidence',
  title: 'Example',
  hash: 'h',
  timestamp: '2026-08-01T12:00:00.000Z',
  createdAt: '2026-08-01T12:00:01.000Z',
  format: 'mhtml',
  method: 'extension'
}

function recaptureItem(): HTMLElement {
  return screen.getByTestId('recapture-btn')
}

function renderMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CaptureMenu caseId="case1" />
    </QueryClientProvider>
  )
  return screen.getByTestId('capture-menu-btn')
}

beforeEach(() => {
  useVpnWarningStore.setState({ open: false, request: null, settle: null })
  useAppStore.setState({ selectedCaptureId: capture.id, captureEvents: [] })
})

afterEach(() => {
  cleanup()
})

describe('CaptureMenu Recapture at the VPN warning', () => {
  it('shows no Recapture error when the Operator stops at the warning', async () => {
    const enqueue = vi.fn(async () => ({ accepted: 1, rejected: [] }))
    fakeBridge({
      captures: { list: vi.fn(async () => [capture]) },
      recapture: { enqueue },
      egress: {
        checkVpnWarning: vi.fn(async () => ({ caseId: 'case1', warn: true, canMute: true }))
      }
    })
    const trigger = renderMenu()
    fireEvent.click(trigger)
    // Enabled once the captures list has named the selected Capture.
    await waitFor(() => expect(isDisabledItem(recaptureItem())).toBe(false))
    fireEvent.click(recaptureItem())
    await waitFor(() => expect(useVpnWarningStore.getState().open).toBe(true))
    act(() => settleVpnWarning('dismiss'))

    // Enabled again once the stopped Recapture has settled.
    fireEvent.click(trigger)
    await waitFor(() => expect(isDisabledItem(recaptureItem())).toBe(false))
    expect(enqueue).not.toHaveBeenCalled()
    expect(screen.queryByTestId('recapture-error')).toBeNull()
  })
})

describe('CaptureMenu as a menu', () => {
  beforeEach(() => {
    fakeBridge({
      captures: { list: vi.fn(async () => [capture]) },
      recapture: { enqueue: vi.fn(async () => ({ accepted: 1, rejected: [] })) }
    })
  })

  it('walks its items with the arrow keys, Home and End', async () => {
    const trigger = renderMenu()
    trigger.focus()
    await press('ArrowDown')
    const paste = screen.getByTestId('capture-menu-paste-urls')
    await waitFor(() => expect(isDisabledItem(recaptureItem())).toBe(false))
    await waitFor(() => expect(document.activeElement).toBe(paste))

    await press('ArrowDown', recaptureItem())
    await press('ArrowDown', paste)
    await press('End', recaptureItem())
    await press('Home', paste)
  })

  it('closes on Escape and returns focus to the add button', async () => {
    const trigger = renderMenu()
    fireEvent.click(trigger)
    await screen.findByRole('menu')
    await press('Escape')
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('skips Recapture while no Capture is selected, and a click on it does nothing', async () => {
    useAppStore.setState({ selectedCaptureId: null })
    const enqueue = vi.fn(async () => ({ accepted: 1, rejected: [] }))
    fakeBridge({ captures: { list: vi.fn(async () => [capture]) }, recapture: { enqueue } })
    const trigger = renderMenu()
    fireEvent.click(trigger)
    expect(isDisabledItem(recaptureItem())).toBe(true)
    expect(recaptureItem().getAttribute('title')).toBe('Select a capture first')

    fireEvent.click(recaptureItem())
    expect(enqueue).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('opens the paste dialog from its first item and closes the menu', async () => {
    const trigger = renderMenu()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByTestId('capture-menu-paste-urls'))
    expect(await screen.findByRole('dialog', { name: 'Paste URLs to capture' })).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
