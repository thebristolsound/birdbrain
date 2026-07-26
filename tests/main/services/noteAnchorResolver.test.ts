/**
 * Text-anchor resolution against a capture's stored text (schema v27).
 *
 * The property under test is that resolution reports which of four situations
 * it is actually in. "Could not locate the passage" is a claim about a page
 * that has stored text; saying it about a capture that never had any, or about
 * bytes that failed their own digest, would be a false statement dressed as a
 * careful one.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { createCaptureStore, type CaptureStore } from '@main/services/captureStore'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture, getCaptureTextContent } from '@main/services/db/captureRepo'
import { resolveTextAnchor } from '@main/services/noteAnchorResolver'
import type { TextAnchor } from '@shared/noteAnchor'

const PAGE = 'the sum was transferred on 4 April to an account in Riga.'

function sha256(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf-8')).digest('hex')
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

  function target(over: Partial<{ id: string; caseId: string; textHash?: string }> = {}) {
    return { id: 'cap-1', caseId: 'case-1', textHash: sha256(PAGE), ...over }
  }

  it('resolves a passage in an intact sidecar', () => {
    store.writeText('case-1', 'cap-1', PAGE)

    const result = resolveTextAnchor(target(), anchor(), store)

    expect(result).toEqual({
      status: 'resolved',
      via: 'offset',
      offset: PAGE.indexOf('transferred')
    })
  })

  it('repairs a stale offset against the stored text', () => {
    const shifted = 'A preamble. ' + PAGE
    store.writeText('case-1', 'cap-1', shifted)

    const result = resolveTextAnchor(target({ textHash: sha256(shifted) }), anchor(), store)

    expect(result).toMatchObject({ status: 'resolved', via: 'quote' })
  })

  it('reports unresolved when the stored text no longer contains the passage', () => {
    const rewritten = 'This page was rewritten and says nothing of the kind.'
    store.writeText('case-1', 'cap-1', rewritten)

    const result = resolveTextAnchor(target({ textHash: sha256(rewritten) }), anchor(), store)

    expect(result).toEqual({ status: 'unresolved' })
  })

  it('distinguishes a capture that never had stored text from one that lost the passage', () => {
    // No textHash was recorded at ingest, so no .txt sidecar was ever written.
    const result = resolveTextAnchor(target({ textHash: undefined }), anchor(), store)

    expect(result).toEqual({ status: 'no-stored-text' })
  })

  it('reports an integrity failure when the recorded sidecar is missing', () => {
    // textHash says text was stored; the file is not there.
    const result = resolveTextAnchor(target(), anchor(), store)

    expect(result).toMatchObject({ status: 'integrity-failed', reason: 'missing' })
  })

  describe('when the two stored copies of the text disagree', () => {
    // A capture's text exists twice: the .txt sidecar covered by
    // captures.text_hash, and the capture_texts row that feeds search. They
    // agree in every healthy capture, so only a deliberately divergent fixture
    // can show which one resolution actually reads.
    beforeEach(() => initDatabase(':memory:'))
    afterEach(() => closeDatabase())

    it('follows the hashed sidecar, not the search copy', () => {
      const searchCopy = 'Search copy: transferred on 4 April to an account.'
      const sidecar =
        'A much longer preamble here. the sum was transferred on 4 April to an account.'
      const caseId = createCase({ name: 'C', description: '', type: 'custom' }).id
      const cap = insertCapture({
        caseId,
        url: 'https://x.example',
        title: 'T',
        hash: 'h',
        timestamp: '2026-01-01T00:00:00Z',
        textContent: searchCopy,
        textHash: sha256(sidecar),
        format: 'mhtml'
      })
      store.writeText(caseId, cap.id, sidecar)

      const result = resolveTextAnchor(
        { id: cap.id, caseId, textHash: cap.textHash },
        anchor({ captureId: cap.id }),
        store
      )

      // The fixture is only meaningful if the copies really do differ.
      expect(getCaptureTextContent(cap.id)).toBe(searchCopy)
      expect(sidecar.indexOf('transferred')).not.toBe(searchCopy.indexOf('transferred'))

      expect(result).toMatchObject({ offset: sidecar.indexOf('transferred') })
    })
  })

  it('refuses to resolve against bytes that fail their recorded digest', () => {
    // The tampered text still contains the quote, so a resolver that skipped
    // the digest check would happily report "resolved" and manufacture a
    // citation into content that failed verification.
    const tampered = 'the sum was transferred on 4 April to an account in Tallinn.'
    store.writeText('case-1', 'cap-1', tampered)

    const result = resolveTextAnchor(target({ textHash: sha256(PAGE) }), anchor(), store)

    expect(result).toMatchObject({ status: 'integrity-failed', reason: 'digest-mismatch' })
    expect(result.status).not.toBe('resolved')
  })
})
