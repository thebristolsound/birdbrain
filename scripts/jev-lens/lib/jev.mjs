// TypeSafe (Jev) client: raw fetch, no SDK. Request and answer shapes follow
// https://docs.typesafe.ai/api.md as read on 2026-09-24. `createClient` takes its
// collaborators as arguments so the lens scripts and their tests share one code path.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const API = 'https://api.typesafe.ai/v1/systemone'
export const MODEL = process.env.TYPESAFE_MODEL || 'jev-latest'
const RETRY_STATUSES = new Set([429, 529])

export function createClient({
  apiKey = process.env.TYPESAFE_API_KEY,
  url = process.env.TYPESAFE_API_URL || API,
  model = MODEL,
  fetchImpl = globalThis.fetch,
  cacheDir = null,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxAttempts = 6
} = {}) {
  const usage = { requests: 0, cached: 0, inputTokens: 0, model: null }

  const ask = async (state, questions) => {
    const body = JSON.stringify({ state, model, questions })
    const file = cacheDir && join(cacheDir, `${createHash('sha256').update(body).digest('hex')}.json`)
    if (file && existsSync(file)) {
      usage.cached++
      return JSON.parse(readFileSync(file, 'utf8'))
    }
    if (!apiKey) throw new Error('TYPESAFE_API_KEY is not set')
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body
      })
      if (RETRY_STATUSES.has(res.status) && attempt + 1 < maxAttempts) {
        const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt
        await sleep(retryAfter * 1000)
        continue
      }
      if (!res.ok) throw new Error(`typesafe ${res.status}: ${(await res.text()).slice(0, 800)}`)
      const json = await res.json()
      usage.requests++
      usage.inputTokens += json.usage?.input_tokens ?? 0
      usage.model = json.model
      if (file) {
        mkdirSync(cacheDir, { recursive: true })
        writeFileSync(file, JSON.stringify(json))
      }
      return json
    }
  }
  return { ask, usage }
}

export const noul = (instructions, criteria) => ({ type: 'noul', instructions, ...(criteria && { criteria }) })
export const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria })
export const score = (instructions, criteria) => ({ type: 'score', instructions, criteria })

// Run fn over items with at most n in flight. Errors propagate.
export async function mapPool(items, n, fn) {
  const out = new Array(items.length)
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

export const cap = (s, n) => (s && s.length > n ? `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]` : s || '')
