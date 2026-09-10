import { describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { resolve } from 'path'

const SCRIPT = resolve(__dirname, '..', 'scripts', 'exploratory-harness.mjs')

// `--window-size` is validated before the harness looks for the built app, so these cases run
// without one and never launch Electron. resolveWindowSize's own bounds are asserted in
// tests/main/windowSize.test.ts; what is pinned here is that the CLI refuses a request the app
// would silently answer with a default-sized window — whose realized size the harness then
// explains with a cause that is not the real one (#516).
const runServe = (...args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, 'serve', ...args], { encoding: 'utf8' })

describe('exploratory-harness serve --window-size', () => {
  it('refuses a size above the maximum the app honours', () => {
    const { status, stderr } = runServe('--window-size', '20000x20000')
    expect(status).toBe(1)
    expect(stderr).toContain("--window-size 20000x20000 is above the app's 10000x10000 maximum")
  })

  it('refuses one pixel over that maximum', () => {
    const { status, stderr } = runServe('--window-size', '10001x600')
    expect(status).toBe(1)
    expect(stderr).toContain("--window-size 10001x600 is above the app's 10000x10000 maximum")
  })

  it('refuses a size below the minimum the app honours', () => {
    const { status, stderr } = runServe('--window-size', '899x600')
    expect(status).toBe(1)
    expect(stderr).toContain("--window-size 899x600 is below the app's 900x600 minimum")
  })
})
