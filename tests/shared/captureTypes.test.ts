import { describe, it, expectTypeOf } from 'vitest'
import type { CaptureEvent, CaptureSource } from '@shared/types'

describe('capture types', () => {
  it('CaptureSource is a union of auto, manual, selector', () => {
    expectTypeOf<CaptureSource>().toEqualTypeOf<'auto' | 'manual' | 'selector'>()
  })

  it('CaptureEvent has required fields', () => {
    const event: CaptureEvent = {
      type: 'stored',
      source: 'manual',
      url: 'https://example.com',
      timestamp: new Date().toISOString()
    }
    expectTypeOf(event).toMatchTypeOf<CaptureEvent>()
  })
})
