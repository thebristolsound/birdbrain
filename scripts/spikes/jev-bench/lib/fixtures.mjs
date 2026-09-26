import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = `${join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')}/`
const load = (name) => {
  const f = `${here}${name}.json`
  if (!existsSync(f)) throw new Error(`fixtures/${name}.json missing — run: node build-fixtures.mjs`)
  return JSON.parse(readFileSync(f, 'utf8'))
}
export const prs = () => load('prs')
export const issues = () => load('issues')
export const commits = () => load('commits')
export const diff = (n) => {
  const f = `${here}diffs/${n}.diff`
  return existsSync(f) ? readFileSync(f, 'utf8') : null
}
export const section = (body, heading) => {
  const m = (body || '').match(new RegExp(`^#{2,3} ${heading}\\s*\\n([\\s\\S]*?)(?=\\n#{2,3} |\\n</details>|(?![\\s\\S]))`, 'm'))
  return m ? m[1].trim() : ''
}
// Split a unified diff into per-file chunks: [{ path, text }].
export const splitDiff = (text) =>
  (text || '').split(/^diff --git /m).slice(1).map((chunk) => {
    const path = chunk.match(/^a\/(\S+) b\//)?.[1] || '?'
    return { path, text: `diff --git ${chunk}` }
  })
