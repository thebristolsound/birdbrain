// Minimal TypeSafe (Jev) client: raw fetch, no SDK, disk cache keyed on the request body.
// API shape: https://docs.typesafe.ai/api.md (read 2026-09-24).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = process.env.TYPESAFE_API_URL || 'https://api.typesafe.ai/v1/systemone'
export const MODEL = process.env.TYPESAFE_MODEL || 'jev-latest'
const CACHE_DIR = new URL('../.cache/', import.meta.url).pathname
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const usage = { requests: 0, cached: 0, inputTokens: 0, model: null }

export async function ask(state, questions, { model = MODEL } = {}) {
  const body = JSON.stringify({ state, model, questions })
  const key = createHash('sha256').update(body).digest('hex')
  const file = join(CACHE_DIR, `${key}.json`)
  if (existsSync(file)) {
    usage.cached++
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  const apiKey = process.env.TYPESAFE_API_KEY
  if (!apiKey) throw new Error('TYPESAFE_API_KEY is not set')
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body
    })
    if ((res.status === 429 || res.status === 529) && attempt < 6) {
      const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt
      await sleep(retryAfter * 1000)
      continue
    }
    if (!res.ok) throw new Error(`typesafe ${res.status}: ${(await res.text()).slice(0, 800)}`)
    const json = await res.json()
    usage.requests++
    usage.inputTokens += json.usage?.input_tokens ?? 0
    usage.model = json.model
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(file, JSON.stringify(json))
    return json
  }
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

// Deterministic sample so reruns compare like with like.
export function sample(arr, k, seed = 7) {
  let s = seed
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const copy = arr.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, k)
}

export const cap = (s, n) => (s && s.length > n ? `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]` : s || '')
