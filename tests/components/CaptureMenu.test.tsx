// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Capture } from '@shared/types'
import { CaptureMenu } from '@renderer/components/captures/CaptureMenu'
import { settleVpnWarning, useVpnWarningStore } from '@renderer/lib/vpnWarning'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'

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

function recaptureButton(): HTMLButtonElement {
  return screen.getByTestId('recapture-btn') as HTMLButtonElement
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <CaptureMenu caseId="case1" />
      </QueryClientProvider>
    )
    const trigger = screen.getByTestId('capture-menu-btn')
    fireEvent.click(trigger)
    // Enabled once the captures list has named the selected Capture.
    await waitFor(() => expect(recaptureButton().disabled).toBe(false))
    fireEvent.click(recaptureButton())
    await waitFor(() => expect(useVpnWarningStore.getState().open).toBe(true))
    act(() => settleVpnWarning('dismiss'))

    // Enabled again once the stopped Recapture has settled.
    fireEvent.click(trigger)
    await waitFor(() => expect(recaptureButton().disabled).toBe(false))
    expect(enqueue).not.toHaveBeenCalled()
    expect(screen.queryByTestId('recapture-error')).toBeNull()
  })
})
