import { describe, it, expect } from 'vitest'
import { springs } from '@renderer/lib/motion/springs'

describe('springs', () => {
  it('exports four named spring configs', () => {
    expect(Object.keys(springs)).toEqual(['snappy', 'gentle', 'bouncy', 'molasses'])
  })

  it('snappy is the decisive default', () => {
    expect(springs.snappy).toEqual({
      type: 'spring',
      stiffness: 400,
      damping: 30
    })
  })

  it('gentle is smooth and unhurried', () => {
    expect(springs.gentle).toEqual({
      type: 'spring',
      stiffness: 200,
      damping: 24
    })
  })

  it('bouncy has playful overshoot', () => {
    expect(springs.bouncy).toEqual({
      type: 'spring',
      stiffness: 500,
      damping: 15
    })
  })

  it('molasses is deliberately slow', () => {
    expect(springs.molasses).toEqual({
      type: 'spring',
      stiffness: 120,
      damping: 20
    })
  })
})
