/**
 * Note-anchor resolution: text anchors against a capture's stored text
 * (schema v27), bound to the signed manifest rather than the `captures` DB
 * mirror (#234); and the `finding`/`selectorMatch` existence ladder.
 *
 * The property under test for text anchors is that resolution reports which
 * of several situations it is actually in. "Could not locate the passage" is
 * a claim about a page that has stored text; saying it about a capture that
 * never had any, one whose stored text failed its digest, or one whose
 * manifest cannot be trusted, would be a false statement dressed as a careful
 * one.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { createCaptureStore, type CaptureStore } from '@main/services/captureStore'
import { initManifest, appendManifestEntry } from '@main/services/manifest'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture, getCaptureTextContent } from '@main/services/db/captureRepo'
import { resolveTextAnchor, resolveSelectorMatchAnchor } from '@main/services/noteAnchorResolver'
import type { TextAnchor } from '@shared/noteAnchor'

const PAGE = 'the sum was transferred on 4 April to an account in Riga.'

function sha256(text: string | Buffer): string {
  const buf = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf-8')
  return createHash('sha256').update(buf).digest('hex')
}

function anchor(over: Partial<TextAnchor> = {}): TextAnchor {
  return {
    kind: 'text',
    captureId: 'cap-1',
    quote: 'transferred on 4 April',
    prefix: 'the sum was ',
    suffix: ' to an account',
    textOffset: PAGE.indexOf('transferred'),
    ...over
  }
}

describe('resolveTextAnchor', () => {
  let tempDir: string
  let store: CaptureStore

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-anchor-'))
    store = createCaptureStore({ getRoot: () => tempDir })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  // Appends a `capture` manifest entry for case-1/cap-1 (or the ids given)
  // and returns its index -- the value `target()` needs. A caller that wants
  // an entry with NO textHash field (the manifest-side equivalent of a
  // pre-#118 capture) omits `textHash` from `over`.
  const CONTENT_HASH = 'a'.repeat(64)

  function seedManifestEntry(
    over: { caseId?: string; captureId?: string; textHash?: string; contentHash?: string } = {}
  ): number {
    const caseId = over.caseId ?? 'case-1'
    const captureId = over.captureId ?? 'cap-1'
    const caseDir = store.caseDir(caseId)
    mkdirSync(caseDir, { recursive: true })
    initManifest(caseDir)
    const result = appendManifestEntry(caseDir, {
      type: 'capture',
      captureId,
      caseId,
      url: 'https://example.com',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentHash: over.contentHash ?? CONTENT_HASH,
      ...(over.textHash !== undefined ? { textHash: over.textHash } : {}),
      sizeBytes: 100,
      operatorId: 'op-1',
      operatorName: 'Operator',
      toolVersion: '0.1.0'
    })
    return result.index
  }

  function target(
    over: Partial<{ id: string; caseId: string; contentHash: string; manifestIndex?: number }> = {}
  ) {
    return { id: 'cap-1', caseId: 'case-1', contentHash: CONTENT_HASH, manifestIndex: 0, ...over }
  }

  it('resolves a passage in an intact sidecar', () => {
    seedManifestEntry({ textHash: sha256(PAGE) })
    store.writeText('case-1', 'cap-1', PAGE)

    const result = resolveTextAnchor(target(), anchor(), store)

    expect(result).toEqual({
      status: 'resolved',
      via: 'offset',
      offset: PAGE.indexOf('transferred'),
      basis: 'hash-verified'
    })
  })

  it('repairs a stale offset against the stored text', () => {
    const shifted = 'A preamble. ' + PAGE
    seedManifestEntry({ textHash: sha256(shifted) })
    store.writeText('case-1', 'cap-1', shifted)

    const result = resolveTextAnchor(target(), anchor(), store)

    expect(result).toMatchObject({ status: 'resolved', via: 'quote' })
  })

  it('reports unresolved when the stored text no longer contains the passage', () => {
    const rewritten = 'This page was rewritten and says nothing of the kind.'
    seedManifestEntry({ textHash: sha256(rewritten) })
    store.writeText('case-1', 'cap-1', rewritten)

    const result = resolveTextAnchor(target(), anchor(), store)

    expect(result).toEqual({ status: 'unresolved', basis: 'hash-verified' })
  })

  it('distinguishes a capture that never had stored text from one that lost the passage', () => {
    // No manifest at all (this capture predates the chain), and no .txt
    // sidecar exists either.
    const result = resolveTextAnchor(target({ manifestIndex: undefined }), anchor(), store)

    expect(result).toEqual({ status: 'no-stored-text' })
  })

  // A capture whose manifest entry carries no textHash -- either because it
  // predates the chain entirely (no manifestIndex) or because it was written
  // before #118 added the field to the entry schema. Its text is readable and
  // can be searched; what cannot be said is that it is the text that was
  // captured.
  describe('a capture whose manifest offers no text digest', () => {
    it('does not claim the capture has no stored text (no manifest at all)', () => {
      store.writeText('case-1', 'cap-1', PAGE)

      const result = resolveTextAnchor(target({ manifestIndex: undefined }), anchor(), store)

      expect(result.status).not.toBe('no-stored-text')
    })

    it('resolves the passage but marks the text unattested (no manifest at all)', () => {
      store.writeText('case-1', 'cap-1', PAGE)

      const result = resolveTextAnchor(target({ manifestIndex: undefined }), anchor(), store)

      expect(result).toEqual({
        status: 'resolved',
        via: 'offset',
        offset: PAGE.indexOf('transferred'),
        basis: 'unattested'
      })
    })

    it('carries the unattested basis onto an unresolved result too (no manifest at all)', () => {
      store.writeText('case-1', 'cap-1', 'This page says nothing of the kind.')

      const result = resolveTextAnchor(target({ manifestIndex: undefined }), anchor(), store)

      expect(result).toEqual({ status: 'unresolved', basis: 'unattested' })
    })

    it('resolves as unattested against an entry that exists but carries no textHash', () => {
      seedManifestEntry() // no textHash field, mirroring a pre-#118 entry
      store.writeText('case-1', 'cap-1', PAGE)

      const result = resolveTextAnchor(target(), anchor(), store)

      expect(result).toEqual({
        status: 'resolved',
        via: 'offset',
        offset: PAGE.indexOf('transferred'),
        basis: 'unattested'
      })
    })
  })

  // Deleting a capture sets notes.capture_id to NULL but cannot reach the
  // captureId inside anchor_json. The answer is to report the gap, not to
  // scrub the anchor: a note whose evidence was deleted must still record
  // that it cited something.
  it('reports a missing capture as its own outcome, not as a lost passage', () => {
    const result = resolveTextAnchor(null, anchor(), store)

    expect(result).toEqual({ status: 'capture-missing' })
  })

  it('does not confuse a missing capture with a capture that has no text', () => {
    const missing = resolveTextAnchor(null, anchor(), store)
    const textless = resolveTextAnchor(target({ manifestIndex: undefined }), anchor(), store)

    expect(missing.status).toBe('capture-missing')
    expect(textless.status).toBe('no-stored-text')
  })

  it('reports an integrity failure when the recorded sidecar is missing', () => {
    // The manifest entry says text was stored; the file is not there.
    seedManifestEntry({ textHash: sha256(PAGE) })

    const result = resolveTextAnchor(target(), anchor(), store)

    expect(result).toMatchObject({ status: 'integrity-failed', reason: 'missing' })
  })

  it('refuses to resolve against bytes that fail their recorded digest', () => {
    // The tampered text still contains the quote, so a resolver that skipped
    // the digest check would happily report "resolved" and manufacture a
    // citation into content that failed verification.
    seedManifestEntry({ textHash: sha256(PAGE) })
    const tampered = 'the sum was transferred on 4 April to an account in Tallinn.'
    store.writeText('case-1', 'cap-1', tampered)

    const result = resolveTextAnchor(target(), anchor(), store)

    expect(result).toMatchObject({ status: 'integrity-failed', reason: 'digest-mismatch' })
    expect(result.status).not.toBe('resolved')
  })

  // #234 AC#5: a manifest that cannot be trusted is reported distinctly, not
  // folded into 'unattested' (which is a true statement about a capture that
  // was simply never hashed).
  describe('when the manifest cannot be trusted', () => {
    it('reports chain-invalid when the chain itself does not verify', () => {
      seedManifestEntry({ textHash: sha256(PAGE) })
      store.writeText('case-1', 'cap-1', PAGE)
      // Corrupt the manifest so its hash chain no longer recomputes.
      const manifestPath = join(store.caseDir('case-1'), 'manifest.jsonl')
      const lines = readFileSync(manifestPath, 'utf-8')
        .split('\n')
        .filter((l) => l.trim())
      const entry = JSON.parse(lines[0]) as Record<string, unknown>
      entry.url = 'https://tampered.example.com'
      writeFileSync(manifestPath, JSON.stringify(entry) + '\n', 'utf-8')

      const result = resolveTextAnchor(target(), anchor(), store)

      expect(result).toEqual({ status: 'integrity-failed', reason: 'chain-invalid' })
    })

    it('reports chain-invalid when manifestIndex names an entry the verified chain lacks', () => {
      seedManifestEntry({ textHash: sha256(PAGE) }) // writes index 0
      store.writeText('case-1', 'cap-1', PAGE)

      // A manifestIndex the (validly-empty-past-index-0) chain never reached.
      const result = resolveTextAnchor(target({ manifestIndex: 5 }), anchor(), store)

      expect(result).toEqual({ status: 'integrity-failed', reason: 'chain-invalid' })
    })

    // A verified chain entry is not, by itself, a binding to THIS capture: an
    // index that resolves is necessary but not sufficient. If `manifestIndex`
    // were reassigned to another capture's own valid entry (a coordinated
    // DB/manifestIndex edit), and the sidecar swapped to match that entry's
    // recorded text, a resolver that trusted the index alone would report
    // `hash-verified` for evidence that was never this capture's.
    it('reports chain-invalid when manifestIndex resolves to a DIFFERENT capture entry', () => {
      seedManifestEntry({ captureId: 'cap-1', contentHash: 'a'.repeat(64), textHash: sha256(PAGE) })
      const otherIndex = seedManifestEntry({
        captureId: 'cap-2',
        contentHash: 'b'.repeat(64),
        textHash: sha256(PAGE)
      })
      store.writeText('case-1', 'cap-1', PAGE)

      // cap-1's own hash is 'a'.repeat(64); manifestIndex has been swapped to
      // cap-2's entry, whose contentHash is 'b'.repeat(64).
      const result = resolveTextAnchor(
        target({ contentHash: 'a'.repeat(64), manifestIndex: otherIndex }),
        anchor(),
        store
      )

      expect(result).toEqual({ status: 'integrity-failed', reason: 'chain-invalid' })
    })

    // A legacy pre-chain capture (no manifestIndex) has no entry to bind to
    // either way, so chain validity is irrelevant to ITS resolution — an
    // unrelated corrupted entry belonging to some OTHER capture in the same
    // case's manifest must not fail it. Without the ordering fix, chain
    // verification runs before the manifestIndex check and wrongly reports
    // chain-invalid here instead of falling through to the unattested path.
    it('resolves a legacy no-manifestIndex capture as unattested even when the case manifest has an unrelated corrupted entry', () => {
      seedManifestEntry({ captureId: 'cap-2', textHash: sha256(PAGE) })
      const manifestPath = join(store.caseDir('case-1'), 'manifest.jsonl')
      const lines = readFileSync(manifestPath, 'utf-8')
        .split('\n')
        .filter((l) => l.trim())
      const entry = JSON.parse(lines[0]) as Record<string, unknown>
      entry.url = 'https://tampered.example.com'
      writeFileSync(manifestPath, JSON.stringify(entry) + '\n', 'utf-8')

      store.writeText('case-1', 'cap-1', PAGE)

      const result = resolveTextAnchor(target({ manifestIndex: undefined }), anchor(), store)

      expect(result).toEqual({
        status: 'resolved',
        via: 'offset',
        offset: PAGE.indexOf('transferred'),
        basis: 'unattested'
      })
    })
  })

  // #234: the defect being closed. `captures.text_hash` is a DB mirror
  // (migrations.ts:369) with no chain integrity of its own; resolution must
  // bind to the SIGNED manifest entry, not to it. This is proven, not just
  // asserted, by giving the two DIFFERENT values and confirming the manifest
  // one wins -- a resolver that read the mirror would report the opposite.
  describe('when the sidecar AND the DB mirror are edited together, away from the manifest', () => {
    beforeEach(() => initDatabase(':memory:'))
    afterEach(() => closeDatabase())

    it('follows the manifest digest, not a mirror edited to match the tampered sidecar', () => {
      const original = PAGE
      const tampered = 'the sum was transferred on 4 April to an account in Tallinn.'
      const caseId = createCase({ name: 'C', description: '', type: 'custom' }).id
      const cap = insertCapture({
        caseId,
        url: 'https://x.example',
        title: 'T',
        hash: 'h',
        timestamp: '2026-01-01T00:00:00Z',
        textContent: original,
        textHash: sha256(original), // starts in agreement with the manifest
        format: 'mhtml'
      })
      const manifestIndex = seedManifestEntry({
        caseId,
        captureId: cap.id,
        contentHash: cap.hash,
        textHash: sha256(original)
      })
      store.writeText(caseId, cap.id, original)

      // Attacker (or bug) edits the sidecar AND the mirror together, so the
      // two agree with EACH OTHER but not with the untouched manifest entry.
      store.writeText(caseId, cap.id, tampered)
      getDb()
        .prepare('UPDATE captures SET text_hash = ? WHERE id = ?')
        .run(sha256(tampered), cap.id)
      // Fixture check: the mirror really did move, and the two DB copies
      // really do disagree (capture_texts still holds the untouched search
      // copy) -- otherwise this test would not be exercising anything.
      expect(getCaptureTextContent(cap.id)).toBe(original)

      const result = resolveTextAnchor(
        { id: cap.id, caseId, contentHash: cap.hash, manifestIndex },
        anchor({ captureId: cap.id }),
        store
      )

      expect(result).toMatchObject({ status: 'integrity-failed', reason: 'digest-mismatch' })
    })
  })
})

describe('resolveSelectorMatchAnchor', () => {
  it('resolves when both the capture and the selector still exist', () => {
    const result = resolveSelectorMatchAnchor({ captureExists: true, selectorExists: true })

    expect(result).toEqual({ status: 'resolved' })
  })

  it('reports capture-missing when the capture is gone, even if the selector survives', () => {
    const result = resolveSelectorMatchAnchor({ captureExists: false, selectorExists: true })

    expect(result).toEqual({ status: 'capture-missing' })
  })

  // #234 item 3: the gap `capture-missing` names, for the OTHER id a
  // selector-match anchor embeds. Checked only once the capture itself is
  // confirmed present, so a capture-missing anchor is never also reported as
  // selector-missing.
  it('reports selector-missing when the selector is gone but the capture survives', () => {
    const result = resolveSelectorMatchAnchor({ captureExists: true, selectorExists: false })

    expect(result).toEqual({ status: 'selector-missing' })
  })

  it('reports capture-missing, not selector-missing, when both are gone', () => {
    const result = resolveSelectorMatchAnchor({ captureExists: false, selectorExists: false })

    expect(result).toEqual({ status: 'capture-missing' })
  })
})
