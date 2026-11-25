import { describe, expect, it } from 'vitest'
import {
  DOCS_SIGNALS,
  PLAN_STATUSES,
  brokenLinks,
  linkTargets,
  planStatus,
  resolveLink
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/repo-health/lib/docs.mjs'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { Unmeasured } from '../../scripts/repo-health/lib/unmeasured.mjs'
import { ctxOf, signalOf } from './helpers'

const measure = (id: string, ctx: ReturnType<typeof ctxOf>) =>
  signalOf(DOCS_SIGNALS, id).measure(ctx)

describe('agent instruction drift', () => {
  it('is zero when the two files match', () => {
    const ctx = ctxOf({ 'CLAUDE.md': '# Rules\n\nOne\n', 'AGENTS.md': '# Rules\n\nOne\n' })
    expect(measure('agent-instruction-drift', ctx)).toEqual({ value: 0 })
  })

  it('counts the lines only one file holds, from both sides', () => {
    const ctx = ctxOf({
      'CLAUDE.md': '# Rules\n\nOne\nTwo\nThree\n',
      'AGENTS.md': '# Rules\n\nOne\nFour\n'
    })
    expect(measure('agent-instruction-drift', ctx)).toEqual({ value: 3 })
  })

  it('is not measured when either file is missing, which is not the same as matching', () => {
    const ctx = ctxOf({ 'CLAUDE.md': '# Rules\n' })
    expect(() => measure('agent-instruction-drift', ctx)).toThrow(Unmeasured)
    expect(() => measure('agent-instruction-drift', ctx)).toThrow(
      'CLAUDE.md or AGENTS.md could not be read'
    )
  })

  it('is not measured when either file is empty or only white space, even when both are', () => {
    const cases = [
      [{ 'CLAUDE.md': '', 'AGENTS.md': '' }, 'CLAUDE.md is empty'],
      [{ 'CLAUDE.md': ' \n\t\n', 'AGENTS.md': '\n' }, 'CLAUDE.md is empty'],
      [{ 'CLAUDE.md': '# Rules\n', 'AGENTS.md': '  \n' }, 'AGENTS.md is empty']
    ] as const
    for (const [files, reason] of cases) {
      const ctx = ctxOf(files)
      expect(() => measure('agent-instruction-drift', ctx)).toThrow(Unmeasured)
      expect(() => measure('agent-instruction-drift', ctx)).toThrow(reason)
    }
  })
})

describe('planStatus', () => {
  it('reads the first word of the status line, whatever its case or what follows', () => {
    expect(planStatus('# Plan\n\n**Status:** active\n')).toBe('active')
    expect(planStatus('# Plan\n**Status:** Active - waiting on review\n')).toBe('active')
    expect(planStatus('# Plan\n**Status:** done, merged as #12\n')).toBe('done')
    expect(planStatus('# Plan\n**Status:** parked.\n')).toBe('parked')
    expect(planStatus('# Plan\n**Status:** Approved\n')).toBe('approved')
  })

  it('returns null without the line, and an empty word for an empty or odd one', () => {
    expect(planStatus('# Plan\n\nStatus: active\n')).toBeNull()
    expect(planStatus('# Plan\n**Status endpoint**: /status\n')).toBeNull()
    expect(planStatus('# Plan\n**Status:**\n\nactive work below\n')).toBe('')
    expect(planStatus('# Plan\n**Status:** 2026-10-04 merged\n')).toBe('')
  })

  it('accepts the four values docs/README.md documents', () => {
    expect(PLAN_STATUSES).toEqual(['active', 'done', 'parked', 'abandoned'])
  })
})

describe('plans without a documented status', () => {
  it('counts plans with no status line or a value outside the documented four', () => {
    const ctx = ctxOf({
      'docs/plans/2026-01-01-a.md': '# A\n**Status:** active\n',
      'docs/plans/2026-01-02-b.md': '# B\n**Status:** Approved\n',
      'docs/plans/2026-01-03-c.md': '# C\n\nNo status here.\n',
      'docs/plans/2026-01-04-d.md': '# D\n**Status:** Parked 2026-02-01\n',
      'docs/plans/2026-01-05-e.md': '# E\n**Status:** abandoned\n',
      'docs/plans/2026-01-06-f.md': '# F\n**Status:**\n',
      'docs/plans/assets/notes.md': '# Not a plan\n',
      'docs/specs/2026-01-01-x-design.md': '# Spec\n'
    })
    expect(measure('plans-without-status', ctx)).toEqual({ value: 3, note: 'of 6 plan(s)' })
  })

  it('is not measured when it finds no plans, so a moved folder cannot read as zero', () => {
    const ctx = ctxOf({ 'docs/README.md': '# Docs\n' })
    expect(() => measure('plans-without-status', ctx)).toThrow(Unmeasured)
    expect(() => measure('plans-without-status', ctx)).toThrow('no plans were found')
  })
})

describe('linkTargets', () => {
  it('finds inline links and images, with a title or an angle wrapper', () => {
    const text = [
      'See [the guide](guide.md) and ![a shot](img/shot.png "Shot").',
      'Also [spaced](<my file.md>) and [escaped \\] bracket](other.md#part).'
    ].join('\n')
    expect(linkTargets(text)).toEqual(['guide.md', 'img/shot.png', 'my file.md', 'other.md#part'])
  })

  it('skips fenced blocks and inline code, which show links without making them', () => {
    const text = [
      'Write `[text](missing.md)` to link.',
      '```md',
      '[in a fence](also-missing.md)',
      '```',
      '~~~',
      '[in a tilde fence](still-missing.md)',
      '~~~',
      '[real](real.md)'
    ].join('\n')
    expect(linkTargets(text)).toEqual(['real.md'])
  })

  it('closes a fence only on a run of its own character at least as long, with nothing after', () => {
    const text = [
      '````md',
      '```',
      '[shown inside](inner-missing.md)',
      '```',
      '~~~~',
      '````js',
      '````',
      '[after the close](after.md)',
      '~~~',
      '[in a tilde fence](tilde-missing.md)',
      '~~',
      '~~~~',
      '[real](real.md)'
    ].join('\n')
    expect(linkTargets(text)).toEqual(['after.md', 'real.md'])
  })
})

describe('resolveLink', () => {
  it('resolves against the linking file, dropping the anchor and the query', () => {
    expect(resolveLink('docs/plans/a.md', '../adr/0001-x.md')).toBe('docs/adr/0001-x.md')
    expect(resolveLink('docs/plans/a.md', 'b.md#L56')).toBe('docs/plans/b.md')
    expect(resolveLink('docs/plans/a.md', './b.md?plain=1')).toBe('docs/plans/b.md')
    expect(resolveLink('README.md', 'docs/README.md')).toBe('docs/README.md')
    expect(resolveLink('docs/a.md', 'my%20file.md')).toBe('docs/my file.md')
  })

  it('resolves a leading slash from the repository root, and a folder without its slash', () => {
    expect(resolveLink('docs/plans/a.md', '/CONTEXT.md')).toBe('CONTEXT.md')
    expect(resolveLink('docs/plans/a.md', '../adr/')).toBe('docs/adr')
    expect(resolveLink('docs/a.md', './')).toBe('docs')
    expect(resolveLink('README.md', './')).toBe('.')
  })

  it('does not judge other sites, mail addresses or anchors on the same page', () => {
    expect(resolveLink('docs/a.md', 'https://example.com/x.md')).toBeNull()
    expect(resolveLink('docs/a.md', 'mailto:someone@example.com')).toBeNull()
    expect(resolveLink('docs/a.md', '//example.com/x')).toBeNull()
    expect(resolveLink('docs/a.md', '#section')).toBeNull()
    expect(resolveLink('docs/a.md', '?query')).toBeNull()
  })

  it('keeps a target with a malformed escape as written', () => {
    expect(resolveLink('docs/a.md', 'bad%E0%A4%A.md')).toBe('docs/bad%E0%A4%A.md')
  })

  it('leaves a path that climbs out of the repository pointing outside it', () => {
    expect(resolveLink('README.md', '../elsewhere/x.md')).toBe('../elsewhere/x.md')
  })
})

describe('broken relative links', () => {
  const tree = {
    'README.md': '[docs](docs/README.md) [gone](docs/gone.md) [site](https://example.com)\n',
    'docs/README.md': '[adr folder](adr/) [plan](plans/a.md#top) [root](../README.md)\n',
    'docs/adr/0001-x.md': '[code](../../src/main/a.ts) [outside](../../../other/x.md)\n',
    'docs/plans/a.md': '[self](#top) [missing code](src/main/a.ts#L5)\n',
    'docs/archive/old.md': '[dead](nowhere.md)\n',
    'docs/design-handoff/bundle.md': '[dead](nowhere.md)\n',
    'website/content/docs/page.md': '[dead](nowhere.md)\n',
    'src/main/a.ts': 'export const a = 1\n',
    'src/main/notes.md': '[dead](nowhere.md)\n'
  }

  it('reports links that resolve to no tracked file or folder', () => {
    expect(brokenLinks(ctxOf(tree))).toEqual([
      { from: 'README.md', target: 'docs/gone.md' },
      { from: 'docs/adr/0001-x.md', target: '../../../other/x.md' },
      { from: 'docs/plans/a.md', target: 'src/main/a.ts#L5' }
    ])
  })

  it('reports the count and one example', () => {
    expect(measure('broken-relative-links', ctxOf(tree))).toEqual({
      value: 3,
      note: 'for example `docs/gone.md` in `README.md`'
    })
  })

  it('has no example when nothing is broken', () => {
    const ctx = ctxOf({ 'README.md': '[docs](docs/a.md)\n', 'docs/a.md': '[up](../README.md)\n' })
    expect(measure('broken-relative-links', ctx)).toEqual({ value: 0, note: null })
  })

  it('is not measured when it finds no Markdown to scan', () => {
    const ctx = ctxOf({ 'src/main/a.ts': 'export const a = 1\n' })
    expect(() => measure('broken-relative-links', ctx)).toThrow(Unmeasured)
    expect(() => measure('broken-relative-links', ctx)).toThrow('no Markdown files were found')
  })
})
