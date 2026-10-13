import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compilesWithReactCompiler, reactCompilerBabel } from '../scripts/react-compiler'

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
