import { describe, it, expect } from 'vitest'
import { springs } from '@renderer/lib/motion/springs'

describe('springs', () => {
  it('exposes existing springs', () => {
    expect(springs.snappy.type).toBe('spring')
    expect(springs.gentle.type).toBe('spring')
    expect(springs.bouncy.type).toBe('spring')
    expect(springs.molasses.type).toBe('spring')
  })

  it('exposes microTap spring (high stiffness for press feedback)', () => {
    expect(springs.microTap.type).toBe('spring')
    expect(springs.microTap.stiffness).toBe(600)
    expect(springs.microTap.damping).toBe(28)
  })

  it('exposes hover spring (medium stiffness for lift)', () => {
    expect(springs.hover.type).toBe('spring')
    expect(springs.hover.stiffness).toBe(350)
    expect(springs.hover.damping).toBe(32)
  })
})
