import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { ESLint } from 'eslint'

// ESLint loads the whole configuration and the TypeScript parser on first use,
// which takes seconds when other sessions share the cores.
vi.setConfig({ testTimeout: 60_000 })

const REPO = join(__dirname, '..')
const RULE = 'no-restricted-syntax'

// The lines of `code` the repository's own configuration reports the rule on,
// as if the code sat at `file`.
async function restrictedLines(code: string, file: string): Promise<number[]> {
  const eslint = new ESLint({ cwd: REPO })
  const [result] = await eslint.lintText(code, { filePath: join(REPO, file) })
  return result.messages.filter((message) => message.ruleId === RULE).map((message) => message.line)
}

// A refused invoke call rejects at the raw bridge with a plain object, so the
// renderer has to make it through `birdbrain` (src/renderer/lib/birdbrain.ts).
// This rule is what keeps a call from going around it.
describe('the raw bridge lint rule', () => {
  const CODE = [
    'void window.birdbrain.cases.list()',
    "void window.birdbrain.search('c', 'q')",
    'const api = window.birdbrain',
    "void (globalThis as unknown as { birdbrain: Window['birdbrain'] }).birdbrain.app.getVersion()",
    'const { cases } = window.birdbrain',
    "void window['birdbrain'].cases.list()",
    'const { birdbrain: raw } = window',
    'window.birdbrain.onNewCapture(() => {})',
    'void [api, cases, raw]'
  ].join('\n')

  it('fails every direct reference to the raw bridge except a subscription', async () => {
    expect(await restrictedLines(CODE, 'src/renderer/components/Probe.ts')).toEqual([
      1, 2, 3, 4, 5, 6, 7
    ])
  })

  it('leaves the adapter module, which binds the raw bridge, alone', async () => {
    expect(await restrictedLines(CODE, 'src/renderer/lib/birdbrain.ts')).toEqual([])
  })

  it('applies to the renderer only', async () => {
    expect(await restrictedLines(CODE, 'e2e/probe.spec.ts')).toEqual([])
  })
})
