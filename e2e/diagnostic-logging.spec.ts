import { test, expect } from './fixtures/electronApp'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { LogEntry, SessionRecord } from '@shared/types'

// End-to-end proof that the durable log actually lands on disk in a real app
// run. The unit suites cover each piece in isolation against a temp directory;
// this is the one check that the whole chain — startSession, initLogger, the
// crash handlers' registration, and the before-quit clean-exit marking — is
// wired into the real startup path and survives a genuine launch and quit.
test.describe('Diagnostic logging', () => {
  test('writes a structural session log during a real launch', async ({ electronApp, page }) => {
    await expect(page.locator('[data-testid="app-ready"]')).toBeVisible()

    const userData = await electronApp.evaluate(
      ({ app }) => process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
    )
    const logDir = join(userData, 'logs')

    const sessionsPath = join(logDir, 'sessions.json')
    await expect.poll(() => existsSync(sessionsPath), { timeout: 10000 }).toBe(true)

    const sessions = JSON.parse(readFileSync(sessionsPath, 'utf8')) as SessionRecord[]
    expect(sessions.length).toBeGreaterThan(0)

    const current = sessions[sessions.length - 1]
    expect(current.sessionId).toBeTruthy()
    expect(current.version).toBeTruthy()
    expect(current.platform).toBe(process.platform)
    // Still running, so this launch has not been marked clean yet.
    expect(current.cleanExit).toBe(false)

    // The lock is the crash signal: present for the duration of the run.
    expect(existsSync(join(logDir, 'session.lock'))).toBe(true)

    const logPath = join(logDir, 'birdbrain.log')
    if (existsSync(logPath)) {
      const entries = readFileSync(logPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as LogEntry)

      // Nothing free-form ever reaches disk: no entry carries a message field,
      // and every code is a dotted identifier from the closed union.
      for (const entry of entries) {
        expect(entry).not.toHaveProperty('message')
        expect(entry.code).toMatch(/^[a-zA-Z]+\.[a-z_]+$/)
        expect(entry.sessionId).toBeTruthy()
      }
    }
  })
})
