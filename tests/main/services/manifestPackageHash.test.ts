import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MANIFEST_FILENAME } from '@shared/constants'
import {
  createArtifactAccumulator,
  getManifestHead,
  head,
  packageHash,
  readEntries
} from '@main/services/manifest'
import type { PackagedArtifact } from '@main/services/manifest'

// Known-answer test for the packageHash recipe (#201). The recipe is the
// evidentiary surface: every evidence .zip and .birdbrain archive records a
// packageHash computed exactly this way, and archive inspection recomputes it
// to detect tampering. The literals below were derived OFFLINE (hand-built
// canonical JSON + sha256), not by running packageHash — any change to the
// sort order, the canonical serialization, or the digest breaks this test and
// with it backward verification of existing evidence packages.

const ARTIFACTS: PackagedArtifact[] = [
  { path: 'report.html', sha256: 'b'.repeat(64), sizeBytes: 2048 },
  { path: 'manifest.jsonl', sha256: 'a'.repeat(64), sizeBytes: 512 },
  { path: 'pages/cap-1.mhtml', sha256: 'c'.repeat(64), sizeBytes: 123456 }
]

// canonicalStringify of ARTIFACTS sorted by path: keys sorted (path < sha256 <
// sizeBytes), no whitespace, integers in minimal form.
const EXPECTED_CANONICAL =
  '[' +
  `{"path":"manifest.jsonl","sha256":"${'a'.repeat(64)}","sizeBytes":512},` +
  `{"path":"pages/cap-1.mhtml","sha256":"${'c'.repeat(64)}","sizeBytes":123456},` +
  `{"path":"report.html","sha256":"${'b'.repeat(64)}","sizeBytes":2048}` +
  ']'

const KNOWN_ANSWER = 'ef76ee1dfe115dc5fe834c6a2cb857a850d3dfc9be2bde5ab1327fef30988bc4'

describe('packageHash known-answer test', () => {
  it('produces the pinned hash for a fixed artifact set', () => {
    expect(packageHash(ARTIFACTS)).toBe(KNOWN_ANSWER)
  })

  it('matches an independent derivation: sha256 of the hand-built canonical JSON', () => {
    const independent = createHash('sha256')
      .update(Buffer.from(EXPECTED_CANONICAL, 'utf-8'))
      .digest('hex')
    expect(independent).toBe(KNOWN_ANSWER)
  })

  it('sorts artifacts by path before hashing (input order is irrelevant)', () => {
    const reversed = [...ARTIFACTS].reverse()
    expect(packageHash(reversed)).toBe(KNOWN_ANSWER)
  })

  it('canonicalizes each artifact (property insertion order is irrelevant)', () => {
    const shuffledKeys: PackagedArtifact[] = ARTIFACTS.map(({ sizeBytes, sha256, path }) => ({
      sizeBytes,
      sha256,
      path
    }))
    expect(packageHash(shuffledKeys)).toBe(KNOWN_ANSWER)
  })

  it('does not mutate the caller-supplied artifact list', () => {
    const input = [...ARTIFACTS]
    packageHash(input)
    expect(input).toEqual(ARTIFACTS)
  })

  it('commits to every artifact field', () => {
    const renamed = [{ ...ARTIFACTS[0], path: 'report2.html' }, ARTIFACTS[1], ARTIFACTS[2]]
    const rehashed = [{ ...ARTIFACTS[0], sha256: 'd'.repeat(64) }, ARTIFACTS[1], ARTIFACTS[2]]
    const resized = [{ ...ARTIFACTS[0], sizeBytes: 2049 }, ARTIFACTS[1], ARTIFACTS[2]]
    for (const variant of [renamed, rehashed, resized]) {
      expect(packageHash(variant)).not.toBe(KNOWN_ANSWER)
    }
  })

  it('hashes an empty artifact list as sha256("[]")', () => {
    expect(packageHash([])).toBe('4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945')
  })
})

describe('createArtifactAccumulator', () => {
  it('records each added file into entries and artifacts and returns its sha256', () => {
    const { entries, artifacts, add } = createArtifactAccumulator()
    const digest = add('a.txt', 'hello')
    expect(digest).toBe(createHash('sha256').update(Buffer.from('hello', 'utf-8')).digest('hex'))
    expect(entries).toEqual([{ name: 'a.txt', data: Buffer.from('hello', 'utf-8') }])
    expect(artifacts).toEqual([{ path: 'a.txt', sha256: digest, sizeBytes: 5 }])
  })

  it('treats string and utf-8 Buffer input identically', () => {
    const acc = createArtifactAccumulator()
    expect(acc.add('s', 'héllo')).toBe(acc.add('b', Buffer.from('héllo', 'utf-8')))
    expect(acc.artifacts[0].sizeBytes).toBe(acc.artifacts[1].sizeBytes)
  })

  it('feeds packageHash the same recipe input the consumers build', () => {
    const { artifacts, add } = createArtifactAccumulator()
    add('manifest.jsonl', 'x')
    add('report.html', 'y')
    const sorted = [...artifacts].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    const canonical =
      '[' +
      sorted
        .map((a) => `{"path":"${a.path}","sha256":"${a.sha256}","sizeBytes":${a.sizeBytes}}`)
        .join(',') +
      ']'
    expect(packageHash(artifacts)).toBe(
      createHash('sha256').update(Buffer.from(canonical, 'utf-8')).digest('hex')
    )
  })
})

describe('readEntries / head (lenient reading dialect)', () => {
  it('parses JSONL lines, skipping blank lines and mapping unparseable lines to {}', () => {
    const jsonl = '{"index":0,"entryHash":"h0"}\n\nnot json\n{"index":2,"entryHash":"h2"}\n'
    expect(readEntries(jsonl)).toEqual([
      { index: 0, entryHash: 'h0' },
      {},
      { index: 2, entryHash: 'h2' }
    ])
  })

  it('returns [] for empty text', () => {
    expect(readEntries('')).toEqual([])
  })

  it('maps parseable non-object lines (null, arrays, scalars) to {}', () => {
    expect(readEntries('null\n[]\n"text"\n42\ntrue\n')).toEqual([{}, {}, {}, {}, {}])
  })

  it('head treats a non-object tail line as unreadable', () => {
    expect(head(readEntries('{"index":0,"entryHash":"h0"}\nnull\n'))).toBeNull()
  })

  it('head returns the last entry index + entryHash', () => {
    const entries = readEntries('{"index":0,"entryHash":"h0"}\n{"index":1,"entryHash":"h1"}\n')
    expect(head(entries)).toEqual({ index: 1, entryHash: 'h1' })
  })

  it('head is null for an empty manifest or an unreadable last line', () => {
    expect(head([])).toBeNull()
    expect(head(readEntries('{"index":0,"entryHash":"h0"}\nnot json\n'))).toBeNull()
  })
})

describe('getManifestHead (strict reading dialect)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'birdbrain-manifest-head-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const write = (text: string): void => writeFileSync(join(dir, MANIFEST_FILENAME), text)

  it('derives prevHash and nextIndex from a valid tail', () => {
    write('{"index":0,"entryHash":"h0"}\n{"index":1,"entryHash":"h1"}\n')
    expect(getManifestHead(dir)).toEqual({ prevHash: 'h1', nextIndex: 2 })
  })

  it('returns the empty head for a missing or empty manifest', () => {
    expect(getManifestHead(dir)).toEqual({ prevHash: '', nextIndex: 0 })
    write('')
    expect(getManifestHead(dir)).toEqual({ prevHash: '', nextIndex: 0 })
  })

  it('throws on an unparseable tail line instead of restarting the chain', () => {
    write('{"index":0,"entryHash":"h0"}\nnot json\n')
    expect(() => getManifestHead(dir)).toThrow()
  })

  it('throws on a parseable tail that is not an object', () => {
    for (const tail of ['null', '[]', '"text"', '42']) {
      write(`{"index":0,"entryHash":"h0"}\n${tail}\n`)
      expect(() => getManifestHead(dir)).toThrow('Invalid manifest tail entry')
    }
  })

  it('throws on a wrong-shaped tail instead of deriving garbage head metadata', () => {
    for (const tail of [
      '{"index":"0","entryHash":"h0"}',
      '{"index":-1,"entryHash":"h0"}',
      '{"index":0.5,"entryHash":"h0"}',
      '{"index":0,"entryHash":""}',
      '{"index":0,"entryHash":7}',
      '{"index":0}',
      '{"entryHash":"h0"}'
    ]) {
      write(tail + '\n')
      expect(() => getManifestHead(dir)).toThrow('Invalid manifest tail entry')
    }
  })

  // The head is read from the tail, not the whole file — every append calls
  // this, so a whole-file read made a case O(N^2) in its own capture count.
  // These cover the boundaries that a tail read introduces and a whole-file
  // read never had.
  it('reads the head of a large multi-entry manifest', () => {
    const entries = Array.from(
      { length: 20_000 },
      (_, i) => `{"index":${i},"entryHash":"${'h'.repeat(64)}${i}","pad":"${'x'.repeat(400)}"}`
    )
    write(entries.join('\n') + '\n')
    expect(getManifestHead(dir)).toEqual({
      prevHash: 'h'.repeat(64) + '19999',
      nextIndex: 20_000
    })
  })

  it('reads a final entry larger than one tail read', () => {
    // Forces the widening loop: the last line alone exceeds the 64 KB window.
    const fat = 'y'.repeat(200 * 1024)
    write(`{"index":0,"entryHash":"h0"}\n{"index":1,"entryHash":"h1","pad":"${fat}"}\n`)
    expect(getManifestHead(dir)).toEqual({ prevHash: 'h1', nextIndex: 2 })
  })

  it('skips blank and whitespace-only trailing lines', () => {
    write('{"index":0,"entryHash":"h0"}\n{"index":1,"entryHash":"h1"}\n\n   \n\n')
    expect(getManifestHead(dir)).toEqual({ prevHash: 'h1', nextIndex: 2 })
  })

  it('reads a final entry with no trailing newline', () => {
    write('{"index":0,"entryHash":"h0"}\n{"index":1,"entryHash":"h1"}')
    expect(getManifestHead(dir)).toEqual({ prevHash: 'h1', nextIndex: 2 })
  })

  it('returns the empty head for a manifest of only blank lines', () => {
    write('\n  \n\n')
    expect(getManifestHead(dir)).toEqual({ prevHash: '', nextIndex: 0 })
  })
})
