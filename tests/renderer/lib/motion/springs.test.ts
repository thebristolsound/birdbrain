import { describe, it, expect } from 'vitest'
import { springs } from '@renderer/lib/motion/springs'

describe('springs', () => {
  it('exposes the expected set of springs', () => {
    expect(Object.keys(springs).sort()).toEqual([
      'bouncy',
      'gentle',
      'hover',
      'microTap',
      'molasses',
      'snappy'
    ])
  })

  it('snappy spring (existing)', () => {
    expect(springs.snappy.type).toBe('spring')
    expect(springs.snappy.stiffness).toBe(400)
    expect(springs.snappy.damping).toBe(30)
  })

  it('gentle spring (existing)', () => {
    expect(springs.gentle.type).toBe('spring')
    expect(springs.gentle.stiffness).toBe(200)
    expect(springs.gentle.damping).toBe(24)
  })

  it('bouncy spring (existing)', () => {
    expect(springs.bouncy.type).toBe('spring')
    expect(springs.bouncy.stiffness).toBe(500)
    expect(springs.bouncy.damping).toBe(15)
  })

  it('molasses spring (existing)', () => {
    expect(springs.molasses.type).toBe('spring')
    expect(springs.molasses.stiffness).toBe(120)
    expect(springs.molasses.damping).toBe(20)
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
