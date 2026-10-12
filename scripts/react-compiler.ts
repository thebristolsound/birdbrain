// React Compiler options for the renderer build and the jsdom test project, kept in one place
// so the tests run the same compiled components the app ships.
//
// The compiler skips every file the evidence-affecting include list marks blocking: a
// build-wide change would otherwise take on those files' review obligations (ADR-0004)
// without anyone reviewing them. One of them opts in through a change that meets those
// obligations. The list is read from its document, as the backstop reads it, so a file added
// to it later is skipped without a second edit here.
import { relative, sep } from 'node:path'
// @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
import { loadIncludeList, matchEntry } from './jev-lens/backstop.mjs'

type Entry = { path: string; tier: 'blocking' | 'advisory'; why: string }

export function compilesWithReactCompiler(file: string, entries: Entry[], root: string): boolean {
  const path = relative(root, file).split(sep).join('/')
  if (!path.startsWith('src/renderer/')) return false
  return (matchEntry(entries, path) as Entry | null)?.tier !== 'blocking'
}

export function reactCompilerBabel(root = process.cwd()) {
  const entries = loadIncludeList(root) as Entry[]
  return {
    plugins: [
      [
        'babel-plugin-react-compiler',
        { sources: (file: string) => compilesWithReactCompiler(file, entries, root) }
      ]
    ]
  }
}
