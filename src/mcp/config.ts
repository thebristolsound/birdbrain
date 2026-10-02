import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

export interface McpConfig {
  userDataPath: string
  dbPath: string
  storageRoot: string
}

// The data folder is required rather than guessed: Electron derives it from the
// app name, which differs between a dev build (`birdbrain`) and a packaged one
// (`Birdbrain`), and this process has no `app` to ask.
export function resolveConfig(argv: string[], env: NodeJS.ProcessEnv): McpConfig {
  const flag = argv.indexOf('--user-data')
  const given = flag >= 0 ? argv[flag + 1] : env.BIRDBRAIN_USER_DATA
  if (!given) {
    throw new Error(
      'No Birdbrain data folder given. Pass --user-data <path> or set BIRDBRAIN_USER_DATA.'
    )
  }
  const userDataPath = resolve(given)
  const dbPath = join(userDataPath, 'birdbrain.db')
  if (!existsSync(dbPath)) {
    throw new Error(`No Birdbrain database at ${dbPath}`)
  }
  const storageRoot = readStoragePath(userDataPath) || join(userDataPath, 'captures')
  if (!existsSync(storageRoot)) {
    throw new Error(`Birdbrain storage folder ${storageRoot} does not exist`)
  }
  return { userDataPath, dbPath, storageRoot }
}

// Reads settings.json directly: initSettings would rewrite the file (#404's
// fresh-install latch, the retired-key cleanup), and this process never writes.
function readStoragePath(userDataPath: string): string {
  const settingsPath = join(userDataPath, 'settings.json')
  if (!existsSync(settingsPath)) return ''
  const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf-8'))
  const storagePath = (parsed as { storagePath?: unknown } | null)?.storagePath
  return typeof storagePath === 'string' ? storagePath : ''
}
