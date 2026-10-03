import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resolveConfig } from '../../src/mcp/config'

describe('MCP server configuration', () => {
  let userData: string

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'birdbrain-mcp-config-'))
    writeFileSync(join(userData, 'birdbrain.db'), '')
    mkdirSync(join(userData, 'captures'))
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('takes the data folder from --user-data before the environment', () => {
    const config = resolveConfig(['--user-data', userData], { BIRDBRAIN_USER_DATA: '/elsewhere' })

    expect(config).toEqual({
      userDataPath: userData,
      dbPath: join(userData, 'birdbrain.db'),
      storageRoot: join(userData, 'captures')
    })
  })

  it('falls back to BIRDBRAIN_USER_DATA', () => {
    expect(resolveConfig([], { BIRDBRAIN_USER_DATA: userData }).userDataPath).toBe(userData)
  })

  it('refuses to guess a data folder', () => {
    expect(() => resolveConfig([], {})).toThrow('No Birdbrain data folder given')
  })

  it('refuses a folder with no database', () => {
    rmSync(join(userData, 'birdbrain.db'))

    expect(() => resolveConfig(['--user-data', userData], {})).toThrow('No Birdbrain database')
  })

  it('follows the storage path in settings.json', () => {
    const elsewhere = join(userData, 'evidence')
    mkdirSync(elsewhere)
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ storagePath: elsewhere }))

    expect(resolveConfig(['--user-data', userData], {}).storageRoot).toBe(elsewhere)
  })

  it('uses the default storage folder when settings.json leaves the path empty', () => {
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ storagePath: '' }))

    expect(resolveConfig(['--user-data', userData], {}).storageRoot).toBe(
      join(userData, 'captures')
    )
  })

  // The app falls back to its default folder for a settings file it rejects,
  // so the server must read the same folder the app is writing to.
  it('uses the default storage folder when the app would reject settings.json', () => {
    const elsewhere = join(userData, 'evidence')
    mkdirSync(elsewhere)
    const defaults = join(userData, 'captures')
    writeFileSync(
      join(userData, 'settings.json'),
      JSON.stringify({ storagePath: elsewhere, theme: 'neon' })
    )
    expect(resolveConfig(['--user-data', userData], {}).storageRoot).toBe(defaults)

    writeFileSync(join(userData, 'settings.json'), '{"storagePath": "' + elsewhere)
    expect(resolveConfig(['--user-data', userData], {}).storageRoot).toBe(defaults)
  })

  it('refuses a storage folder that does not exist rather than creating it', () => {
    rmSync(join(userData, 'captures'), { recursive: true })

    expect(() => resolveConfig(['--user-data', userData], {})).toThrow('does not exist')
  })
})
