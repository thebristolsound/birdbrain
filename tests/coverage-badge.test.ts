import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createCoverageBadge,
  publishCoverageBadge,
  run
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../scripts/coverage-badge.mjs'

const sha = 'a'.repeat(40)
const env = {
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REPOSITORY: 'example/project',
  GITHUB_SHA: sha,
  GH_TOKEN: 'test-token',
  COVERAGE_LINES: JSON.stringify({ total: 8, covered: 7 })
}
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
  vi.unstubAllGlobals()
})

function mockApi(existing = false) {
  const responses = [
    { object: { sha } },
    existing
      ? [{ ref: 'refs/heads/coverage-badge', object: { sha: 'previous' } }]
      : [{ ref: 'refs/heads/coverage-badge-other', object: { sha: 'unrelated' } }],
    { sha: 'tree' },
    { sha: 'commit' },
    { ref: 'refs/heads/coverage-badge', object: { sha: 'commit' } }
  ]
  const request = vi.fn<(url: string, options: RequestInit) => Promise<Response>>()
  request.mockImplementation(async () => {
    const response = responses.shift()
    if (!response) throw new Error('Unexpected request')
    return new Response(JSON.stringify(response))
  })
  return request
}

describe('coverage badge measurement', () => {
  it('reports line coverage from counts, including zero and complete coverage', () => {
    expect(createCoverageBadge({ total: 3, covered: 2 })).toEqual({
      schemaVersion: 1,
      label: 'lines (main)',
      message: '66.67%',
      color: 'blue'
    })
    expect(createCoverageBadge({ total: 1, covered: 0 }).message).toBe('0.00%')
    expect(createCoverageBadge({ total: 1, covered: 1 }).message).toBe('100.00%')
  })

  it.each([
    undefined,
    {},
    { total: 0, covered: 0 },
    { total: -1, covered: 0 },
    { total: 10, covered: -1 },
    { total: 10, covered: 11 },
    { total: 10, covered: 1.5 },
    { total: 1.5, covered: 1 },
    { total: '10', covered: 5 },
    { total: 10, covered: NaN }
  ])('rejects unusable line counts: %j', (lines) => {
    expect(() => createCoverageBadge(lines)).toThrow('Coverage requires')
  })

  it('reads the line totals from the report and emits one workflow output', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'coverage-badge-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'summary.json')
    writeFileSync(path, JSON.stringify({ total: { lines: { total: 8, covered: 7, pct: 87.5 } } }))
    expect(await run(['measure', path])).toBe('lines={"total":8,"covered":7}')
    writeFileSync(path, JSON.stringify({ total: {} }))
    await expect(run(['measure', path])).rejects.toThrow('Coverage requires')
    writeFileSync(path, '{invalid')
    await expect(run(['measure', path])).rejects.toThrow()
  })

  it('rejects an unsupported command', async () => {
    await expect(run([])).rejects.toThrow('Usage:')
  })
})

describe('coverage publication', () => {
  it.each([
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_EVENT_NAME: 'workflow_dispatch' },
    { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_REPOSITORY: '' },
    { GITHUB_SHA: 'invalid' },
    { GH_TOKEN: '' },
    { COVERAGE_LINES: '{}' },
    { COVERAGE_LINES: 'invalid json' }
  ])('refuses invalid publication context before making requests: %j', async (overrides) => {
    const request = mockApi()
    await expect(publishCoverageBadge({ ...env, ...overrides }, request)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it('skips an old main run without making writes', async () => {
    const request = mockApi()
    request.mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'newer' } })))
    await expect(publishCoverageBadge(env, request)).resolves.toContain('Skipped')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][1].method).toBe('GET')
  })

  it('creates an orphan branch holding only the measured badge on the first run', async () => {
    const request = mockApi()
    vi.stubGlobal('fetch', request)
    await expect(run(['publish'], env)).resolves.toBe(`Published line coverage for ${sha}`)
    expect(request).toHaveBeenCalledTimes(5)
    expect(request.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/example/project/git/ref/heads/main'
    )
    const tree = JSON.parse(request.mock.calls[2][1].body as string)
    expect(tree.tree).toHaveLength(1)
    expect(tree.tree[0]).toMatchObject({ path: 'coverage.json', type: 'blob', mode: '100644' })
    expect(JSON.parse(tree.tree[0].content)).toEqual(createCoverageBadge({ total: 8, covered: 7 }))
    const commit = JSON.parse(request.mock.calls[3][1].body as string)
    expect(commit).toEqual({
      message: `chore(badges): update line coverage\n\nSource: ${sha}`,
      tree: 'tree',
      parents: []
    })
    expect(request.mock.calls[4][1].method).toBe('POST')
    expect(JSON.parse(request.mock.calls[4][1].body as string)).toEqual({
      ref: 'refs/heads/coverage-badge',
      sha: 'commit'
    })
  })

  it('updates an existing badge branch by fast-forward only', async () => {
    const request = mockApi(true)
    await publishCoverageBadge(env, request)
    expect(JSON.parse(request.mock.calls[3][1].body as string).parents).toEqual(['previous'])
    expect(request.mock.calls[4][0]).toBe(
      'https://api.github.com/repos/example/project/git/refs/heads/coverage-badge'
    )
    expect(request.mock.calls[4][1].method).toBe('PATCH')
    expect(JSON.parse(request.mock.calls[4][1].body as string)).toEqual({
      sha: 'commit',
      force: false
    })
  })

  it('does not treat an authorization failure as a missing badge branch', async () => {
    const request = mockApi()
    request.mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha } })))
    request.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    await expect(publishCoverageBadge(env, request)).rejects.toThrow('failed (403)')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('fails without force or retry if another writer updates the badge branch', async () => {
    const request = mockApi(true)
    const implementation = request.getMockImplementation()!
    request.mockImplementation(async (url, options) => {
      if (options.method === 'PATCH') return new Response('{}', { status: 422 })
      return implementation(url, options)
    })
    await expect(publishCoverageBadge(env, request)).rejects.toThrow('failed (422)')
    expect(request).toHaveBeenCalledTimes(5)
  })
})
