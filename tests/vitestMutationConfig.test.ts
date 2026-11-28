import { afterEach, describe, expect, it, vi } from 'vitest'

const TESTS_ENV = 'BIRDBRAIN_MUTATION_TESTS'

// The config reads the scope as it loads, so each case loads it afresh.
const includes = async (scope?: string): Promise<string[]> => {
  vi.resetModules()
  if (scope === undefined) vi.stubEnv(TESTS_ENV, undefined)
  else vi.stubEnv(TESTS_ENV, scope)
  const { default: config } = await import('../vitest.mutation.config')
  return config.test.projects.flatMap((project) => project.test.include)
}

describe('vitest.mutation.config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('scores against the tests under src/packages when no scope is set', async () => {
    const files = (await includes()).filter((file) => file !== 'no-test-in-mutation-scope')

    expect(files.length).toBeGreaterThan(0)
    expect(files.every((file) => file.startsWith('src/packages/'))).toBe(true)
    expect(files).not.toContain('src/packages/evidence-package-layout/tests/literalGuard.test.ts')
  })

  it('reads a path the same with a leading ./, a trailing slash or neither', async () => {
    const plain = await includes('tests/shared')

    expect(plain).toContain('tests/shared/noteDoc.test.ts')
    expect(plain.some((file) => file.startsWith('tests/main/'))).toBe(false)
    expect(await includes('./tests/shared/')).toEqual(plain)
  })

  it('narrows to the named files across a comma-separated list', async () => {
    const files = await includes('tests/shared/noteDoc.test.ts, tests/testMutation.test.ts')

    expect(files.filter((file) => file !== 'no-test-in-mutation-scope').sort()).toEqual([
      'tests/shared/noteDoc.test.ts',
      'tests/testMutation.test.ts'
    ])
  })

  it('refuses a path with no test under it, naming the path', async () => {
    await expect(
      includes('tests/shared/noteDoc.test.ts,tests/shared/missing.test.ts')
    ).rejects.toThrow('--tests matches no test file: tests/shared/missing.test.ts')
  })
})
