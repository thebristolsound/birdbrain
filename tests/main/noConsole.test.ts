import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAIN_DIR = join(__dirname, '..', '..', 'src', 'main')
const CONSOLE_CALL = /\bconsole\.(log|warn|error|info|debug)\s*\(/

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return tsFiles(full)
    return full.endsWith('.ts') ? [full] : []
  })
}

describe('main process logging', () => {
  it('routes every diagnostic through the logger, never console', () => {
    const offenders = tsFiles(MAIN_DIR).filter((f) => CONSOLE_CALL.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
