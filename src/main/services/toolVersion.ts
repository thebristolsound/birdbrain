import { app } from 'electron'

// The version recorded on every signed Manifest entry and certification. The
// vitest harness runs under ELECTRON_RUN_AS_NODE, where the electron `app`
// module is unavailable, so the lookup is guarded and falls back to a sentinel
// rather than throwing.
export function resolveToolVersion(): string {
  if (typeof app?.getVersion === 'function') return app.getVersion()
  return process.env.npm_package_version ?? '0.0.0'
}
