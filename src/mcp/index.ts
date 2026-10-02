import './stdoutGuard'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { openDatabaseReadOnly } from '@main/services/db/core'
import { initVerifyOnlyKey } from '@main/services/signingKey'
import { initStorage } from '@main/services/storage'
import { resolveToolVersion } from '@main/services/toolVersion'
import { resolveConfig } from './config'
import { createBirdbrainServer } from './server'

// The Birdbrain MCP server (ADR-0036): a separate, read-only process over
// stdio. Run under Electron as Node (ELECTRON_RUN_AS_NODE=1), because
// better-sqlite3 is built for Electron's ABI.
try {
  const config = resolveConfig(process.argv.slice(2), process.env)
  openDatabaseReadOnly(config.dbPath)
  initStorage(config.storageRoot)
  initVerifyOnlyKey(config.userDataPath)
  serveStdio(() => createBirdbrainServer(resolveToolVersion()), {
    onerror: (err) => console.error('birdbrain-mcp:', err)
  })
} catch (err) {
  console.error('birdbrain-mcp:', err instanceof Error ? err.message : err)
  process.exit(1)
}
