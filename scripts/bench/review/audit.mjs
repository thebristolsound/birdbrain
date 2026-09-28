#!/usr/bin/env node
// Scan every row's tool log under results/ for probes beyond the workspace
// (see lib/audit.mjs) and print one line per hit, then a total.
//
//   node audit.mjs [--results <dir>]

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { auditToolLog, parseToolLog } from './lib/audit.mjs'

const here = dirname(fileURLToPath(import.meta.url))

export function auditResults(resultsDir) {
  const out = { rows: 0, hits: [] }
  if (!existsSync(resultsDir)) return out
  for (const run of readdirSync(resultsDir)) {
    const rowsDir = join(resultsDir, run, 'rows')
    if (!existsSync(rowsDir)) continue
    for (const row of readdirSync(rowsDir)) {
      const log = join(rowsDir, row, 'tools.jsonl')
      if (!existsSync(log)) continue
      out.rows += 1
      // The dispatch row's own directory is where the runner tells the model to write.
      const hits = auditToolLog(parseToolLog(readFileSync(log, 'utf8')), {
        allow: [join(rowsDir, row)]
      })
      for (const h of hits) out.hits.push({ run, row, ...h })
    }
  }
  return out
}

function main(argv) {
  let resultsDir = join(here, 'results')
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--results') resultsDir = argv[++i]
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  const { rows, hits } = auditResults(resultsDir)
  for (const h of hits) console.log(`${h.run}/${h.row} ${h.probe} [${h.tool}] ${h.text}`)
  console.log(`${rows} rows audited, ${hits.length} probe${hits.length === 1 ? '' : 's'}`)
  return hits.length === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
