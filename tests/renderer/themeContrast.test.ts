import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'src/renderer/styles/globals.css'), 'utf-8')
const dark = css.split('html.dark {')[1]?.split('}')[0] ?? ''

function darkToken(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(dark)
  if (!match) throw new Error(`html.dark declares no six-digit hex for --color-${name}`)
  return match[1].toLowerCase()
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio of two opaque colours. */
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('faint text in the dark theme', () => {
  it('measures contrast as WCAG 2 defines it', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })

  it.each(['surface', 'card', 'elevated'])('is at least 4.5:1 on %s', (surface) => {
    expect(contrast(darkToken('text-faint'), darkToken(surface))).toBeGreaterThanOrEqual(4.5)
  })

  it('is a darker step than muted text', () => {
    const faint = darkToken('text-faint')
    const muted = darkToken('text-muted')
    expect(faint).not.toBe(muted)
    expect(luminance(faint)).toBeLessThan(luminance(muted))
  })
})
