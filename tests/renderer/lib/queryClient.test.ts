import { describe, expect, it, vi } from 'vitest'
vi.mock('@renderer/lib/notify', () => ({ notify: { error: vi.fn(), warn: vi.fn() } }))

import { failureMessage } from '@renderer/lib/queryClient'

describe('failureMessage', () => {
  it('uses the action from mutation meta', () => {
    expect(failureMessage({ options: { meta: { action: 'save note' } } })).toBe(
      "Couldn't save note."
    )
  })

  it('falls back to a generic message when meta is absent', () => {
    expect(failureMessage({ options: {} })).toBe('Something went wrong. Please try again.')
  })
})
