import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { SinceLastVisitBanner } from '@renderer/components/overview/SinceLastVisitBanner'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('SinceLastVisitBanner', () => {
  // The compiled banner caches its label on its inputs, so the age has to come
  // from the ticking clock rather than a Date.now() read during render.
  it('ages the last-visit label as the minute ticks over', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-12T12:00:30.000Z'))
    render(
      <SinceLastVisitBanner
        deltas={{ captures: 1, sources: 1, selectors: 0, notes: 0 }}
        lastVisitAt="2026-10-12T12:00:00.000Z"
        newCount={1}
        onReview={vi.fn()}
      />
    )
    expect(screen.getByText(/just now/)).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText(/1 minute ago/)).toBeTruthy()
  })
})
