import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture } from '@main/services/db/captureRepo'
import {
  getSelectorMatchCounts,
  getCapturesMatchingSelectors,
  listSelectors
} from '@main/services/db/selectorRepo'
import { initStorage } from '@main/services/storage'
import { createSelectorLifecycle, RETRO_MAX_CAPTURES } from '@main/services/selectorLifecycle'
import type { SelectorRematchedEvent } from '@shared/ipc'

function writeTxt(root: string, caseId: string, captureId: string, text: string): void {
  const dir = join(root, caseId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${captureId}.txt`), text, 'utf-8')
}

async function waitFor(
  events: SelectorRematchedEvent[],
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
  let events: SelectorRematchedEvent[]
  let lifecycle: ReturnType<typeof createSelectorLifecycle>

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-selector-lifecycle-'))
    initStorage(tempDir)
    await initDatabase(':memory:')
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

    it('persists the origin it was given', async () => {
      const c = createCase({ name: 'C' })
      const sel = lifecycle.createSelector({ caseId: c.id, pattern: 'alpha', origin: 'capture' })

      expect(sel.origin).toBe('capture')
      expect(listSelectors(c.id)[0].origin).toBe('capture')
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

      expect(events).toEqual([{ selectorIds: [sel.id], caseId: c.id, status: 'done' }])
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

      expect(events).toEqual([{ selectorIds: [sel.id], caseId: c.id, status: 'done' }])
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
      await waitFor(events, 1)

      const counts = getSelectorMatchCounts(c.id)
      expect(counts[created[0].id]).toBe(1)
      expect(counts[created[1].id]).toBe(1)
      expect(counts[created[2].id] ?? 0).toBe(0)

      // One coalesced done event covering all three selectors
      expect(events).toHaveLength(1)
      expect([...events[0].selectorIds].sort()).toEqual(created.map((s) => s.id).sort())
      expect(events[0].status).toBe('done')
    })

    it('carries each item its own origin', async () => {
      const c = createCase({ name: 'C' })

      const created = lifecycle.bulkCreateSelectors({
        caseId: c.id,
        selectors: [
          { pattern: 'alpha', isRegex: false, origin: 'manual' },
          { pattern: 'beta', isRegex: false, origin: 'note' },
          { pattern: 'gamma', isRegex: false }
        ]
      })

      expect(created.map((s) => s.origin)).toEqual(['manual', 'note', undefined])
      await waitFor(events, 1)
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

  describe('updateSelector', () => {
    it('returns undefined for an unknown selector id', () => {
      expect(lifecycle.updateSelector({ id: 'does-not-exist', pattern: 'x' })).toBeUndefined()
    })

    it('clears stale matches and re-runs matching when pattern changes', async () => {
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
      writeTxt(tempDir, c.id, cap1.id, 'alpha here')
      writeTxt(tempDir, c.id, cap2.id, 'beta here')

      const sel = lifecycle.createSelector({ caseId: c.id, pattern: 'alpha' })
      await waitFor(events, 1)
      expect(getCapturesMatchingSelectors(c.id, [sel.id])).toEqual([cap1.id])

      const updated = lifecycle.updateSelector({ id: sel.id, pattern: 'beta' })
      expect(updated?.pattern).toBe('beta')
      await waitFor(events, 2)

      expect(events[1]).toEqual({ selectorIds: [sel.id], caseId: c.id, status: 'done' })
      expect(getCapturesMatchingSelectors(c.id, [sel.id])).toEqual([cap2.id])
    })

    it('clears stale matches and re-runs matching when isRegex changes', async () => {
      const c = createCase({ name: 'C' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://a',
        title: 'A',
        hash: 'h1',
        timestamp: new Date().toISOString()
      })
      writeTxt(tempDir, c.id, cap.id, 'order #12345 confirmed')

      // Literal "#\d{5}" never matches as a substring
      const sel = lifecycle.createSelector({
        caseId: c.id,
        pattern: '#\\d{5}',
        isRegex: false
      })
      await waitFor(events, 1)
      expect(getCapturesMatchingSelectors(c.id, [sel.id])).toEqual([])

      lifecycle.updateSelector({ id: sel.id, isRegex: true })
      await waitFor(events, 2)

      expect(getCapturesMatchingSelectors(c.id, [sel.id])).toEqual([cap.id])
    })

    it('does not clear matches or emit when only label changes', async () => {
      const c = createCase({ name: 'C' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://a',
        title: 'A',
        hash: 'h1',
        timestamp: new Date().toISOString()
      })
      writeTxt(tempDir, c.id, cap.id, 'alpha here')

      const sel = lifecycle.createSelector({ caseId: c.id, pattern: 'alpha' })
      await waitFor(events, 1)
      expect(getCapturesMatchingSelectors(c.id, [sel.id])).toEqual([cap.id])

      const updated = lifecycle.updateSelector({ id: sel.id, label: 'renamed' })
      expect(updated?.label).toBe('renamed')

      // Drain a couple of ticks; no rematch should fire
      await new Promise<void>((r) => setImmediate(r))
      await new Promise<void>((r) => setImmediate(r))
      expect(events).toHaveLength(1)

      // Existing matches are still there
      expect(getCapturesMatchingSelectors(c.id, [sel.id])).toEqual([cap.id])
    })

    it('re-matches all captures (not just the recent cap) when semantics change', async () => {
      const c = createCase({ name: 'C' })
      const total = RETRO_MAX_CAPTURES + 10
      const alphaInCap: string[] = []
      const betaBeyondCap: string[] = []

      // listCaptures is most-recent-first. Inserting in order with monotonically
      // increasing timestamps puts i=0..9 at the tail (beyond RETRO_MAX_CAPTURES).
      for (let i = 0; i < total; i++) {
        const cap = insertCapture({
          caseId: c.id,
          url: `https://a${i}`,
          title: `A${i}`,
          hash: `h${i}`,
          timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString()
        })
        let text: string
        if (i < 5) {
          // Beyond the cap: contains only the new pattern — won't be matched
          // in the capped first pass; must be matched after unbounded re-scan.
          text = 'has beta here'
          betaBeyondCap.push(cap.id)
        } else if (i >= 10 && i < 15) {
          // Inside the cap: contains only the old pattern — will be matched
          // initially; must be cleared after update.
          text = 'has alpha here'
          alphaInCap.push(cap.id)
        } else {
          text = 'nothing'
        }
        writeTxt(tempDir, c.id, cap.id, text)
      }

      const sel = lifecycle.createSelector({ caseId: c.id, pattern: 'alpha' })
      await waitFor(events, 1)
      expect(getCapturesMatchingSelectors(c.id, [sel.id]).sort()).toEqual(alphaInCap.sort())

      lifecycle.updateSelector({ id: sel.id, pattern: 'beta' })
      await waitFor(events, 2)

      // After unbounded re-scan: stale alpha matches are gone, beta captures
      // beyond the cap are now matched.
      expect(getCapturesMatchingSelectors(c.id, [sel.id]).sort()).toEqual(betaBeyondCap.sort())
    })

    it('does not clear matches or emit when only enabled changes', async () => {
      const c = createCase({ name: 'C' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://a',
        title: 'A',
        hash: 'h1',
        timestamp: new Date().toISOString()
      })
      writeTxt(tempDir, c.id, cap.id, 'alpha here')

      const sel = lifecycle.createSelector({ caseId: c.id, pattern: 'alpha' })
      await waitFor(events, 1)

      lifecycle.updateSelector({ id: sel.id, enabled: false })

      await new Promise<void>((r) => setImmediate(r))
      await new Promise<void>((r) => setImmediate(r))
      expect(events).toHaveLength(1)
      expect(getCapturesMatchingSelectors(c.id, [sel.id])).toEqual([cap.id])
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
