import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'src/renderer/styles/globals.css'), 'utf-8')
const blocks = {
  light: css.split('@theme {')[1]?.split('}')[0] ?? '',
  dark: css.split('html.dark {')[1]?.split('}')[0] ?? ''
}
type Theme = keyof typeof blocks

/**
 * The six-digit hex a token resolves to, following `var()` aliases. The dark block overrides
 * only what changes, so a token it does not declare falls back to the light declaration and
 * its aliases resolve against the dark values, as on the page.
 */
function token(theme: Theme, name: string): string {
  const declared = (block: string): string | undefined =>
    new RegExp(`--color-${name}:\\s*([^;]+);`).exec(block)?.[1].trim()
  const value = declared(blocks[theme]) ?? (theme === 'dark' ? declared(blocks.light) : undefined)
  const alias = value && /^var\(--color-([\w-]+)\)$/.exec(value)
  if (alias) return token(theme, alias[1])
  if (!value || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`${theme} resolves --color-${name} to no six-digit hex`)
  }
  return value.toLowerCase()
}

function darkToken(name: string): string {
  return token('dark', name)
}

function rgbaToken(theme: Theme, name: string): [number, number, number, number] {
  const declared = (block: string) =>
    new RegExp(
      `--color-${name}:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)\\)\\s*;`
    ).exec(block)
  const match = declared(blocks[theme]) ?? (theme === 'dark' ? declared(blocks.light) : null)
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
      ['text-primary', 'text-secondary', 'text-muted', 'text-faint'].map((text) => [text, plane])
    )
  )('%s is at least 4.5:1 on %s', (text, plane) => {
    expect(contrast(token(theme, text), token(theme, plane))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(planes.flatMap((plane) => ['control', 'input'].map((boundary) => [boundary, plane])))(
    'the %s boundary is at least 3:1 on %s, hovered or not',
    (boundary, plane) => {
      const edge = token(theme, boundary)
      const base = token(theme, plane)
      expect(contrast(edge, base)).toBeGreaterThanOrEqual(3)
      expect(contrast(edge, over(rgbaToken(theme, 'hover'), base))).toBeGreaterThanOrEqual(3)
    }
  )

  // `bg-primary text-primary-foreground` is the shadcn spelling of a filled control, and switch
  // thumbs and some buttons draw in `accent-foreground`.
  it.each(
    ['accent-fill', 'accent-fill-hover', 'primary'].flatMap((fill) =>
      ['primary-foreground', 'accent-foreground'].map((text) => [text, fill])
    )
  )('%s is at least 4.5:1 on %s', (text, fill) => {
    expect(contrast(token(theme, text), token(theme, fill))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(planes)('accent text, hovered or not, is at least 4.5:1 on %s', (plane) => {
    expect(contrast(token(theme, 'accent'), token(theme, plane))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token(theme, 'accent-hover'), token(theme, plane))).toBeGreaterThanOrEqual(4.5)
  })

  // The accent badge, the toast action and the info medallion put accent text on the tint.
  it.each(planes)('accent text is at least 4.5:1 on the accent tint over %s', (plane) => {
    const tint = over(rgbaToken(theme, 'accent-subtle'), token(theme, plane))
    expect(contrast(token(theme, 'accent'), tint)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(
    planes.flatMap((plane) =>
      [
        'success-fg',
        'danger-fg',
        'warning-fg',
        'hue-orange-fg',
        'hue-sky-fg',
        'hue-pink-fg',
        'hue-teal-fg',
        'hue-violet-fg'
      ].map((text) => [text, plane])
    )
  )('%s is at least 4.5:1 on %s', (text, plane) => {
    expect(contrast(token(theme, text), token(theme, plane))).toBeGreaterThanOrEqual(4.5)
  })

  // Badges, toast medallions and the Verified mark put status text on its own 10% tint.
  it.each(
    planes.flatMap((plane) => ['success', 'danger', 'warning'].map((status) => [status, plane]))
  )('%s text is at least 4.5:1 on its own tint over %s', (status, plane) => {
    const tint = over(rgbaToken(theme, `${status}-surface`), token(theme, plane))
    expect(contrast(token(theme, `${status}-fg`), tint)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(
    planes.flatMap((plane) =>
      ['success-fg', 'danger-fg', 'warning-fg'].map((text) => [text, plane])
    )
  )('%s is at least 4.5:1 on a hovered row over %s', (text, plane) => {
    const hovered = over(rgbaToken(theme, 'hover'), token(theme, plane))
    expect(contrast(token(theme, text), hovered)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['surface', 'card', 'elevated'])('the advisory mark is at least 3:1 on %s', (plane) => {
    expect(contrast(token(theme, 'warning-mark'), token(theme, plane))).toBeGreaterThanOrEqual(3)
  })
})

it('splits the three light planes so chrome, canvas and cards read apart', () => {
  expect(token('light', 'surface')).not.toBe(token('light', 'canvas'))
  expect(luminance(token('light', 'surface'))).toBeLessThan(luminance(token('light', 'canvas')))
  expect(luminance(token('light', 'canvas'))).toBeLessThan(luminance(token('light', 'card')))
})

describe('filled controls', () => {
  // White on the dark accent text colour measures under 3:1, so anything with text or a white
  // glyph on it takes the fill token. A solid accent background stays only on marks that hold
  // nothing: dots, bars, progress fills and the skeleton. A checkbox or button moved back to
  // the accent raises its file's count here, even when its white check sits on another line.
  // Opacity of 50% or more counts as solid; the tints that stay are 40% or less.
  const solidAccent =
    /(^|[\s'"`:!{}(])bg-(accent(-hover)?(\/[5-9]\d|\/100)?|ring|\[var\(--color-(accent|ring)\)\]|\(--color-(accent|ring)\))(?![-\w/[])/g
  const marks: Record<string, number> = {
    'components/captures/CaptureItem.tsx': 1,
    'components/dashboard/caseTypeStyle.ts': 1,
    'components/dashboard/cases/NewCaseWizard.tsx': 1,
    'components/export/ExportProgress.tsx': 1,
    'components/launchedBrowser/CaptureControl.tsx': 1,
    'components/layout/CommandPalette.tsx': 1,
    'components/layout/Sidebar.tsx': 2,
    'components/layout/TopBar.tsx': 1,
    'components/overview/ActivityTimeline.tsx': 1,
    'components/settings/UpdatesConfig.tsx': 1,
    'components/sharing/InviteDialog.tsx': 1,
    'components/sharing/SyncCard.tsx': 1,
    'components/sharing/memberModel.ts': 2,
    'components/ui/skeleton.tsx': 1
  }
  const root = join(process.cwd(), 'src/renderer')
  const sources = readdirSync(root, { recursive: true, encoding: 'utf-8' }).filter((path) =>
    /\.tsx?$/.test(path)
  )

  it('reads the renderer sources', () => {
    expect(sources.length).toBeGreaterThan(100)
  })

  it('keeps a solid accent background to the dots, bars and progress fills', () => {
    const found = Object.fromEntries(
      sources
        .map((path) => [
          path.replaceAll('\\', '/'),
          readFileSync(join(root, path), 'utf-8').match(solidAccent)?.length ?? 0
        ])
        .filter(([, count]) => count !== 0)
    )
    expect(found).toEqual(marks)
  })
})

describe('control boundaries', () => {
  const root = join(process.cwd(), 'src/renderer')
  const sources = readdirSync(root, { recursive: true, encoding: 'utf-8' }).filter((path) =>
    /\.tsx?$/.test(path)
  )
  // A checkbox or switch that fills when on draws its off state in the control colour, the
  // only boundary colour that holds 3:1 on every surface.
  const toggle = /\?\s*'(border-accent-fill )?bg-accent-fill'\s*:\s*'([^']*)'/g
  // Matched over the whole file, so a ternary Prettier wraps is checked as well as counted.
  const toggles = sources.flatMap((path) => {
    const text = readFileSync(join(root, path), 'utf-8')
    return [...text.matchAll(toggle)].map((match) => ({
      at: `${path.replaceAll('\\', '/')}:${text.slice(0, match.index).split('\n').length}`,
      off: match[2],
      // A checkbox that fills its border when on draws its off edge as a border; a switch track
      // is a fill.
      want: match[1] ? 'border-control' : 'bg-control'
    }))
  })

  it('finds the toggles it checks', () => {
    // Pinned by file, so a toggle that leaves the ternary form fails here even when a new one
    // joins elsewhere.
    expect(toggles.map(({ at }) => at.replace(/:\d+$/, '')).sort()).toEqual([
      'components/captures/CaptureItem.tsx',
      'components/captures/CaptureSelectionBar.tsx',
      'components/notes/selection/NoteSelectionPopover.tsx',
      'components/settings/AppearanceConfig.tsx',
      'components/settings/CapturePreferences.tsx',
      'components/settings/OperatorConfig.tsx',
      'components/settings/UpdatesConfig.tsx',
      'components/signals/SignalDetailRail.tsx',
      'components/signals/SignalRow.tsx'
    ])
  })

  it('draws every off toggle in the control colour', () => {
    const offenders = toggles
      .filter(({ off, want }) => !off.split(/\s+/).includes(want))
      .map(({ at }) => at)
    expect(offenders).toEqual([])
  })
})
