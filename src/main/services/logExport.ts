import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createStoredZip } from '@main/services/zip'

// An explicit allowlist keeps case data, settings and credentials out of the
// export. Log entries have already passed the logger's structured projection.
export function buildLogExport(logDir: string): Buffer {
  if (!logDir) throw new Error('Logging has not started')
  const entries: Array<{ name: string; data: Buffer }> = []
  for (const name of ['birdbrain.log', 'birdbrain.log.1']) {
    try {
      entries.push({ name, data: readFileSync(join(logDir, name)) })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  if (entries.length === 0) throw new Error('No log files are available to export')
  return createStoredZip(entries)
}
