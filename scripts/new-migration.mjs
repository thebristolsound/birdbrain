// Scaffolds the next schema migration (#1243).
//
// A schema change is two edits that have to agree: a new `if (version < N)`
// block at the end of runMigrations in migrations.ts, and LATEST_SCHEMA_VERSION
// in core.ts bumped to the same N. Done by hand they drift when one is
// forgotten, so this does both in one run. It refuses to run when the two files
// already disagree, and says which is ahead, rather than guessing a base.
//
// The generated block fails closed with a TODO error until its DDL is written,
// so opening the app cannot mark an unfinished migration as applied.
//
// Usage: node scripts/new-migration.mjs <slug>
//   <slug> is kebab-case and lands in the TODO so the empty block names its
//   purpose until the DDL replaces it.

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const CORE_PATH = 'src/main/services/db/core.ts'
export const MIGRATIONS_PATH = 'src/main/services/db/migrations.ts'

const CONSTANT_RE = /^export const LATEST_SCHEMA_VERSION = (\d+)$/m
const BLOCK_RE = /^ {2}if \(version < (\d+)\) \{$/gm
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const slugProblem = (slug) => {
  if (!slug) return 'a slug is required: node scripts/new-migration.mjs <slug>'
  if (!SLUG_RE.test(slug))
    return `slug "${slug}" is not kebab-case (lowercase letters, digits, hyphens)`
  return null
}

export const readConstant = (coreSource) => {
  const match = CONSTANT_RE.exec(coreSource)
  if (!match) throw new Error(`${CORE_PATH} has no "export const LATEST_SCHEMA_VERSION = N" line`)
  return Number(match[1])
}

export const readLastBlock = (migrationsSource) => {
  const blocks = [...migrationsSource.matchAll(BLOCK_RE)]
  if (blocks.length === 0) throw new Error(`${MIGRATIONS_PATH} has no "if (version < N) {" block`)
  const versions = blocks.map((m) => Number(m[1]))
  const outOfOrder = versions.find((version, index) => index > 0 && version <= versions[index - 1])
  if (outOfOrder !== undefined) {
    throw new Error(`${MIGRATIONS_PATH}: migration block versions must be strictly increasing`)
  }
  const lastIndex = blocks.length - 1
  const last = versions[lastIndex]
  const lastBlockStart = blocks[lastIndex].index
  const lastBlock = migrationsSource.slice(lastBlockStart)
  if (!new RegExp(`db\\.pragma\\('user_version = ${last}'\\)`).test(lastBlock)) {
    throw new Error(
      `${MIGRATIONS_PATH}: block "if (version < ${last})" has no db.pragma('user_version = ${last}')`
    )
  }
  return last
}

// Returns a message or null, so the refusal is testable without a filesystem.
export const mismatchProblem = (constant, lastBlock) => {
  if (constant === lastBlock) return null
  const ahead =
    constant > lastBlock
      ? `${CORE_PATH} is ahead: LATEST_SCHEMA_VERSION = ${constant}, last block is version < ${lastBlock}`
      : `${MIGRATIONS_PATH} is ahead: last block is version < ${lastBlock}, LATEST_SCHEMA_VERSION = ${constant}`
  return `${ahead}. Reconcile the two by hand before scaffolding on top of them.`
}

// Leading blank line: every existing block is separated from the one before
// it by one, and prettier does not insert it.
export const renderBlock = (next, slug) =>
  [
    '',
    '',
    `  if (version < ${next}) {`,
    '    db.transaction(() => {',
    `      // TODO(${slug}): describe what this migration changes and why, then add the DDL.`,
    `      throw new Error('Migration ${next} is not implemented')`,
    '    })()',
    '  }'
  ].join('\n')

// The new block goes before the closing brace of runMigrations, which is the
// last non-blank line of the file. Anything after that brace is preserved.
export const appendBlock = (migrationsSource, next, slug) => {
  const closing = migrationsSource.lastIndexOf('\n}')
  if (closing === -1) throw new Error(`${MIGRATIONS_PATH}: no closing "}" for runMigrations`)
  return (
    migrationsSource.slice(0, closing) + renderBlock(next, slug) + migrationsSource.slice(closing)
  )
}

export const bumpConstant = (coreSource, next) =>
  coreSource.replace(CONSTANT_RE, `export const LATEST_SCHEMA_VERSION = ${next}`)

// Pure: takes both sources, returns both rewritten or throws the refusal.
export const scaffold = ({ coreSource, migrationsSource, slug }) => {
  const slugIssue = slugProblem(slug)
  if (slugIssue) throw new Error(slugIssue)
  const constant = readConstant(coreSource)
  const lastBlock = readLastBlock(migrationsSource)
  const mismatch = mismatchProblem(constant, lastBlock)
  if (mismatch) throw new Error(mismatch)
  const next = constant + 1
  return {
    next,
    coreSource: bumpConstant(coreSource, next),
    migrationsSource: appendBlock(migrationsSource, next, slug)
  }
}

const main = () => {
  const slug = process.argv[2]
  let result
  try {
    result = scaffold({
      coreSource: readFileSync(CORE_PATH, 'utf8'),
      migrationsSource: readFileSync(MIGRATIONS_PATH, 'utf8'),
      slug
    })
  } catch (error) {
    console.error(`db:migration:new: ${error.message}`)
    process.exit(1)
  }
  writeFileSync(MIGRATIONS_PATH, result.migrationsSource)
  writeFileSync(CORE_PATH, result.coreSource)
  console.log(`db:migration:new: appended "if (version < ${result.next})" to ${MIGRATIONS_PATH}`)
  console.log(`db:migration:new: LATEST_SCHEMA_VERSION = ${result.next} in ${CORE_PATH}`)
  console.log(
    `db:migration:new: fill in the TODO(${slug}) body, then run pnpm test tests/main/services/database.test.ts`
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
