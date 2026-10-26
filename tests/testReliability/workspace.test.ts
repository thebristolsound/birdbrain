import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  JOURNAL,
  checkJournal,
  createWorkspace,
  restoreCommand
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/test-reliability/lib/workspace.mjs'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'test-reliability-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/a.ts'), 'original a\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('createWorkspace', () => {
  it('restores an edited file to its original bytes', () => {
    const workspace = createWorkspace(root)
    workspace.write('src/a.ts', 'mutant one')
    workspace.write('src/a.ts', 'mutant two')
    expect(read('src/a.ts')).toBe('mutant two')
    workspace.restore()
    expect(read('src/a.ts')).toBe('original a\n')
  })

  it('removes a file it created and brings back a file it removed', () => {
    const workspace = createWorkspace(root)
    workspace.write('src/deep/new.ts', 'restored from the merge base')
    workspace.remove('src/a.ts')
    expect(existsSync(join(root, 'src/a.ts'))).toBe(false)
    workspace.restore()
    expect(existsSync(join(root, 'src/deep/new.ts'))).toBe(false)
    expect(read('src/a.ts')).toBe('original a\n')
  })

  it('keeps a journal naming the edited files until it restores them', () => {
    const workspace = createWorkspace(root)
    workspace.write('src/a.ts', 'mutant')
    workspace.remove('src/b.ts')
    expect(JSON.parse(read(JOURNAL))).toEqual({ paths: ['src/a.ts', 'src/b.ts'] })
    expect(existsSync(join(root, `${JOURNAL}.tmp`))).toBe(false)
    expect(workspace.edited).toEqual(['src/a.ts', 'src/b.ts'])
    workspace.restore()
    expect(existsSync(join(root, JOURNAL))).toBe(false)
    expect(workspace.edited).toEqual([])
  })

  it('restores nothing twice', () => {
    const workspace = createWorkspace(root)
    workspace.write('src/a.ts', 'mutant')
    workspace.restore()
    writeFileSync(join(root, 'src/a.ts'), 'a later edit')
    workspace.restore()
    expect(read('src/a.ts')).toBe('a later edit')
  })
})

describe('checkJournal', () => {
  it('passes when no earlier run left a journal', () => {
    expect(() => checkJournal(root)).not.toThrow()
  })

  it('refuses to start after a run that never restored, naming the files and the fix', () => {
    createWorkspace(root).write('src/a.ts', 'mutant left behind')
    expect(() => checkJournal(root)).toThrow(
      /edited files in place: src\/a\.ts\. Restore them \(git checkout HEAD -- 'src\/a\.ts'/
    )
  })

  it('refuses to start after a run that left an unreadable journal, saying how to recover', () => {
    mkdirSync(join(root, '.cache/test-reliability'), { recursive: true })
    writeFileSync(join(root, JOURNAL), '{"paths": ["src/a')
    expect(() => checkJournal(root)).toThrow(
      /is unreadable \(.+\)\. Run git status to find the files it edited, restore them/
    )
  })
})

describe('restoreCommand', () => {
  it('quotes every path', () => {
    expect(restoreCommand(['src/a.ts', 'src/b c.ts'])).toBe(
      "git checkout HEAD -- 'src/a.ts' 'src/b c.ts'"
    )
  })
})
