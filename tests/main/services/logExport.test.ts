import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildLogExport } from '@main/services/logExport'
import { readStoredZip } from '@main/services/zipRead'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'birdbrain-log-export-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('log export', () => {
  it('exports a current log when no rotated file exists', () => {
    writeFileSync(join(dir, 'birdbrain.log'), 'current log')
    writeFileSync(join(dir, 'credentials.json'), 'private')
    const entries = readStoredZip(buildLogExport(dir))
    expect([...entries.keys()]).toEqual(['birdbrain.log'])
    expect(entries.get('birdbrain.log')?.toString()).toBe('current log')
  })

  it('reports absent logs without creating an empty archive', () => {
    expect(() => buildLogExport('')).toThrow('Logging has not started')
    expect(() => buildLogExport(dir)).toThrow('No log files are available')
  })

  it('surfaces an unreadable log instead of silently omitting it', () => {
    mkdirSync(join(dir, 'birdbrain.log'))
    expect(() => buildLogExport(dir)).toThrow()
  })
})
