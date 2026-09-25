// node run.mjs [bench ...]   — runs every benchmark (or the named ones), prints summaries,
// writes results/<bench>.json. Needs TYPESAFE_API_KEY; responses are cached under .cache/.
import { mkdirSync, writeFileSync } from 'node:fs'
import { usage, MODEL } from './lib/jev.mjs'

const BENCHES = ['evidence-pr', 'claim-diff', 'ready-bar', 'commit-type', 'start-module', 'explore']
const chosen = process.argv.slice(2).length ? process.argv.slice(2) : BENCHES
const bad = chosen.filter((b) => !BENCHES.includes(b))
if (bad.length) {
  console.error(`unknown bench: ${bad.join(', ')}\nknown: ${BENCHES.join(', ')}`)
  process.exit(2)
}
mkdirSync(new URL('./results/', import.meta.url).pathname, { recursive: true })

for (const name of chosen) {
  const t0 = Date.now()
  const before = { ...usage }
  process.stdout.write(`\n=== ${name} (${MODEL})\n`)
  const { default: run } = await import(`./bench/${name}.mjs`)
  const out = await run()
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  const meta = { bench: name, model: usage.model || MODEL, ranAt: new Date().toISOString(), seconds: Number(secs), requests: usage.requests - before.requests, cached: usage.cached - before.cached, inputTokens: usage.inputTokens - before.inputTokens }
  writeFileSync(new URL(`./results/${name}.json`, import.meta.url).pathname, JSON.stringify({ meta, ...out }, null, 1))
  console.log(JSON.stringify(out.summary, null, 1))
  console.log(`-- ${secs}s, ${meta.requests} requests (${meta.cached} cached), ${meta.inputTokens} input tokens`)
}
console.log(`\nTOTAL requests=${usage.requests} cached=${usage.cached} inputTokens=${usage.inputTokens} ≈ $${((usage.inputTokens / 1e6) * 0.042).toFixed(3)}`)
