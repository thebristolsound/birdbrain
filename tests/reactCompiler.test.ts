import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
// @ts-expect-error - Babel 7 ships no type declarations, and #2062 pins @babel/core to 7
import { transformSync } from '@babel/core'
import { describe, expect, it } from 'vitest'
import { compilesWithReactCompiler, reactCompilerBabel } from '../scripts/react-compiler'
// @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
import { loadIncludeList } from '../scripts/jev-lens/backstop.mjs'

const root = join(__dirname, '..')

describe('compilesWithReactCompiler', () => {
  const entries = [
    { path: 'src/renderer/components/export/ExportDialog.tsx', tier: 'blocking' as const, why: '' },
    { path: 'src/renderer/components/data/**', tier: 'blocking' as const, why: '' },
    { path: 'src/renderer/components/captures/Advisory.tsx', tier: 'advisory' as const, why: '' }
  ]
  const compiles = (path: string) => compilesWithReactCompiler(join(root, path), entries, root)

  it('compiles renderer files the include list leaves out or marks advisory', () => {
    expect(compiles('src/renderer/components/captures/CaptureDetailsPanel.tsx')).toBe(true)
    expect(compiles('src/renderer/components/captures/Advisory.tsx')).toBe(true)
  })

  it('skips renderer files the include list marks blocking, by path or by glob', () => {
    expect(compiles('src/renderer/components/export/ExportDialog.tsx')).toBe(false)
    expect(compiles('src/renderer/components/data/DataTree.tsx')).toBe(false)
  })

  it('leaves the data-layer hooks uncompiled', () => {
    expect(compiles('src/renderer/lib/api/notes.ts')).toBe(false)
  })

  it('compiles nothing outside the renderer', () => {
    expect(compiles('src/shared/noteDoc.ts')).toBe(false)
    expect(compiles('tests/components/NoteToolbar.test.tsx')).toBe(false)
  })
})

describe('reactCompilerBabel', () => {
  it('filters with the include list read from its document', () => {
    const [[name, { sources }]] = reactCompilerBabel(root).plugins as [
      [string, { sources: (file: string) => boolean }]
    ]
    expect(name).toBe('babel-plugin-react-compiler')
    expect(sources(join(root, 'src/renderer/components/captures/ForensicsTab.tsx'))).toBe(false)
    expect(sources(join(root, 'src/renderer/components/captures/WaybackPanel.tsx'))).toBe(false)
    expect(sources(join(root, 'src/renderer/components/notes/NoteEditor.tsx'))).toBe(true)
  })
})

// The compiler's default panic threshold is "none": a function it cannot compile is shipped
// as written and nothing fails, so a toolchain change can silently stop it compiling most of
// the renderer (#2040: the Babel 8 bump dropped 31 of 202 functions with CI green). The
// baseline names the files that carry a compile error today; a file that joins it fails the
// test, and a file that leaves it is pruned with REACT_COMPILER_BASELINE=update.
const BASELINE = join(root, 'scripts', 'react-compiler-baseline.json')

function rendererSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return rendererSources(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe('the React Compiler compiles every renderer file it is given', () => {
  it(
    'reports compile errors only in the files the baseline already names',
    { timeout: 120_000 },
    () => {
      const entries = loadIncludeList(root)
      const files = rendererSources(join(root, 'src', 'renderer'))
        .filter((file) => compilesWithReactCompiler(file, entries, root))
        .sort()
      expect(files.length).toBeGreaterThan(100)

      const errors = new Map<string, string[]>()
      for (const file of files) {
        const rel = relative(root, file).split(sep).join('/')
        const logger = {
          logEvent(
            _filename: string | null,
            event: { kind: string; detail?: { reason?: string } }
          ) {
            if (event.kind !== 'CompileError') return
            errors.set(rel, [...(errors.get(rel) ?? []), event.detail?.reason ?? event.kind])
          }
        }
        transformSync(readFileSync(file, 'utf8'), {
          filename: file,
          babelrc: false,
          configFile: false,
          code: false,
          parserOpts: { plugins: file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'] },
          plugins: [['babel-plugin-react-compiler', { sources: () => true, logger }]]
        })
      }
      const found = [...errors.keys()].sort()
      if (process.env.REACT_COMPILER_BASELINE === 'update') {
        writeFileSync(BASELINE, JSON.stringify(found, null, 2) + '\n')
        return
      }
      const baseline: string[] = JSON.parse(readFileSync(BASELINE, 'utf8'))
      const regressed = found.filter((file) => !baseline.includes(file))
      const recovered = baseline.filter((file) => !found.includes(file))
      const why = regressed.map((file) => `${file}: ${[...new Set(errors.get(file))].join('; ')}`)
      expect(regressed, `files the compiler now skips:\n${why.join('\n')}`).toEqual([])
      expect(
        recovered,
        'files that compile now; prune them with REACT_COMPILER_BASELINE=update'
      ).toEqual([])
    }
  )
})
