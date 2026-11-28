import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { HAS_JQ } from './helpers/jq'

// claude-token.sh against a stand-in for the CLI, so each case reads which credential the
// probe checked, whether it made the request, and what it printed.
const SCRIPT = resolve(__dirname, '../.github/scripts/health/claude-token.sh')
// Assembled at runtime, like the values in dispatchRedact.test.ts.
const TOKEN = ['sk', 'ant', 'oat01', 'Ab3'.repeat(12)].join('-')

// Records whether the token reached it, then prints response.json and exits with the
// status in the exit file when there is one.
const STUB = `#!/usr/bin/env bash
dir="$(dirname "$0")"
echo "$(( $(cat "$dir/count" 2>/dev/null || echo 0) + 1 ))" > "$dir/count"
printf '%s' "\${CLAUDE_CODE_OAUTH_TOKEN:-<unset>}" > "$dir/token"
echo "a warning naming \${CLAUDE_CODE_OAUTH_TOKEN:-no token}" >&2
cat "$dir/response.json"
if [ -f "$dir/exit" ]; then exit "$(cat "$dir/exit")"; fi
`
const OK = { type: 'result', is_error: false, result: 'ok' }
const REFUSED = {
  type: 'result',
  is_error: true,
  api_error_status: 401,
  result: 'Invalid bearer token'
}

let root: string
let bin: string

const probe = (env: Record<string, string>, response: unknown = OK) => {
  writeFileSync(join(bin, 'response.json'), JSON.stringify(response))
  const inherited = { ...process.env }
  for (const name of [
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN_EXPIRES',
    'CLAUDE_TOKEN_SOURCE'
  ]) {
    delete inherited[name]
  }
  return spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: { ...inherited, PATH: `${bin}:${process.env.PATH}`, ...env }
  })
}
const calls = () =>
  existsSync(join(bin, 'count')) ? Number(readFileSync(join(bin, 'count'), 'utf8')) : 0
const seenToken = () => readFileSync(join(bin, 'token'), 'utf8')

describe.skipIf(!HAS_JQ)('claude-token.sh', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'claude-token-'))
    bin = join(root, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'claude'), STUB)
    chmodSync(join(bin, 'claude'), 0o755)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  describe('probing the token, the default', () => {
    it('fails without a request when the token is not set', () => {
      const result = probe({})

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('CLAUDE_CODE_OAUTH_TOKEN secret is not set')
      expect(calls()).toBe(0)
    })

    it('passes on a token the API accepts, and names its expiry', () => {
      const result = probe({
        CLAUDE_CODE_OAUTH_TOKEN: TOKEN,
        CLAUDE_CODE_OAUTH_TOKEN_EXPIRES: '2099-01-01'
      })

      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout.trim()).toBe('CLAUDE_CODE_OAUTH_TOKEN probe ok, expires 2099-01-01')
      expect(calls()).toBe(1)
      expect(seenToken()).toBe(TOKEN)
    })

    it('fails without a request on a token past its expiry', () => {
      const result = probe({
        CLAUDE_CODE_OAUTH_TOKEN: TOKEN,
        CLAUDE_CODE_OAUTH_TOKEN_EXPIRES: '2020-01-01'
      })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('CLAUDE_CODE_OAUTH_TOKEN expired on 2020-01-01')
      expect(calls()).toBe(0)
    })

    it('fails on a token the API refuses, with the token redacted', () => {
      const result = probe({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN }, REFUSED)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        'CLAUDE_CODE_OAUTH_TOKEN probe failed (exit 0): 401: Invalid bearer token'
      )
      expect(result.stderr).toContain('a warning naming sk-ant-<REDACTED>')
      expect(result.stdout + result.stderr).not.toContain(TOKEN)
    })
  })

  describe("probing the CLI's stored login", () => {
    it('passes with no token set, and makes the request without one', () => {
      const result = probe({ CLAUDE_TOKEN_SOURCE: 'login' })

      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout.trim()).toBe("the CLI's stored login probe ok")
      expect(calls()).toBe(1)
      expect(seenToken()).toBe('<unset>')
    })

    it("does not read the token's expiry", () => {
      const result = probe({
        CLAUDE_TOKEN_SOURCE: 'login',
        CLAUDE_CODE_OAUTH_TOKEN_EXPIRES: '2020-01-01'
      })

      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout.trim()).toBe("the CLI's stored login probe ok")
    })

    it('fails when the API refuses the login, and names the login', () => {
      const result = probe({ CLAUDE_TOKEN_SOURCE: 'login' }, REFUSED)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        "the CLI's stored login probe failed (exit 0): 401: Invalid bearer token"
      )
    })

    it('fails when the CLI exits non-zero', () => {
      writeFileSync(join(bin, 'exit'), '3')

      const result = probe({ CLAUDE_TOKEN_SOURCE: 'login' })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain("the CLI's stored login probe failed (exit 3)")
    })

    it('says so when a token is set as well, since the CLI then uses the token', () => {
      const result = probe({ CLAUDE_TOKEN_SOURCE: 'login', CLAUDE_CODE_OAUTH_TOKEN: TOKEN })

      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain(
        '::notice::CLAUDE_TOKEN_SOURCE=login, but CLAUDE_CODE_OAUTH_TOKEN is set'
      )
    })
  })

  it('refuses a source it does not know, without a request', () => {
    const result = probe({ CLAUDE_TOKEN_SOURCE: 'keychain', CLAUDE_CODE_OAUTH_TOKEN: TOKEN })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("CLAUDE_TOKEN_SOURCE must be token or login, not 'keychain'")
    expect(calls()).toBe(0)
  })
})
