import { readdirSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { app, session, safeStorage } from 'electron'
import type { Session } from 'electron'
import type { CookieRejection, PersonaImportResult, PersonaStorageState } from '@shared/types'
import * as personaRepo from '@main/services/db/personaRepo'
import { readCookieFile, type ImportedCookie } from '@main/services/persona/cookieFiles'
import { logger } from '@main/services/logger'

// One persistent Electron partition per Persona (ADR-0030, mechanism). The
// partition is the only place a cookie value lives after import: Chromium
// keeps it in its own store for the partition, protected by the OS key
// `safeStorage` reports on, and nothing here copies the file's bytes under
// the install. Phase 3 renders through the partition; this phase only seeds
// and clears it.
export function partitionForPersona(personaId: string): string {
  return `persist:persona-${personaId}`
}

export class PersonaNotFoundError extends Error {
  constructor(personaId: string) {
    super(`Persona ${personaId} does not exist`)
    this.name = 'PersonaNotFoundError'
  }
}

// Electron requires a `url` on set and derives the cookie's scheme and host
// from it. The leading dot of a domain cookie is not part of a host.
export function cookieUrl(cookie: Pick<ImportedCookie, 'domain' | 'path' | 'secure'>): string {
  const host = cookie.domain.replace(/^\./, '')
  return `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path}`
}

export interface PersonaSessionDeps {
  fromPartition?: (partition: string) => Session
  nowSeconds?: () => number
}

function resolveSession(personaId: string, deps: PersonaSessionDeps): Session {
  const fromPartition = deps.fromPartition ?? ((p: string) => session.fromPartition(p))
  return fromPartition(partitionForPersona(personaId))
}

// Import and delete for one persona run one at a time. Without this a delete
// could clear the partition while an import still had `cookies.set` calls
// to make, leaving cookies in the partition of a deleted persona.
const personaQueues = new Map<string, Promise<unknown>>()

function serialised<T>(personaId: string, run: () => Promise<T>): Promise<T> {
  const next = (personaQueues.get(personaId) ?? Promise.resolve()).then(run)
  const tail = next.catch(() => undefined)
  personaQueues.set(personaId, tail)
  void tail.then(() => {
    if (personaQueues.get(personaId) === tail) personaQueues.delete(personaId)
  })
  return next
}

// Reads the file, loads every accepted cookie into the Persona's partition,
// records the count and time on the row, and returns what was and was not
// loaded. A cookie Chromium itself refuses (a `__Host-` name on an insecure
// URL, say) joins the rejection list as `rejected-by-session` rather than
// failing the whole import, so the operator learns exactly which rows the
// session will not carry. The store is flushed before the row records the
// import, since Chromium defers cookie writes and a quit in between would
// otherwise leave a recorded import with nothing on disk.
export function importCookies(
  personaId: string,
  filePath: string,
  deps: PersonaSessionDeps = {}
): Promise<PersonaImportResult> {
  return serialised(personaId, () => runImport(personaId, filePath, deps))
}

async function runImport(
  personaId: string,
  filePath: string,
  deps: PersonaSessionDeps
): Promise<PersonaImportResult> {
  if (!personaRepo.getPersona(personaId)) throw new PersonaNotFoundError(personaId)
  const nowSeconds = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
  const parsed = readCookieFile(filePath, nowSeconds())
  const ses = resolveSession(personaId, deps)
  const rejected: CookieRejection[] = [...parsed.rejected]
  let accepted = 0
  for (const cookie of parsed.cookies) {
    try {
      await ses.cookies.set({
        url: cookieUrl(cookie),
        name: cookie.name,
        value: cookie.value,
        ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        ...(cookie.expirationDate !== undefined ? { expirationDate: cookie.expirationDate } : {})
      })
      accepted += 1
    } catch {
      rejected.push({ line: cookie.line, reason: 'rejected-by-session' })
    }
  }
  await ses.cookies.flushStore()
  const importedAt = new Date().toISOString()
  personaRepo.recordImport(personaId, accepted, importedAt)
  return { accepted, rejected, importedAt }
}

// Clearing the partition is the security action and always runs first
// (ADR-0030): a delete that soft-deleted the row and then failed to clear
// would hide a Persona whose cookies were still on disk.
export function clearPersona(personaId: string, deps: PersonaSessionDeps = {}): Promise<boolean> {
  return serialised(personaId, async () => {
    if (!personaRepo.getPersona(personaId)) return false
    await resolveSession(personaId, deps).clearStorageData()
    return personaRepo.softDeletePersona(personaId)
  })
}

// Chromium keeps `persist:<name>` under `<sessionData>/Partitions/<name>`,
// lowercased; persona ids are lowercase UUIDs, so the folder name maps back.
const PARTITION_FOLDER_PREFIX = 'persona-'

export interface OrphanSweepDeps extends PersonaSessionDeps {
  sessionDataPath?: string
}

// A persona folder with no row at all, live or deleted, is an orphan:
// restoring a database snapshot that predates the persona drops the row but
// not the folder, and nothing in the app can reach its cookies after that.
// When the database is not beside the session folders (BIRDBRAIN_USER_DATA
// without a matching --user-data-dir) absence from this database proves
// nothing, so nothing is swept.
function findOrphans(userDataPath: string, deps: OrphanSweepDeps): string[] | null {
  const sessionDataPath = deps.sessionDataPath ?? app.getPath('sessionData')
  if (resolve(sessionDataPath) !== resolve(userDataPath)) {
    logger.info('persona', 'persona.orphan_sweep_skipped')
    return null
  }
  let names: string[]
  try {
    names = readdirSync(join(sessionDataPath, 'Partitions'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    logger.warn('persona', 'persona.orphan_partition_clear_failed', undefined, err)
    return null
  }
  return names
    .filter((name) => name.startsWith(PARTITION_FOLDER_PREFIX))
    .map((name) => name.slice(PARTITION_FOLDER_PREFIX.length))
    .filter((id) => personaRepo.getPersonaLabel(id) === undefined)
}

// At startup, before any session has opened an orphan's partition, so the
// folder can go outright.
export function removeOrphanedPartitions(userDataPath: string, deps: OrphanSweepDeps = {}): void {
  const orphans = findOrphans(userDataPath, deps)
  if (!orphans) return
  const root = join(deps.sessionDataPath ?? app.getPath('sessionData'), 'Partitions')
  let removed = 0
  for (const id of orphans) {
    try {
      rmSync(join(root, `${PARTITION_FOLDER_PREFIX}${id}`), { recursive: true, force: true })
      removed += 1
    } catch (err) {
      logger.warn('persona', 'persona.orphan_partition_clear_failed', undefined, err)
    }
  }
  if (removed > 0) logger.info('persona', 'persona.orphan_partitions_cleared')
}

// After a snapshot restore the orphan's session may already be open, so its
// storage is cleared through the session; the empty folder goes at the next
// startup.
export async function clearOrphanedPartitions(
  userDataPath: string,
  deps: OrphanSweepDeps = {}
): Promise<void> {
  const orphans = findOrphans(userDataPath, deps)
  if (!orphans) return
  let cleared = 0
  for (const id of orphans) {
    try {
      await serialised(id, () => resolveSession(id, deps).clearStorageData())
      cleared += 1
    } catch (err) {
      logger.warn('persona', 'persona.orphan_partition_clear_failed', undefined, err)
    }
  }
  if (cleared > 0) logger.info('persona', 'persona.orphan_partitions_cleared')
}

// Same answer `signingKey.ts` gives for the key: Electron documents this as a
// plain getter. In a non-Electron test runtime the import above is mocked.
export function getPersonaStorageState(): PersonaStorageState {
  return { encryptionAvailable: safeStorage.isEncryptionAvailable() }
}
