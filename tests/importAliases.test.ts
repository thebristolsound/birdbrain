import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join, relative, resolve, sep } from 'path'

const ROOT = join(__dirname, '..')
const SCAN_DIRS = ['src', 'tests', 'e2e']
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mts|cts)$/
const IMPORT_PATTERN = new RegExp(
  [
    `(?:import|export)\\s+(?:type\\s+)?(?:[\\s\\S]*?\\s+from\\s+)?['"](\\.{1,2}\\/[^'"]+)['"]`,
    `import\\(\\s*['"](\\.{1,2}\\/[^'"]+)['"]\\s*\\)`
  ].join('|'),
  'g'
)

const ALIASED_ROOTS = [
  { dir: join(ROOT, 'src', 'main'), alias: '@main' },
  { dir: join(ROOT, 'src', 'shared'), alias: '@shared' },
  { dir: join(ROOT, 'src', 'renderer'), alias: '@renderer' }
]

function sourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...sourceFiles(fullPath))
    } else if (SOURCE_EXTENSIONS.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

function aliasedRootFor(path: string): string | null {
  for (const root of ALIASED_ROOTS) {
    if (path === root.dir || path.startsWith(root.dir + sep)) return root.alias
  }
  return null
}

describe('import aliases', () => {
  it('uses aliases instead of relative imports for shared source roots', () => {
    const offenders: string[] = []

    for (const scanDir of SCAN_DIRS) {
      for (const file of sourceFiles(join(ROOT, scanDir))) {
        const source = readFileSync(file, 'utf-8')
        for (const match of source.matchAll(IMPORT_PATTERN)) {
          const specifier = match[1] ?? match[2]
          const target = resolve(file, '..', specifier)
          const alias = aliasedRootFor(target)
          if (!alias) continue

          const targetPath = relative(ROOT, target)
          offenders.push(
            `${relative(ROOT, file)} imports "${specifier}" from ${targetPath}; use ${alias}`
          )
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
