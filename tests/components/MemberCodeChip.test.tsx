// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'fs'
import { join } from 'path'
import { MemberCodeChip, type ChipSize } from '@renderer/components/sharing/MemberCodeChip'
import { HUE_CLASSES, type MemberHue } from '@renderer/components/sharing/memberModel'

afterEach(() => cleanup())

// The Member Code chip (#1514, item 20): every hue is a literal class from
// HUE_CLASSES so Tailwind emits it, every size renders, the dot toggles and
// the title carries the attribution.

const HUES: MemberHue[] = ['accent', 'faint', 1, 2, 3, 4]
const SIZES: ChipSize[] = [14, 16, 18, 20, 24]

describe('MemberCodeChip', () => {
  it('renders each hue with its literal chip classes', () => {
    for (const hue of HUES) {
      const { unmount } = render(<MemberCodeChip code="NK" hue={hue} data-testid="chip" />)
      const chip = screen.getByTestId('chip')
      expect(chip.textContent).toBe('NK')
      expect(chip.dataset.hue).toBe(String(hue))
      for (const cls of HUE_CLASSES[hue].chip.split(' ')) expect(chip.classList).toContain(cls)
      unmount()
    }
  })

  it('renders each size, with the dot only when asked for', () => {
    for (const size of SIZES) {
      const { unmount } = render(
        <MemberCodeChip code="MB" hue={2} size={size} dot data-testid={`chip-${size}`} />
      )
      const chip = screen.getByTestId(`chip-${size}`)
      const dot = chip.querySelector('span[aria-hidden="true"]')
      expect(dot).not.toBeNull()
      expect(dot?.classList).toContain(HUE_CLASSES[2].dot)
      expect(dot?.classList).toContain('rounded-full')
      unmount()
    }
    render(<MemberCodeChip code="MB" hue={2} size={16} data-testid="no-dot" />)
    expect(screen.getByTestId('no-dot').querySelector('span')).toBeNull()
  })

  it('defaults to the 18px roster chip and carries the title and extra classes', () => {
    render(
      <MemberCodeChip
        code="AR"
        hue="accent"
        title="Captured by you (AR)"
        className="ml-2"
        data-testid="chip"
      />
    )
    const chip = screen.getByTestId('chip')
    expect(chip.getAttribute('title')).toBe('Captured by you (AR)')
    expect(chip.classList).toContain('h-[18px]')
    expect(chip.classList).toContain('ml-2')
    expect(chip.classList).toContain('bg-accent/15')
  })

  // The four hues are tokens with a light and a dark value (README, Design
  // tokens); the chip's classes resolve through them, so the stylesheet is
  // read here once rather than trusted.
  it('finds the eight member hue values in the stylesheet, light and dark', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/styles/globals.css'), 'utf-8')
    const [theme, dark] = css.split('html.dark {')
    const light = { 1: '#0284c7', 2: '#b45309', 3: '#047857', 4: '#be123c' }
    const lifted = { 1: '#38bdf8', 2: '#fbbf24', 3: '#34d399', 4: '#fb7185' }
    for (const n of [1, 2, 3, 4] as const) {
      expect(theme).toContain(`--color-member-${n}: ${light[n]};`)
      expect(dark).toContain(`--color-member-${n}: ${lifted[n]};`)
    }
  })
})
