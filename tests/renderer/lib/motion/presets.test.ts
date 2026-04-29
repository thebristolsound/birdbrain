import { describe, it, expect } from 'vitest'
import { presets } from '@renderer/lib/motion/presets'

describe('presets', () => {
  const entrancePresetNames = [
    'fadeUp',
    'fadeIn',
    'scaleIn',
    'modal',
    'overlay',
    'slidePanel',
    'listItem',
    'stagger',
    'popover',
    'collapse'
  ]
  const interactionPresetNames = ['tap', 'hoverLift', 'cardHover']
  const allPresetNames = [...entrancePresetNames, ...interactionPresetNames]

  it('exports all preset variants', () => {
    expect(Object.keys(presets).sort()).toEqual(allPresetNames.sort())
  })

  for (const name of entrancePresetNames) {
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
    const transition = (presets.stagger.animate as Record<string, unknown>).transition as Record<
      string,
      unknown
    >
    expect(transition.staggerChildren).toBe(0.04)
  })

  it('all presets with exit have reversed entrance', () => {
    expect(presets.fadeUp.exit).toEqual({ opacity: 0, y: 8 })
    expect(presets.modal.exit).toMatchObject({ opacity: 0, scale: 0.96 })
  })

  it('exposes tap preset with whileTap and microTap-class transition', () => {
    expect(presets.tap.whileTap).toEqual({ scale: 0.97 })
    expect(presets.tap.transition.type).toBe('spring')
    expect(presets.tap.transition.stiffness).toBe(600)
  })

  it('exposes hoverLift preset', () => {
    expect(presets.hoverLift.whileHover).toEqual({ y: -1 })
    expect(presets.hoverLift.transition.type).toBe('spring')
  })

  it('exposes cardHover preset (slightly larger lift)', () => {
    expect(presets.cardHover.whileHover).toEqual({ y: -2 })
    expect(presets.cardHover.transition.type).toBe('spring')
  })
})
