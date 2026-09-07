import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import {
  CORE_PATH,
  MIGRATIONS_PATH,
  mismatchProblem,
  readLastBlock,
  scaffold,
  slugProblem
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../scripts/new-migration.mjs'

const SCRIPT = resolve(__dirname, '..', 'scripts', 'new-migration.mjs')

const core = (version: number) =>
  `import Database from 'better-sqlite3'\n\nexport const LATEST_SCHEMA_VERSION = ${version}\n`

// A migrations.ts holding one block per version, shaped as the real file is:
// the block guard, a transaction, and the pragma that closes it.
const migrations = (versions: number[]) => {
  const blocks = versions
    .map((version) =>
      [
        '',
        `  if (version < ${version}) {`,
        '    db.transaction(() => {',
        `      db.exec('ALTER TABLE captures ADD COLUMN col_${version} TEXT;')`,
        `      db.pragma('user_version = ${version}')`,
        '    })()',
        '  }'
      ].join('\n')
    )
    .join('\n')
  return [
    "import type Database from 'better-sqlite3'",
    '',
    'export function runMigrations(db: Database.Database): void {',
    "  const version = db.pragma('user_version', { simple: true }) as number",
    blocks,
    '}',
    ''
  ].join('\n')
}

// Runs the script as a developer does, against temp copies of the two files in
// a throwaway tree that mirrors their real paths.
const runIn = (coreSource: string, migrationsSource: string, args: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'new-migration-'))
  try {
    for (const [path, source] of [
      [CORE_PATH, coreSource],
      [MIGRATIONS_PATH, migrationsSource]
    ] as const) {
      mkdirSync(join(dir, dirname(path)), { recursive: true })
      writeFileSync(join(dir, path), source)
    }
    let exitCode = 0
    let stdout = ''
    let stderr = ''
    try {
      stdout = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' })
    } catch (error) {
      const failure = error as { status: number; stdout: string; stderr: string }
      exitCode = failure.status
      stdout = failure.stdout
      stderr = failure.stderr
    }
    return {
      exitCode,
      stdout,
      stderr,
      core: readFileSync(join(dir, CORE_PATH), 'utf8'),
      migrations: readFileSync(join(dir, MIGRATIONS_PATH), 'utf8')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('readLastBlock', () => {
  it('takes the highest block rather than the textually last one', () => {
    expect(readLastBlock(migrations([1, 2, 3]))).toBe(3)
  })

  it('rejects a block whose pragma does not set its own version', () => {
    const broken = migrations([1, 2]).replace('user_version = 2', 'user_version = 1')

    expect(() => readLastBlock(broken)).toThrow(/no db\.pragma\('user_version = 2'\)/)
  })
})

describe('mismatchProblem', () => {
  it('passes when the constant and the last block agree', () => {
    expect(mismatchProblem(33, 33)).toBeNull()
  })

  it('names core.ts when the constant is ahead', () => {
    expect(mismatchProblem(34, 33)).toContain(`${CORE_PATH} is ahead`)
  })

  it('names migrations.ts when the last block is ahead', () => {
    expect(mismatchProblem(33, 34)).toContain(`${MIGRATIONS_PATH} is ahead`)
  })
})

describe('slugProblem', () => {
  it('requires a slug', () => {
    expect(slugProblem(undefined)).toContain('a slug is required')
  })

  it.each(['Exhibit_Tables', 'exhibit tables', 'exhibit--tables', '-exhibit'])(
    'rejects %s as not kebab-case',
    (slug) => {
      expect(slugProblem(slug)).toContain('not kebab-case')
    }
  )

  it('accepts a kebab-case slug', () => {
    expect(slugProblem('exhibit-tables')).toBeNull()
  })
})

describe('scaffold', () => {
  it('bumps the constant and appends one block at the next version', () => {
    const result = scaffold({
      coreSource: core(33),
      migrationsSource: migrations([32, 33]),
      slug: 'exhibit-tables'
    })

    expect(result.next).toBe(34)
    expect(result.coreSource).toContain('export const LATEST_SCHEMA_VERSION = 34')
    expect(result.migrationsSource).toContain('if (version < 34) {')
    expect(result.migrationsSource).toContain("db.pragma('user_version = 34')")
    expect(result.migrationsSource).toContain('TODO(exhibit-tables)')
  })

  it('leaves the earlier blocks untouched and closes runMigrations after the new one', () => {
    const before = migrations([32, 33])
    const { migrationsSource } = scaffold({
      coreSource: core(33),
      migrationsSource: before,
      slug: 'exhibit-tables'
    })

    expect(migrationsSource.indexOf('if (version < 32) {')).toBe(
      before.indexOf('if (version < 32) {')
    )
    expect(migrationsSource.indexOf('if (version < 34) {')).toBeGreaterThan(
      migrationsSource.indexOf('if (version < 33) {')
    )
    expect(migrationsSource).toContain(
      "db.pragma('user_version = 33')\n    })()\n  }\n\n  if (version < 34) {"
    )
    expect(migrationsSource.trimEnd().endsWith('}')).toBe(true)
    expect(readLastBlock(migrationsSource)).toBe(34)
  })

  it('refuses when the two files disagree', () => {
    expect(() =>
      scaffold({ coreSource: core(33), migrationsSource: migrations([34]), slug: 'exhibit-tables' })
    ).toThrow(/is ahead/)
  })
})

describe('the script', () => {
  it('writes both files and reports what it did', () => {
    const result = runIn(core(33), migrations([32, 33]), ['exhibit-tables'])

    expect(result.exitCode).toBe(0)
    expect(result.core).toContain('export const LATEST_SCHEMA_VERSION = 34')
    expect(result.migrations).toContain('if (version < 34) {')
    expect(result.stdout).toContain('LATEST_SCHEMA_VERSION = 34')
  })

  it('exits non-zero and writes neither file when the two disagree', () => {
    const coreSource = core(33)
    const migrationsSource = migrations([34])
    const result = runIn(coreSource, migrationsSource, ['exhibit-tables'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('is ahead')
    expect(result.core).toBe(coreSource)
    expect(result.migrations).toBe(migrationsSource)
  })

  it('exits non-zero when no slug is given', () => {
    const result = runIn(core(33), migrations([33]), [])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('a slug is required')
  })
})

describe('the repository files', () => {
  it('has core.ts and migrations.ts in agreement, so the scaffold can run', () => {
    const root = resolve(__dirname, '..')
    const coreSource = readFileSync(join(root, CORE_PATH), 'utf8')
    const migrationsSource = readFileSync(join(root, MIGRATIONS_PATH), 'utf8')
    const match = /export const LATEST_SCHEMA_VERSION = (\d+)/.exec(coreSource)

    expect(mismatchProblem(Number(match?.[1]), readLastBlock(migrationsSource))).toBeNull()
  })
})
