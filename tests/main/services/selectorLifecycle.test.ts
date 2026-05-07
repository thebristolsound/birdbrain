import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  initDatabase,
  closeDatabase,
  createCase,
  insertCapture,
  getSelectorMatchCounts,
  getCapturesMatchingSelectors,
  listSelectors
} from '@main/services/database'
import { initStorage } from '@main/services/storage'
import { createSelectorLifecycle, type RematchedEvent } from '@main/services/selectorLifecycle'

function writeTxt(root: string, caseId: string, captureId: string, text: string): void {
  const dir = join(root, caseId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${captureId}.txt`), text, 'utf-8')
}

async function waitFor(
  events: RematchedEvent[],
  expected: number,
  timeoutMs = 2000
): Promise<void> {
  const start = Date.now()
  while (events.length < expected) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${expected} events; got ${events.length}`)
    }
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

describe('selectorLifecycle', () => {
  let tempDir: string
  let events: RematchedEvent[]
  let lifecycle: ReturnType<typeof createSelectorLifecycle>

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-selector-lifecycle-'))
    initStorage(tempDir)
    initDatabase(':memory:')
    events = []
    lifecycle = createSelectorLifecycle({
      emitRematched: (e) => events.push(e)
    })
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('createSelector', () => {
    it('returns the persisted Selector synchronously', async () => {
      const c = createCase({ name: 'C' })
      const sel = lifecycle.createSelector({ caseId: c.id, pattern: 'alpha' })

      expect(sel.id).toBeDefined()
      expect(sel.pattern).toBe('alpha')
      expect(listSelectors(c.id)).toHaveLength(1)
      // Drain the scheduled async match so it doesn't leak into the next test
      await waitFor(events, 1)
    })

    it('does not write Persisted Matches before async work runs', async () => {
      const c = createCase({ name: 'C' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://a',
        title: 'A',
        hash: 'h1',
        timestamp: new Date().toISOString()
      })
      writeTxt(tempDir, c.id, cap.id, 'this contains alpha somewhere')

      const sel = lifecycle.createSelector({ caseId: c.id, pattern: 'alpha' })

      // Sync read: matches haven't happened yet
      expect(getSelectorMatchCounts(c.id)[sel.id] ?? 0).toBe(0)

      // Drain the scheduled async match so it doesn't leak into the next test
      await waitFor(events, 1)
    })

    it('matches against existing Capture txt files asynchronously', async () => {
      const c = createCase({ name: 'C' })
      const cap1 = insertCapture({
        caseId: c.id,
        url: 'https://a',
        title: 'A',
        hash: 'h1',
        timestamp: new Date().toISOString()
      })
      const cap2 = insertCapture({
        caseId: c.id,
        url: 'https://b',
        title: 'B',
        hash: 'h2',
        timestamp: new Date().toISOString()
      })
      writeTxt(tempDir, c.id, cap1.id, 'this contains ALPHA somewhere')
      writeTxt(tempDir, c.id, cap2.id, 'no match here')

      const sel = lifecycle.createSelector({ caseId: c.id, pattern: 'alpha' })
      await waitFor(events, 1)

      expect(events).toEqual([{ selectorId: sel.id, caseId: c.id, status: 'done' }])
      const matched = getCapturesMatchingSelectors(c.id, [sel.id])
      expect(matched).toEqual([cap1.id])
    })

    it('falls back to FTS content when txt file is missing', async () => {
      const c = createCase({ name: 'C' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://a',
        title: 'A',
        hash: 'h1',
        timestamp: new Date().toISOString(),
        textContent: 'mhtml-only body referencing beta tokens'
      })
      // Note: no writeTxt — only FTS has the text

      const sel = lifecycle.createSelector({ caseId: c.id, pattern: 'beta' })
      await waitFor(events, 1)

      expect(getCapturesMatchingSelectors(c.id, [sel.id])).toEqual([cap.id])
    })

    it('matches case-insensitively for non-regex patterns', async () => {
      const c = createCase({ name: 'C' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://a',
        title: 'A',
        hash: 'h1',
        timestamp: new Date().toISOString()
      })
      writeTxt(tempDir, c.id, cap.id, 'Mixed CASE Alpha Pattern')

      const sel = lifecycle.createSelector({ caseId: c.id, pattern: 'alpha' })
      await waitFor(events, 1)

      expect(getCapturesMatchingSelectors(c.id, [sel.id])).toEqual([cap.id])
    })

    it('matches regex patterns', async () => {
      const c = createCase({ name: 'C' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://a',
        title: 'A',
        hash: 'h1',
        timestamp: new Date().toISOString()
      })
      writeTxt(tempDir, c.id, cap.id, 'order #12345 confirmed')

      const sel = lifecycle.createSelector({
        caseId: c.id,
        pattern: '#\\d{5}',
        isRegex: true
      })
      await waitFor(events, 1)

      expect(getCapturesMatchingSelectors(c.id, [sel.id])).toEqual([cap.id])
    })

    it('emits done even when the case has no captures', async () => {
      const c = createCase({ name: 'C' })
      const sel = lifecycle.createSelector({ caseId: c.id, pattern: 'alpha' })
      await waitFor(events, 1)

      expect(events).toEqual([{ selectorId: sel.id, caseId: c.id, status: 'done' }])
    })
  })

  describe('bulkCreateSelectors', () => {
    it('persists all rows synchronously and matches them against captures in one pass', async () => {
      const c = createCase({ name: 'C' })
      const cap1 = insertCapture({
        caseId: c.id,
        url: 'https://a',
        title: 'A',
        hash: 'h1',
        timestamp: new Date().toISOString()
      })
      const cap2 = insertCapture({
        caseId: c.id,
        url: 'https://b',
        title: 'B',
        hash: 'h2',
        timestamp: new Date().toISOString()
      })
      writeTxt(tempDir, c.id, cap1.id, 'alpha appears here')
      writeTxt(tempDir, c.id, cap2.id, 'beta appears here')

      const created = lifecycle.bulkCreateSelectors({
        caseId: c.id,
        selectors: [
          { pattern: 'alpha', isRegex: false },
          { pattern: 'beta', isRegex: false },
          { pattern: 'gamma', isRegex: false }
        ]
      })

      expect(created).toHaveLength(3)
      await waitFor(events, 3)

      const counts = getSelectorMatchCounts(c.id)
      expect(counts[created[0].id]).toBe(1)
      expect(counts[created[1].id]).toBe(1)
      expect(counts[created[2].id] ?? 0).toBe(0)

      // Done event for each selector
      const ids = events.map((e) => e.selectorId).sort()
      expect(ids).toEqual(created.map((s) => s.id).sort())
      expect(events.every((e) => e.status === 'done')).toBe(true)
    })

    it('returns an empty array and emits no events when given no selectors', async () => {
      const c = createCase({ name: 'C' })
      insertCapture({
        caseId: c.id,
        url: 'https://a',
        title: 'A',
        hash: 'h1',
        timestamp: new Date().toISOString()
      })

      const created = lifecycle.bulkCreateSelectors({ caseId: c.id, selectors: [] })

      expect(created).toEqual([])
      // Drain a tick or two; nothing should arrive
      await new Promise<void>((r) => setImmediate(r))
      await new Promise<void>((r) => setImmediate(r))
      expect(events).toEqual([])
    })
  })

  describe('chunked retroactive matching', () => {
    it('processes more than one chunk worth of captures', async () => {
      const c = createCase({ name: 'C' })
      const captureIds: string[] = []
      // 75 captures > CHUNK_SIZE (50) — exercises the chunk-recursion path
      for (let i = 0; i < 75; i++) {
        const cap = insertCapture({
          caseId: c.id,
          url: `https://a${i}`,
          title: `A${i}`,
          hash: `h${i}`,
          timestamp: new Date().toISOString()
        })
        writeTxt(tempDir, c.id, cap.id, i % 3 === 0 ? 'has alpha here' : 'nothing')
        captureIds.push(cap.id)
      }

      const sel = lifecycle.createSelector({ caseId: c.id, pattern: 'alpha' })
      await waitFor(events, 1)

      const counts = getSelectorMatchCounts(c.id)
      expect(counts[sel.id]).toBe(Math.ceil(75 / 3))
    })
  })
})
