import type { McpServer } from '@modelcontextprotocol/server'
import { closeDatabase, openDatabaseReadOnly } from '@main/services/db/core'
import { loadInstallationId } from '@main/services/installationId'
import { initVerifyOnlyKey } from '@main/services/signingKey'
import { initStorage } from '@main/services/storage'
import type { McpConfig } from './config'

let running = 0

// One read-only connection per tool call, closed once no call is running.
// Held open between calls, it would keep the app's WAL alive through the app's
// close, and after a restore it would go on reading the replaced file.
export async function withReadConnection<T>(dbPath: string, run: () => T | Promise<T>): Promise<T> {
  if (running === 0) openDatabaseReadOnly(dbPath)
  running++
  try {
    return await run()
  } finally {
    running--
    if (running === 0) closeDatabase()
  }
}

type ToolCallback = (...args: unknown[]) => unknown
type Register = (name: string, config: unknown, callback: ToolCallback) => unknown

// Wraps every tool registered on `server` in withReadConnection. The SDK's
// registerTool is a set of generic overloads, so the wrapper is typed loosely
// and cast back; the callback itself is passed through untouched.
export function connectPerCall(server: McpServer, dbPath: string): void {
  const register = server.registerTool.bind(server) as unknown as Register
  const wrapped: Register = (name, config, callback) =>
    register(name, config, (...args) => withReadConnection(dbPath, () => callback(...args)))
  server.registerTool = wrapped as unknown as McpServer['registerTool']
}

// Everything else the tools need: the public key only, and the installation id
// the app already wrote, read rather than created, which a Shared Case's
// citations and author chains need. The database is opened once
// here so a schema version this build cannot read stops the server at start.
export function startReadOnly({ dbPath, storageRoot, userDataPath }: McpConfig): void {
  openDatabaseReadOnly(dbPath)
  closeDatabase()
  initStorage(storageRoot)
  initVerifyOnlyKey(userDataPath)
  loadInstallationId(userDataPath)
}
