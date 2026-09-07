import { describe, expect, it } from 'vitest'
import {
  USAGE,
  main,
  parseArgs,
  runChecks
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/slop-audit/cli.mjs'

type Finding = {
  id: string
  severity: string
  file: string
  line: number
  message: string
  section: string
}

type Ctx = {
  root: string
  files: { path: string; kind: string; role: string | null }[]
  reported: Set<string>
  read: (path: string) => string
  packageJson: { name: string }
}

type Check = { id: string; section: string; run: (ctx: Ctx) => Finding[] }

const tree: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'fixture', dependencies: {} }),
  'src/main/a.ts': 'export const a = 1\n',
  'tests/a.test.ts': "it('x', () => {})\n"
}

const harness = (over: Record<string, unknown> = {}) => {
  const out: string[] = []
  const err: string[] = []
  const deps = {
    root: '/fixture',
    checks: [] as Check[],
    listFiles: () => Object.keys(tree),
    listChanged: () => ['src/main/a.ts'],
    info: () => ({ commit: 'abc123', dirty: false }),
    read: (path: string) => {
      if (!(path in tree)) throw new Error(`no such file ${path}`)
      return tree[path]
    },
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
    ...over
  }
  return { out, err, deps }
}

const flagEverything = (id: string, severity: string): Check => ({
  id,
  section: '0',
  run: (ctx) =>
    ctx.files
      .filter((f) => f.kind === 'code')
      .map((f) => ({ id, severity, file: f.path, line: 1, message: 'flagged', section: '0' }))
})

describe('parseArgs', () => {
  it('defaults to a plain advisory run over the whole tree', () => {
    expect(parseArgs([])).toEqual({ json: false, strict: false, changedSince: null, paths: [] })
  })

  it('reads every flag, with --path repeatable', () => {
    expect(
      parseArgs([
        '--json',
        '--strict',
        '--changed-since',
        'origin/main',
        '--path',
        'src/**',
        '--path',
        'e2e/**'
      ])
    ).toEqual({
      json: true,
      strict: true,
      changedSince: 'origin/main',
      paths: ['src/**', 'e2e/**']
    })
  })

  it('rejects a flag without its value', () => {
    expect(() => parseArgs(['--changed-since'])).toThrow('--changed-since needs a value')
    expect(() => parseArgs(['--path', '--json'])).toThrow('--path needs a value')
  })

  it('rejects an unknown argument and prints usage', () => {
    expect(() => parseArgs(['--adapter', 'jscpd'])).toThrow('unknown argument "--adapter"')
    expect(() => parseArgs(['--adapter'])).toThrow(USAGE)
  })
})

describe('runChecks', () => {
  it("concatenates every check's findings in registry order", () => {
    const ctx = { files: [{ path: 'src/a.ts', kind: 'code', role: 'source' }] } as unknown as Ctx
    const findings = runChecks({
      checks: [flagEverything('b.check', 'advisory'), flagEverything('a.check', 'blocking')],
      ctx
    })
    expect(findings.map((f: Finding) => f.id)).toEqual(['b.check', 'a.check'])
  })

  it('names the check that threw', () => {
    const broken: Check = {
      id: 'x.broken',
      section: '0',
      run: () => {
        throw new Error('boom')
      }
    }
    expect(() => runChecks({ checks: [broken], ctx: {} as Ctx })).toThrow(
      'check x.broken failed: boom'
    )
  })
})

describe('main', () => {
  it('exits 0 and prints an empty envelope when no checks are registered', () => {
    const { out, err, deps } = harness()
    expect(main(['--json'], deps)).toBe(0)
    expect(err).toEqual([])
    const envelope = JSON.parse(out.join('\n'))
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      commit: 'abc123',
      dirty: false,
      adapters: [],
      findings: [],
      skipped: [],
      stale: [],
      counts: { blocking: 0, advisory: 0 }
    })
  })

  it('prints the text report by default', () => {
    const { out, deps } = harness()
    expect(main([], deps)).toBe(0)
    expect(out.join('\n')).toBe('slop-audit: abc123\nslop-audit: 0 blocking, 0 advisory')
  })

  it('hands every check the shared ctx', () => {
    let seen: Ctx | null = null
    const spy: Check = {
      id: 'x.spy',
      section: '0',
      run: (ctx) => {
        seen = ctx
        return []
      }
    }
    const { deps } = harness({ checks: [spy] })
    expect(main([], deps)).toBe(0)
    expect(seen).not.toBeNull()
    expect(seen!.root).toBe('/fixture')
    expect(seen!.packageJson.name).toBe('fixture')
    expect(seen!.files.map((f) => f.path)).toEqual([
      'package.json',
      'src/main/a.ts',
      'tests/a.test.ts'
    ])
    expect([...seen!.reported]).toEqual(['package.json', 'src/main/a.ts', 'tests/a.test.ts'])
    expect(seen!.read('src/main/a.ts')).toBe('export const a = 1\n')
  })

  it('exits 1 under --strict when a blocking finding exists, 0 otherwise', () => {
    const blocking = flagEverything('x.block', 'blocking')
    expect(main(['--strict'], harness({ checks: [blocking] }).deps)).toBe(1)
    expect(main([], harness({ checks: [blocking] }).deps)).toBe(0)
    const advisory = flagEverything('x.advise', 'advisory')
    expect(main(['--strict'], harness({ checks: [advisory] }).deps)).toBe(0)
  })

  it('reports only changed files under --changed-since, while checks still see all', () => {
    let seenCount = 0
    const counting: Check = {
      ...flagEverything('x.all', 'advisory'),
      run: (ctx) => {
        seenCount = ctx.files.length
        return flagEverything('x.all', 'advisory').run(ctx)
      }
    }
    const { out, deps } = harness({ checks: [counting] })
    expect(main(['--json', '--changed-since', 'origin/main'], deps)).toBe(0)
    const envelope = JSON.parse(out.join('\n'))
    expect(seenCount).toBe(3)
    expect(envelope.findings.map((f: Finding) => f.file)).toEqual(['src/main/a.ts'])
  })

  it('exits 2 on an unknown argument', () => {
    const { err, deps } = harness()
    expect(main(['--adapter', 'jscpd'], deps)).toBe(2)
    expect(err[0]).toContain('slop-audit: unknown argument "--adapter"')
  })

  it('exits 2 when git facts cannot be read', () => {
    const { err, deps } = harness({
      info: () => {
        throw new Error('fatal: not a git repository')
      }
    })
    expect(main([], deps)).toBe(2)
    expect(err).toEqual(['slop-audit: fatal: not a git repository'])
  })

  it('exits 2 when package.json cannot be read', () => {
    const { err, deps } = harness({
      read: () => {
        throw new Error("ENOENT: no such file or directory, open 'package.json'")
      }
    })
    expect(main([], deps)).toBe(2)
    expect(err[0]).toContain('slop-audit: ENOENT')
  })

  it('exits 2 when a check throws, naming the check', () => {
    const broken: Check = {
      id: 'x.broken',
      section: '0',
      run: () => {
        throw new Error('boom')
      }
    }
    const { err, deps } = harness({ checks: [broken] })
    expect(main([], deps)).toBe(2)
    expect(err).toEqual(['slop-audit: check x.broken failed: boom'])
  })
})
