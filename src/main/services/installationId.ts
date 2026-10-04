import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

let cachedId: string | null = null

export function initInstallationId(userDataPath: string): void {
  const idPath = join(userDataPath, 'installation-id')
  if (existsSync(idPath)) {
    const raw = readFileSync(idPath, 'utf-8').trim()
    if (raw) {
      cachedId = raw
      return
    }
  }
  const fresh = randomUUID()
  writeFileSync(idPath, fresh, 'utf-8')
  cachedId = fresh
}

// The MCP server's load (ADR-0038): the id the app wrote, never a new one. A
// data folder without the file leaves the id unset.
export function loadInstallationId(userDataPath: string): void {
  const idPath = join(userDataPath, 'installation-id')
  cachedId = existsSync(idPath) ? readFileSync(idPath, 'utf-8').trim() || null : null
}

export function getInstallationId(): string {
  if (!cachedId) throw new Error('Installation ID not initialized')
  return cachedId
}

// For testing - allows resetting module state between test cases
export function resetInstallationId(): void {
  cachedId = null
}
