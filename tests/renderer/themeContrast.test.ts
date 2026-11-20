import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'src/renderer/styles/globals.css'), 'utf-8')
const blocks = {
  light: css.split('@theme {')[1]?.split('}')[0] ?? '',
  dark: css.split('html.dark {')[1]?.split('}')[0] ?? ''
}
type Theme = keyof typeof blocks

function token(theme: Theme, name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(blocks[theme])
  if (!match) throw new Error(`${theme} declares no six-digit hex for --color-${name}`)
  return match[1].toLowerCase()
}

function darkToken(name: string): string {
  return token('dark', name)
}

function rgbaToken(theme: Theme, name: string): [number, number, number, number] {
  const match = new RegExp(
    `--color-${name}:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)\\)\\s*;`
  ).exec(blocks[theme])
  if (!match) throw new Error(`${theme} declares no rgba() for --color-${name}`)
  const [, r, g, b, a] = match
  return [Number(r), Number(g), Number(b), Number(a)]
}

/** An rgba tint composited over an opaque colour, as the browser paints it. */
function over([r, g, b, a]: [number, number, number, number], base: string): string {
  return (
    '#' +
    [r, g, b]
      .map((channel, i) => {
        const under = parseInt(base.slice(1 + i * 2, 3 + i * 2), 16)
        return Math.round(channel * a + under * (1 - a))
          .toString(16)
          .padStart(2, '0')
      })
      .join('')
  )
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

const themes: Theme[] = ['light', 'dark']
const planes = ['canvas', 'surface', 'card', 'elevated']

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

describe.each(themes)('the %s palette', (theme) => {
  it.each(
    planes.flatMap((plane) =>
      ['text-secondary', 'text-muted', 'text-faint'].map((text) => [text, plane])
    )
  )('%s is at least 4.5:1 on %s', (text, plane) => {
    expect(contrast(token(theme, text), token(theme, plane))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(planes)('a control boundary is at least 3:1 on %s, hovered or not', (plane) => {
    const control = token(theme, 'control')
    const base = token(theme, plane)
    expect(contrast(control, base)).toBeGreaterThanOrEqual(3)
    expect(contrast(control, over(rgbaToken(theme, 'hover'), base))).toBeGreaterThanOrEqual(3)
  })

  it.each(['accent-fill', 'accent-fill-hover'])('white text is at least 4.5:1 on %s', (fill) => {
    expect(contrast('#ffffff', token(theme, fill))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(planes)('accent text is at least 4.5:1 on %s', (plane) => {
    expect(contrast(token(theme, 'accent'), token(theme, plane))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['surface', 'card', 'elevated'])('the advisory mark is at least 3:1 on %s', (plane) => {
    expect(contrast(token(theme, 'warning-mark'), token(theme, plane))).toBeGreaterThanOrEqual(3)
  })

  it('splits the three light planes so chrome, canvas and cards read apart', () => {
    if (theme === 'dark') return
    expect(token(theme, 'surface')).not.toBe(token(theme, 'canvas'))
    expect(luminance(token(theme, 'surface'))).toBeLessThan(luminance(token(theme, 'canvas')))
    expect(luminance(token(theme, 'canvas'))).toBeLessThan(luminance(token(theme, 'card')))
  })
})

describe('filled controls', () => {
  // White text on the dark accent text colour measures under 3:1, so a filled
  // control must take the fill token instead.
  const solidAccent = /(^|[\s'"`:])bg-accent(-hover)?(?![-\w/[])/
  const root = join(process.cwd(), 'src/renderer')
  const sources = readdirSync(root, { recursive: true, encoding: 'utf-8' }).filter((path) =>
    /\.tsx?$/.test(path)
  )

  it('reads the renderer sources', () => {
    expect(sources.length).toBeGreaterThan(100)
  })

  it('never puts white text on the accent text colour', () => {
    const offenders = sources.flatMap((path) =>
      readFileSync(join(root, path), 'utf-8')
        .split('\n')
        .map((line, i) => ({ line, at: `${path}:${i + 1}` }))
        .filter(({ line }) => solidAccent.test(line) && /\btext-white\b/.test(line))
        .map(({ at }) => at)
    )
    expect(offenders).toEqual([])
  })
})

describe('status words in the dark theme', () => {
  it.each(['success-fg', 'danger-fg', 'warning-fg'])('%s is at least 4.5:1 on elevated', (fg) => {
    expect(contrast(darkToken(fg), darkToken('elevated'))).toBeGreaterThanOrEqual(4.5)
  })
})
