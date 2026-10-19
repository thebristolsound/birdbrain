import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// The investigation view keeps to the app's theme (view feasibility assessment, "Tokens, type
// and radii"): semantic colour tokens, the 10 / 11 / 12 / 14 / 18 type scale, and radii of
// 2 / 4 / 6 pixels. The mock's own status tokens, type sizes and radii do not carry over.

const ROOT = join(__dirname, '..')
const VIEW_DIR = join(ROOT, 'src/renderer/components/investigate')

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|' +
  'blue|indigo|violet|purple|fuchsia|pink|rose'
const ALLOWED_SIZES = new Set([
  'text-[10px]',
  'text-[11px]',
  'text-xs',
  'text-[12px]',
  'text-sm',
  'text-[14px]',
  'text-lg',
  'text-[18px]'
])
const ALLOWED_RADII = new Set(['sm', 'md', 'lg', 'full'])

const RULES: { name: string; pattern: RegExp; allowed?: (match: RegExpExecArray) => boolean }[] = [
  { name: 'colour value', pattern: /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g },
  { name: 'palette colour', pattern: new RegExp(`\\b[a-z-]+-(?:${PALETTE})-\\d{2,3}\\b`, 'g') },
  { name: 'black or white', pattern: /\b(?:text|bg|border|fill|stroke)-(?:black|white)\b/g },
  { name: 'mock token', pattern: /--bb-/g },
  {
    name: 'font size',
    pattern: /\btext-(?:xs|sm|base|lg|[2-9]?xl|\[[\d.]+(?:px|rem|em)\])(?![\w-])/g,
    allowed: ([size]) => ALLOWED_SIZES.has(size)
  },
  {
    name: 'radius',
    pattern: /\brounded(?:-(?:t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee))?(?:-([\w[\].]+))?(?![\w-])/g,
    allowed: ([, size]) => size !== undefined && ALLOWED_RADII.has(size)
  }
]

function tokenFindings(source: string): string[] {
  const findings: string[] = []
  for (const { name, pattern, allowed } of RULES) {
    for (const match of source.matchAll(pattern)) {
      if (!allowed || !allowed(match as RegExpExecArray)) findings.push(`${name}: ${match[0]}`)
    }
  }
  return findings
}

function viewFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? viewFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe('investigation view tokens', () => {
  it('finds the classes the assessment rules out', () => {
    expect(
      tokenFindings(
        'text-[13px] text-base rounded rounded-[3px] rounded-t-xl bg-amber-600 text-white ' +
          '#b45309 rgb(1,2,3) var(--bb-warn)'
      )
    ).toEqual([
      'colour value: #b45309',
      'colour value: rgb(',
      'palette colour: bg-amber-600',
      'black or white: text-white',
      'mock token: --bb-',
      'font size: text-[13px]',
      'font size: text-base',
      'radius: rounded',
      'radius: rounded-[3px]',
      'radius: rounded-t-xl'
    ])
  })

  it('passes the classes the app theme provides', () => {
    expect(
      tokenFindings(
        'text-[10px] text-[11px] text-xs text-sm text-lg text-text-primary text-danger-fg ' +
          'text-warning-fg bg-accent-subtle rounded-sm rounded-md rounded-lg rounded-t-md ' +
          'rounded-full border-border-strong text-left'
      )
    ).toEqual([])
  })

  it('holds for every file of the view', () => {
    const files = viewFiles(VIEW_DIR)
    expect(files.length).toBeGreaterThan(0)
    const findings = files.flatMap((file) =>
      tokenFindings(readFileSync(file, 'utf8')).map((f) => `${relative(ROOT, file)}: ${f}`)
    )
    expect(findings).toEqual([])
  })
})
