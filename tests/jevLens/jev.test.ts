import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  API,
  cap,
  choice,
  createClient,
  mapPool,
  noul,
  score
  // @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/jev-lens/lib/jev.mjs'

type Res = { status: number; ok: boolean; headers: { get: (k: string) => string | null }; json: () => Promise<unknown>; text: () => Promise<string> }
const response = (status: number, body: unknown, retryAfter?: string): Res => ({
  status,
  ok: status < 400,
  headers: { get: (k) => (k === 'retry-after' && retryAfter ? retryAfter : null) },
  json: async () => body,
  text: async () => JSON.stringify(body)
})
const answer = { model: 'jev-1.13.0', answers: { q: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 12, output_tokens: 1 } }

describe('createClient', () => {
  it('posts state, model and questions with the bearer key and counts usage', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return response(200, answer)
    }
    const client = createClient({ apiKey: 'k', fetchImpl, model: 'jev-test' })
    const out = await client.ask({ text: 'x' }, { q: noul('is it?') })
    expect(out).toEqual(answer)
    expect(calls[0].url).toBe(API)
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer k')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ state: { text: 'x' }, model: 'jev-test', questions: { q: { type: 'noul', instructions: 'is it?' } } })
    expect(client.usage).toEqual({ requests: 1, cached: 0, inputTokens: 12, model: 'jev-1.13.0' })
  })

  it('refuses to call without a key', async () => {
    const client = createClient({ apiKey: '', fetchImpl: async () => response(200, answer) })
    await expect(client.ask('s', {})).rejects.toThrow('TYPESAFE_API_KEY is not set')
  })

  it('retries 429 and 529 with retry-after, then surfaces other errors', async () => {
    const statuses = [429, 529, 200]
    const slept: number[] = []
    const client = createClient({
      apiKey: 'k',
      fetchImpl: async () => response(statuses.shift() as number, statuses.length ? { error: 'busy' } : answer, '3'),
      sleep: async (ms: number) => { slept.push(ms) }
    })
    expect(await client.ask('s', {})).toEqual(answer)
    expect(slept).toEqual([3000, 3000])

    const bad = createClient({ apiKey: 'k', fetchImpl: async () => response(422, { error: 'malformed' }) })
    await expect(bad.ask('s', {})).rejects.toThrow('typesafe 422')

    const exhausted = createClient({ apiKey: 'k', fetchImpl: async () => response(429, {}), sleep: async () => {}, maxAttempts: 2 })
    await expect(exhausted.ask('s', {})).rejects.toThrow('typesafe 429')
  })

  it('serves a repeat request from the cache directory', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'jev-'))
    let calls = 0
    const client = createClient({ apiKey: 'k', cacheDir, fetchImpl: async () => { calls++; return response(200, answer) } })
    await client.ask('s', { q: noul('a') })
    await client.ask('s', { q: noul('a') })
    await client.ask('s', { q: noul('b') })
    expect(calls).toBe(2)
    expect(client.usage.cached).toBe(1)
    expect(readdirSync(cacheDir)).toHaveLength(2)
  })
})

describe('helpers', () => {
  it('build question objects and cap text', () => {
    expect(noul('q')).toEqual({ type: 'noul', instructions: 'q' })
    expect(noul('q', { true: 't', false: 'f' })).toEqual({ type: 'noul', instructions: 'q', criteria: { true: 't', false: 'f' } })
    expect(choice('q', { a: null })).toEqual({ type: 'choice', instructions: 'q', criteria: { a: null } })
    expect(score('q', ['lo', 'hi'])).toEqual({ type: 'score', instructions: 'q', criteria: ['lo', 'hi'] })
    expect(cap('abcdef', 3)).toBe('abc\n…[truncated 3 chars]')
    expect(cap('abc', 3)).toBe('abc')
    expect(cap(undefined, 3)).toBe('')
  })

  it('mapPool keeps order and bounds concurrency', async () => {
    let inFlight = 0
    let peak = 0
    const out = await mapPool([3, 1, 2], 2, async (n: number, i: number) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, n))
      inFlight--
      return `${i}:${n}`
    })
    expect(out).toEqual(['0:3', '1:1', '2:2'])
    expect(peak).toBe(2)
  })
})
