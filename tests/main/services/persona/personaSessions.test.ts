import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// A fake Chromium cookie store per partition: `set` records what Electron
// would be handed and `get` reads it back, so the fields the import maps can
// be asserted end to end. `rejectNames` steers per-cookie set failures.
const ctl = vi.hoisted(() => ({
  stores: new Map<string, Map<string, Record<string, unknown>>>(),
  cleared: [] as string[],
  rejectNames: new Set<string>(),
  encryptionAvailable: true,
  // When set, every `cookies.set` waits on it, holding an import mid-flight.
  gate: null as Promise<void> | null,
  flushes: [] as Array<{ partition: string; storedCookies: number }>,
  onFlush: null as (() => void) | null
}))

vi.mock('electron', () => ({
  session: {
    fromPartition: (partition: string) => {
      const store = ctl.stores.get(partition) ?? new Map<string, Record<string, unknown>>()
      ctl.stores.set(partition, store)
      return {
        cookies: {
          set: async (details: Record<string, unknown>) => {
            if (ctl.gate) await ctl.gate
            if (ctl.rejectNames.has(details.name as string)) {
              throw new Error(`Failed to set cookie ${String(details.name)}`)
            }
            store.set(`${String(details.domain)}|${String(details.name)}`, details)
          },
          get: async () => [...store.values()],
          flushStore: async () => {
            ctl.flushes.push({ partition, storedCookies: store.size })
            ctl.onFlush?.()
          }
        },
        clearStorageData: async () => {
          ctl.cleared.push(partition)
          store.clear()
        }
      }
    }
  },
  safeStorage: {
    isEncryptionAvailable: () => ctl.encryptionAvailable
  }
}))

import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createPersona, getPersona, listPersonas } from '@main/services/db/personaRepo'
import {
  clearOrphanedPartitions,
  clearPersona,
  cookieUrl,
  getPersonaStorageState,
  importCookies,
  partitionForPersona,
  PersonaNotFoundError,
  removeOrphanedPartitions
} from '@main/services/persona/personaSessions'
import { UnsupportedCookieFileError } from '@main/services/persona/cookieFiles'

const FIXTURES = join(process.cwd(), 'tests/fixtures/cookies')
const NOW = 1767225600
const deps = { nowSeconds: () => NOW }

let userData: string

beforeEach(async () => {
  ctl.stores.clear()
  ctl.cleared.length = 0
  ctl.rejectNames.clear()
  ctl.encryptionAvailable = true
  ctl.gate = null
  ctl.flushes.length = 0
  ctl.onFlush = null
  userData = mkdtempSync(join(tmpdir(), 'birdbrain-persona-userdata-'))
  await initDatabase(join(userData, 'birdbrain.db'))
})

afterEach(() => {
  closeDatabase()
  rmSync(userData, { recursive: true, force: true })
})

async function cookiesOn(personaId: string) {
  const store = ctl.stores.get(partitionForPersona(personaId))
  return store ? [...store.values()] : []
}

// Every regular file under the user data directory, read as text. The
// database is included: its WAL and main file are where a copied value
// would land if the import ever wrote one.
function userDataText(): string {
  const parts: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else parts.push(readFileSync(p, 'latin1'))
    }
  }
  walk(userData)
  return parts.join('\n')
}

describe('partitionForPersona / cookieUrl', () => {
  it('names one persistent partition per persona', () => {
    expect(partitionForPersona('abc')).toBe('persist:persona-abc')
  })

  it('derives the url from domain, path and secure, dropping the leading dot', () => {
    expect(cookieUrl({ domain: '.example.com', path: '/', secure: true })).toBe(
      'https://example.com/'
    )
    expect(cookieUrl({ domain: 'forum.example.org', path: '/threads', secure: false })).toBe(
      'http://forum.example.org/threads'
    )
  })
})

describe('importCookies', () => {
  it('loads the Netscape fixture into the partition with every field mapped', async () => {
    const p = createPersona({ label: 'netscape' })
    const result = await importCookies(p.id, join(FIXTURES, 'netscape.txt'), deps)
    expect(result.accepted).toBe(3)
    expect(result.rejected).toEqual([
      { line: 7, reason: 'expired' },
      { line: 8, reason: 'malformed' },
      { line: 9, reason: 'malformed' }
    ])
    const cookies = await cookiesOn(p.id)
    expect(cookies).toEqual([
      {
        url: 'https://example.com/',
        name: 'sid',
        value: 'SENTINEL-NETSCAPE-9f3a',
        domain: '.example.com',
        path: '/',
        secure: true,
        httpOnly: false,
        sameSite: 'unspecified',
        expirationDate: 4102444800
      },
      {
        url: 'https://example.com/',
        name: 'auth',
        value: 'http-only-value',
        domain: '.example.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'unspecified',
        expirationDate: 4102444800
      },
      {
        url: 'http://forum.example.org/threads',
        name: 'view',
        value: 'session-only',
        path: '/threads',
        secure: false,
        httpOnly: false,
        sameSite: 'unspecified'
      }
    ])
  })

  it('loads the JSON fixture with sameSite carried through', async () => {
    const p = createPersona({ label: 'json' })
    const result = await importCookies(p.id, join(FIXTURES, 'cookie-editor.json'), deps)
    expect(result.accepted).toBe(3)
    expect(result.rejected).toEqual([
      { line: 4, reason: 'expired' },
      { line: 5, reason: 'unknown-same-site' },
      { line: 6, reason: 'malformed' }
    ])
    const cookies = await cookiesOn(p.id)
    expect(cookies.map((c) => [c.name, c.sameSite, c.httpOnly])).toEqual([
      ['sid', 'lax', true],
      ['view', 'unspecified', false],
      ['strict', 'strict', false]
    ])
  })

  it('records the accepted count and time on the row and returns the same time', async () => {
    const p = createPersona({ label: 'counted' })
    const result = await importCookies(p.id, join(FIXTURES, 'netscape.txt'), deps)
    expect(result.importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(getPersona(p.id)).toMatchObject({
      lastImportAt: result.importedAt,
      lastImportCount: 3
    })
  })

  // Decision 8 (ADR-0030): the file is read, loaded and discarded. With the
  // partition store faked, this proves what the app itself writes — the
  // database and anything else under user data — carries no cookie value.
  // Chromium's own store on the real partition is outside this test.
  it('writes no cookie value anywhere under the user data directory', async () => {
    const p = createPersona({ label: 'sealed' })
    await importCookies(p.id, join(FIXTURES, 'netscape.txt'), deps)
    await importCookies(p.id, join(FIXTURES, 'cookie-editor.json'), deps)
    getDb().pragma('wal_checkpoint(TRUNCATE)')
    const text = userDataText()
    expect(text).not.toContain('SENTINEL-NETSCAPE-9f3a')
    expect(text).not.toContain('SENTINEL-JSON-7c1d')
    expect(text).not.toContain('http-only-value')
  })

  it('counts a cookie the session refuses as rejected-by-session and keeps going', async () => {
    const p = createPersona({ label: 'partial' })
    ctl.rejectNames.add('auth')
    const result = await importCookies(p.id, join(FIXTURES, 'netscape.txt'), deps)
    expect(result.accepted).toBe(2)
    expect(result.rejected).toContainEqual({ line: 5, reason: 'rejected-by-session' })
    expect((await cookiesOn(p.id)).map((c) => c.name)).toEqual(['sid', 'view'])
    expect(getPersona(p.id)?.lastImportCount).toBe(2)
  })

  it('refuses an unsupported file before touching the partition', async () => {
    const p = createPersona({ label: 'refused' })
    await expect(importCookies(p.id, FIXTURES, deps)).rejects.toThrow(UnsupportedCookieFileError)
    expect(ctl.stores.has(partitionForPersona(p.id))).toBe(false)
    expect(getPersona(p.id)?.lastImportAt).toBeNull()
  })

  it('throws PersonaNotFoundError for an unknown or deleted persona', async () => {
    await expect(importCookies('missing', join(FIXTURES, 'netscape.txt'), deps)).rejects.toThrow(
      PersonaNotFoundError
    )
    const p = createPersona({ label: 'deleted' })
    await clearPersona(p.id)
    await expect(importCookies(p.id, join(FIXTURES, 'netscape.txt'), deps)).rejects.toThrow(
      PersonaNotFoundError
    )
  })

  it('uses the injected partition factory when one is given', async () => {
    const p = createPersona({ label: 'injected' })
    const set = vi.fn(async () => undefined)
    const flushStore = vi.fn(async () => undefined)
    const fromPartition = vi.fn(() => ({
      cookies: { set, flushStore },
      clearStorageData: vi.fn()
    }))
    await importCookies(p.id, join(FIXTURES, 'netscape.txt'), {
      ...deps,
      fromPartition: fromPartition as unknown as (partition: string) => Electron.Session
    })
    expect(fromPartition).toHaveBeenCalledWith(partitionForPersona(p.id))
    expect(set).toHaveBeenCalledTimes(3)
    expect(flushStore).toHaveBeenCalledTimes(1)
  })

  it('omits domain for a host-only cookie so it is not widened to subdomains', async () => {
    const p = createPersona({ label: 'host-only' })
    await importCookies(p.id, join(FIXTURES, 'cookie-editor.json'), deps)
    const byName = new Map((await cookiesOn(p.id)).map((c) => [c.name, c]))
    expect(byName.get('view')).not.toHaveProperty('domain')
    expect(byName.get('view')?.url).toBe('http://forum.example.org/threads')
    expect(byName.get('sid')?.domain).toBe('.example.com')
  })

  it('flushes the cookie store after the last set and before recording the import', async () => {
    const p = createPersona({ label: 'flushed' })
    let recordedAtFlush: string | null | undefined
    ctl.onFlush = () => {
      recordedAtFlush = getPersona(p.id)?.lastImportAt
    }
    await importCookies(p.id, join(FIXTURES, 'netscape.txt'), deps)
    expect(ctl.flushes).toEqual([{ partition: partitionForPersona(p.id), storedCookies: 3 }])
    expect(recordedAtFlush).toBeNull()
    expect(getPersona(p.id)?.lastImportCount).toBe(3)
  })
})

describe('clearPersona', () => {
  it('empties the partition, soft-deletes the row and drops it from the list', async () => {
    const p = createPersona({ label: 'cleared' })
    await importCookies(p.id, join(FIXTURES, 'netscape.txt'), deps)
    expect(await cookiesOn(p.id)).toHaveLength(3)

    expect(await clearPersona(p.id)).toBe(true)

    expect(ctl.cleared).toEqual([partitionForPersona(p.id)])
    expect(await cookiesOn(p.id)).toEqual([])
    expect(listPersonas()).toEqual([])
    const row = getDb().prepare('SELECT deleted_at FROM personas WHERE id = ?').get(p.id) as {
      deleted_at: string | null
    }
    expect(row.deleted_at).not.toBeNull()
  })

  it('waits for an in-flight import so no cookie lands after the clear', async () => {
    const p = createPersona({ label: 'racing' })
    let release!: () => void
    ctl.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const importing = importCookies(p.id, join(FIXTURES, 'netscape.txt'), deps)
    const deleting = clearPersona(p.id)
    await Promise.resolve()
    expect(ctl.cleared).toEqual([])
    release()
    await expect(importing).resolves.toMatchObject({ accepted: 3 })
    await expect(deleting).resolves.toBe(true)
    expect(await cookiesOn(p.id)).toEqual([])
    expect(getPersona(p.id)).toBeUndefined()
  })

  it('refuses an import queued behind a delete of the same persona', async () => {
    const p = createPersona({ label: 'queued' })
    const deleting = clearPersona(p.id)
    const importing = importCookies(p.id, join(FIXTURES, 'netscape.txt'), deps)
    await expect(deleting).resolves.toBe(true)
    await expect(importing).rejects.toThrow(PersonaNotFoundError)
    expect(await cookiesOn(p.id)).toEqual([])
  })

  it('returns false and clears nothing for an unknown or already deleted persona', async () => {
    expect(await clearPersona('missing')).toBe(false)
    const p = createPersona({ label: 'twice' })
    await clearPersona(p.id)
    expect(await clearPersona(p.id)).toBe(false)
    expect(ctl.cleared).toHaveLength(1)
  })
})

// The folders Chromium would have made for three personas: one live, one
// deleted through the app, and one whose row a snapshot restore dropped.
function seedPartitionFolders() {
  const live = createPersona({ label: 'live' })
  const deleted = createPersona({ label: 'deleted' })
  const orphan = '0f8e2c1a-1b2c-4d5e-9f00-aabbccddeeff'
  const root = join(userData, 'Partitions')
  for (const id of [live.id, deleted.id, orphan]) {
    mkdirSync(join(root, `persona-${id}`), { recursive: true })
    writeFileSync(join(root, `persona-${id}`, 'Cookies'), 'x')
  }
  mkdirSync(join(root, 'other-partition'))
  return { live: live.id, deleted: deleted.id, orphan, root }
}

describe('removeOrphanedPartitions', () => {
  it('removes only the folder of a persona with no row, live or deleted', async () => {
    const { live, deleted, orphan, root } = seedPartitionFolders()
    await clearPersona(deleted)
    removeOrphanedPartitions(userData, { sessionDataPath: userData })
    expect(readdirSync(root).sort()).toEqual(
      ['other-partition', `persona-${deleted}`, `persona-${live}`].sort()
    )
    expect(existsSync(join(root, `persona-${orphan}`))).toBe(false)
  })

  it('touches nothing when the database is not beside the session folders', () => {
    const { root } = seedPartitionFolders()
    const before = readdirSync(root).sort()
    removeOrphanedPartitions(userData, { sessionDataPath: join(userData, 'elsewhere') })
    removeOrphanedPartitions(join(userData, 'elsewhere'), { sessionDataPath: userData })
    expect(readdirSync(root).sort()).toEqual(before)
  })

  it('does nothing when there are no partition folders, or they cannot be listed', () => {
    expect(() => removeOrphanedPartitions(userData, { sessionDataPath: userData })).not.toThrow()
    writeFileSync(join(userData, 'Partitions'), 'not a folder')
    expect(() => removeOrphanedPartitions(userData, { sessionDataPath: userData })).not.toThrow()
  })
})

describe('clearOrphanedPartitions', () => {
  it("clears an orphan's storage through its session and leaves live personas alone", async () => {
    const { live, orphan, root } = seedPartitionFolders()
    await clearOrphanedPartitions(userData, { sessionDataPath: userData })
    expect(ctl.cleared).toEqual([partitionForPersona(orphan)])
    expect(ctl.cleared).not.toContain(partitionForPersona(live))
    expect(existsSync(join(root, `persona-${orphan}`))).toBe(true)
  })

  it('keeps going past a session that fails to clear', async () => {
    seedPartitionFolders()
    const clearStorageData = vi.fn(async () => {
      throw new Error('locked')
    })
    const fromPartition = vi.fn(() => ({ clearStorageData }))
    await expect(
      clearOrphanedPartitions(userData, {
        sessionDataPath: userData,
        fromPartition: fromPartition as unknown as (partition: string) => Electron.Session
      })
    ).resolves.toBeUndefined()
    expect(clearStorageData).toHaveBeenCalledTimes(1)
  })

  it('touches nothing when the database is not beside the session folders', async () => {
    seedPartitionFolders()
    await clearOrphanedPartitions(userData, { sessionDataPath: join(userData, 'elsewhere') })
    expect(ctl.cleared).toEqual([])
  })
})

describe('getPersonaStorageState', () => {
  it('reports what safeStorage says', () => {
    expect(getPersonaStorageState()).toEqual({ encryptionAvailable: true })
    ctl.encryptionAvailable = false
    expect(getPersonaStorageState()).toEqual({ encryptionAvailable: false })
  })
})
