// The one way the health report talks to GitHub: `gh api`, JSON in and JSON out.
//
// `gh api` only, because `gh issue` and `gh label` return 403 in a web session
// (docs/agents/github-access.md), and never `--jq`: the response is parsed here,
// so a jq flag gh rejects cannot fail quietly behind a pipe. A write sends its
// payload on standard input, so no title, body or label ever reaches a command
// line.

import { spawnSync } from 'node:child_process'

const TOKEN_NAMES = ['GH_TOKEN', 'GITHUB_TOKEN']

export const hasToken = (env) => TOKEN_NAMES.some((name) => Boolean(env[name]))

// Returns gh(args, input): runs `gh api <args>` and parses what it prints. It
// throws on a failed call, on output that is not JSON, and on no output at all.
export const createGh = ({ spawn = spawnSync, env = process.env } = {}) => {
  return (args, input) => {
    const result = spawn('gh', ['api', ...args], {
      encoding: 'utf8',
      env,
      input,
      maxBuffer: 64 * 1024 * 1024
    })
    const endpoint = args.find((arg) => !arg.startsWith('-')) ?? 'api'
    if (result.error) throw new Error(`gh could not be started: ${result.error.message}`)
    if (result.status !== 0) {
      const detail = (result.stderr ?? '').trim().split('\n')[0]
      throw new Error(`gh api ${endpoint} failed (exit ${result.status}): ${detail}`)
    }
    try {
      return JSON.parse(result.stdout)
    } catch {
      throw new Error(`gh api ${endpoint} printed no JSON`)
    }
  }
}
