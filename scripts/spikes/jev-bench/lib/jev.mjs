// The benchmark's client is the lens client with a disk cache keyed on the request body.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '../../../jev-lens/lib/jev.mjs'
export { MODEL, cap, choice, mapPool, noul, score } from '../../../jev-lens/lib/jev.mjs'

const client = createClient({ cacheDir: join(dirname(fileURLToPath(import.meta.url)), '..', '.cache') })
export const ask = client.ask
export const usage = client.usage

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
