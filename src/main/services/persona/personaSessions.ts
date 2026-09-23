import { session, safeStorage } from 'electron'
import type { Session } from 'electron'
import type { CookieRejection, PersonaImportResult, PersonaStorageState } from '@shared/types'
import * as personaRepo from '@main/services/db/personaRepo'
import { readCookieFile, type ImportedCookie } from '@main/services/persona/cookieFiles'

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

// Reads the file, loads every accepted cookie into the Persona's partition,
// records the count and time on the row, and returns what was and was not
// loaded. A cookie Chromium itself refuses (a `__Host-` name on an insecure
// URL, say) joins the rejection list as `rejected-by-session` rather than
// failing the whole import, so the operator learns exactly which rows the
// session will not carry.
export async function importCookies(
  personaId: string,
  filePath: string,
  deps: PersonaSessionDeps = {}
): Promise<PersonaImportResult> {
  if (!personaRepo.getPersona(personaId)) throw new PersonaNotFoundError(personaId)
  const nowSeconds = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
  const parsed = readCookieFile(filePath, nowSeconds())
  const ses = resolveSession(personaId, deps)
  const rejected: CookieRejection[] = [...parsed.rejected]
  let accepted = 0
  for (const [index, cookie] of parsed.cookies.entries()) {
    try {
      await ses.cookies.set({
        url: cookieUrl(cookie),
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        ...(cookie.expirationDate !== undefined ? { expirationDate: cookie.expirationDate } : {})
      })
      accepted += 1
    } catch {
      // The parser numbered rejections by file line; a set failure has only
      // the accepted-cookie index, so it is reported by position among those.
      rejected.push({ line: index + 1, reason: 'rejected-by-session' })
    }
  }
  const importedAt = new Date().toISOString()
  personaRepo.recordImport(personaId, accepted, importedAt)
  return { accepted, rejected, importedAt }
}

// Clearing the partition is the security action and always runs first
// (ADR-0030): a delete that soft-deleted the row and then failed to clear
// would hide a Persona whose cookies were still on disk.
export async function clearPersona(
  personaId: string,
  deps: PersonaSessionDeps = {}
): Promise<boolean> {
  if (!personaRepo.getPersona(personaId)) return false
  await resolveSession(personaId, deps).clearStorageData()
  return personaRepo.softDeletePersona(personaId)
}

// Same answer `signingKey.ts` gives for the key: Electron documents this as a
// plain getter. In a non-Electron test runtime the import above is mocked.
export function getPersonaStorageState(): PersonaStorageState {
  return { encryptionAvailable: safeStorage.isEncryptionAvailable() }
}
