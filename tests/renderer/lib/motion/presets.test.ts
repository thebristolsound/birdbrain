import { describe, it, expect } from 'vitest'
import { presets } from '@renderer/lib/motion/presets'

describe('presets', () => {
  const presetNames = [
    'fadeUp', 'fadeIn', 'scaleIn', 'modal', 'overlay',
    'slidePanel', 'listItem', 'stagger', 'popover', 'collapse'
  ]

  it('exports all 10 preset variants', () => {
    expect(Object.keys(presets).sort()).toEqual(presetNames.sort())
  })

  for (const name of presetNames) {
    it(`${name} has initial and animate properties`, () => {
      const preset = presets[name as keyof typeof presets]
      expect(preset).toHaveProperty('initial')
      expect(preset).toHaveProperty('animate')
    })
  }

  it('fadeUp animates opacity and y', () => {
    expect(presets.fadeUp.initial).toEqual({ opacity: 0, y: 8 })
    expect(presets.fadeUp.animate).toEqual({ opacity: 1, y: 0 })
  })

  it('modal uses gentle spring', () => {
    expect(presets.modal.transition).toMatchObject({
      type: 'spring',
      stiffness: 200,
      damping: 24
    })
  })

  it('overlay uses tween duration, not spring', () => {
    expect(presets.overlay.transition).toMatchObject({
      duration: 0.2
    })
  })

  it('stagger configures parent orchestration', () => {
    expect(presets.stagger.animate).toHaveProperty('transition')
    const transition = (presets.stagger.animate as Record<string, unknown>).transition as Record<string, unknown>
    expect(transition.staggerChildren).toBe(0.04)
  })

  it('all presets with exit have reversed entrance', () => {
    expect(presets.fadeUp.exit).toEqual({ opacity: 0, y: 8 })
    expect(presets.modal.exit).toMatchObject({ opacity: 0, scale: 0.96 })
  })
})
