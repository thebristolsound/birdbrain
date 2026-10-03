import './stdoutGuard'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { resolveToolVersion } from '@main/services/toolVersion'
import { resolveConfig } from './config'
import { createBirdbrainServer } from './server'
import { startReadOnly } from './session'

// The Birdbrain MCP server (ADR-0038): a separate, read-only process over
// stdio. Run under Electron as Node (ELECTRON_RUN_AS_NODE=1), because
// better-sqlite3 is built for Electron's ABI.
try {
  const config = resolveConfig(process.argv.slice(2), process.env)
  startReadOnly(config)
  serveStdio(() => createBirdbrainServer(resolveToolVersion(), config.dbPath), {
    onerror: (err) => console.error('birdbrain-mcp:', err)
  })
} catch (err) {
  console.error('birdbrain-mcp:', err instanceof Error ? err.message : err)
  process.exit(1)
}
