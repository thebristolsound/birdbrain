// CI passes measured line counts to a separate, main-only publisher. The endpoint
// lives on the coverage-badge branch, so updating it never commits to main.
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export function createCoverageBadge(lines) {
  if (
    !Number.isSafeInteger(lines?.total) ||
    !Number.isSafeInteger(lines?.covered) ||
    lines.total <= 0 ||
    lines.covered < 0 ||
    lines.covered > lines.total
  ) {
    throw new Error('Coverage requires positive total lines and covered lines within that total')
  }
  return {
    schemaVersion: 1,
    label: 'lines (main)',
    message: `${((lines.covered / lines.total) * 100).toFixed(2)}%`,
    color: 'blue'
  }
}

export async function publishCoverageBadge(env, request = fetch) {
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Coverage publication requires a push to main')
  }
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '') ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') ||
    !env.GH_TOKEN
  ) {
    throw new Error('Coverage publication requires a repository, source commit, and token')
  }
  const badge = createCoverageBadge(JSON.parse(env.COVERAGE_LINES))
  const api = async (path, method = 'GET', body) => {
    const response = await request(
      `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/git/${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${env.GH_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: globalThis.AbortSignal.timeout(30_000)
      }
    )
    if (!response.ok) throw new Error(`GitHub ${method} ${path} failed (${response.status})`)
    return response.json()
  }

  // A rerun of an older commit must not replace the current main measurement.
  const main = await api('ref/heads/main')
  if (main.object.sha !== env.GITHUB_SHA) return 'Skipped coverage for an older main commit'

  const refs = await api('matching-refs/heads/coverage-badge')
  const previous = refs.find((ref) => ref.ref === 'refs/heads/coverage-badge')?.object.sha
  const tree = await api('trees', 'POST', {
    tree: [
      { path: 'coverage.json', mode: '100644', type: 'blob', content: JSON.stringify(badge) + '\n' }
    ]
  })
  const commit = await api('commits', 'POST', {
    message: `chore(badges): update line coverage\n\nSource: ${env.GITHUB_SHA}`,
    tree: tree.sha,
    parents: previous ? [previous] : []
  })
  if (previous) {
    // Never force: a concurrent writer must fail instead of discarding a newer badge.
    await api('refs/heads/coverage-badge', 'PATCH', { sha: commit.sha, force: false })
  } else {
    await api('refs', 'POST', { ref: 'refs/heads/coverage-badge', sha: commit.sha })
  }
  return `Published line coverage for ${env.GITHUB_SHA}`
}

export async function run(args, env = process.env) {
  if (args[0] === 'measure') {
    const summary = JSON.parse(await readFile(args[1] ?? 'coverage/coverage-summary.json', 'utf8'))
    const lines = summary.total?.lines
    createCoverageBadge(lines)
    return `lines=${JSON.stringify({ total: lines.total, covered: lines.covered })}`
  }
  if (args[0] === 'publish') return publishCoverageBadge(env)
  throw new Error('Usage: node scripts/coverage-badge.mjs <measure [summary.json]|publish>')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await run(process.argv.slice(2)))
}
