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

export function getInstallationId(): string {
  if (!cachedId) throw new Error('Installation ID not initialized')
  return cachedId
}

// For testing - allows resetting module state between test cases
export function resetInstallationId(): void {
  cachedId = null
}
