import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { logger } from '@main/services/logger'

const TOKEN_FILENAME = 'server-token'
const TOKEN_FORMAT = /^[0-9a-f]{64}$/

function generateToken(): string {
  return randomBytes(32).toString('hex')
}

let cachedToken: string = generateToken()

export function initServerToken(userDataPath: string): void {
  const tokenPath = join(userDataPath, TOKEN_FILENAME)
  try {
    const raw = readFileSync(tokenPath, 'utf-8').trim()
    if (TOKEN_FORMAT.test(raw)) {
      cachedToken = raw
      return
    }
    logger.warn('serverToken', 'serverToken.token_invalid')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('serverToken', 'serverToken.token_read_failed', undefined, err)
    }
  }
  const fresh = generateToken()
  try {
    writeFileSync(tokenPath, fresh, { encoding: 'utf-8', mode: 0o600 })
  } catch (err) {
    logger.warn('serverToken', 'serverToken.token_persist_failed', undefined, err)
  }
  cachedToken = fresh
}

export function getServerToken(): string {
  return cachedToken
}

export function resetServerTokenForTesting(): void {
  cachedToken = generateToken()
}
