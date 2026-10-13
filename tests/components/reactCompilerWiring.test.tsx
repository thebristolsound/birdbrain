import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SinceLastVisitBanner } from '@renderer/components/overview/SinceLastVisitBanner'
import { PinLegend } from '@renderer/components/captures/annotation/PinLegend'

// Counts calls to the compiler's cache allocator, which only compiled components
// make. Without this, dropping the compiler from the jsdom project would leave
// every other test passing on uncompiled code the app no longer ships.
const cache = vi.hoisted(() => ({ calls: 0 }))
vi.mock('react/compiler-runtime', async (importOriginal) => {
  const actual = await importOriginal<{ c: (size: number) => unknown[] }>()
  return {
    ...actual,
    c: (size: number) => {
      cache.calls++
      return actual.c(size)
    }
  }
})

beforeEach(() => {
  cache.calls = 0
})
afterEach(() => {
  cleanup()
})

describe('React Compiler in the jsdom tests', () => {
  it('compiles a renderer component outside the blocking tier', () => {
    render(
      <SinceLastVisitBanner
        deltas={{ captures: 1, sources: 1, selectors: 0, notes: 0 }}
        lastVisitAt="2026-10-12T12:00:00.000Z"
        newCount={1}
        onReview={vi.fn()}
      />
    )
    expect(cache.calls).toBeGreaterThan(0)
  })

  it('leaves a blocking-tier component uncompiled', () => {
    render(<PinLegend rows={[]} openShapeId={null} onToggle={vi.fn()} />)
    expect(cache.calls).toBe(0)
  })
})
