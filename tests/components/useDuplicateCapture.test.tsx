// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture } from '@shared/types'
import type { DuplicateCaptureResult } from '@shared/ipc'

const notifySuccess = vi.hoisted(() => vi.fn())
const notifyWarn = vi.hoisted(() => vi.fn())

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: vi.fn(), warn: notifyWarn, success: notifySuccess, info: vi.fn() }
}))

import {
  duplicateRefusalMessage,
  useDuplicateCapture
} from '@renderer/components/captures/useDuplicateCapture'
import { queryKeys } from '@renderer/lib/api/keys'
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

const duplicated: Capture = {
  ...capture,
  id: 'cap2',
  method: 'duplicate',
  duplicateOfCaptureId: 'cap1'
}

let duplicate: ReturnType<typeof vi.fn>
let client: QueryClient

function mount(target: Capture | null = capture) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(() => useDuplicateCapture(target, 'case1'), { wrapper })
}

function stub(result: DuplicateCaptureResult) {
  duplicate = vi.fn(async () => result)
  fakeBridge({ captures: { duplicate } })
}

beforeEach(() => {
  stub({ status: 'duplicated', capture: duplicated })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  notifySuccess.mockReset()
  notifyWarn.mockReset()
})

describe('useDuplicateCapture', () => {
  it('duplicates the selected capture, confirms it, and refreshes the list', async () => {
    const invalidate = vi.fn()
    const { result } = mount()
    client.invalidateQueries = invalidate

    act(() => result.current.duplicate())

    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Duplicated capture'))
    expect(duplicate).toHaveBeenCalledWith('cap1')
    // The row count changed, so both the list and the per-case counts are stale.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.captures('case1') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.captureCounts })
  })

  it('reports a refusal as a warning and leaves the cached list alone', async () => {
    stub({ status: 'rejected', reason: 'not_verified', detail: 'tampered' })
    const invalidate = vi.fn()
    const { result } = mount()
    client.invalidateQueries = invalidate

    act(() => result.current.duplicate())

    await waitFor(() => expect(notifyWarn).toHaveBeenCalledOnce())
    expect(notifyWarn).toHaveBeenCalledWith(
      'Only a capture that currently verifies can be duplicated'
    )
    expect(notifySuccess).not.toHaveBeenCalled()
    // Nothing was created, so refetching would only hide the refusal behind a
    // list that looks unchanged for a different reason.
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('does nothing without a selected capture', () => {
    const { result } = mount(null)

    act(() => result.current.duplicate())

    expect(duplicate).not.toHaveBeenCalled()
  })
})

describe('duplicateRefusalMessage', () => {
  it('names the blocking state for every refusal the main process can return', () => {
    // Each message has to name something the operator can act on: a generic
    // failure would read as a bug in the app rather than as the rule it is.
    expect(duplicateRefusalMessage({ status: 'rejected', reason: 'not_found' })).toMatch(
      /no longer in this case/
    )
    expect(
      duplicateRefusalMessage({ status: 'rejected', reason: 'operator_name_required' })
    ).toMatch(/operator name/)
    expect(duplicateRefusalMessage({ status: 'rejected', reason: 'copy_mismatch' })).toMatch(
      /nothing was added/
    )
    expect(
      duplicateRefusalMessage({ status: 'rejected', reason: 'not_verified', detail: 'legacy' })
    ).toMatch(/Legacy HTML captures/)
    expect(
      duplicateRefusalMessage({ status: 'rejected', reason: 'not_verified', detail: 'tampered' })
    ).toMatch(/currently verifies/)
  })
})
