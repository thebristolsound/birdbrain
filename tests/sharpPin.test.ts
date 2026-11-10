import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

const { dependencies } = JSON.parse(read('package.json')) as {
  dependencies: Record<string, string>
}
const EXACT = /^\d+\.\d+\.\d+$/

// sharp's output bytes are anchored in signed `derivation` entries, so the installed version may
// change only in a commit that changes it, one bump per pull request (#1321).
describe('sharp version pin', () => {
  it('names one exact version in package.json, with no range operator', () => {
    expect(dependencies.sharp).toMatch(EXACT)
  })

  it('resolves the lockfile to that same version', () => {
    const importer = read('pnpm-lock.yaml').match(
      /^ {6}sharp:\n {8}specifier: (\S+)\n {8}version: ([^(\s]+)/m
    )
    expect(importer?.slice(1)).toEqual([dependencies.sharp, dependencies.sharp])
  })

  it("is left out of Dependabot's grouped npm update", () => {
    const config = read('.github/dependabot.yml')
    const group = config.slice(config.indexOf('\n      npm:\n'), config.indexOf('\n    ignore:\n'))
    expect(group).toMatch(/\n {8}exclude-patterns:\n(?: {10}#.*\n)* {10}- 'sharp'\n/)
  })
})
