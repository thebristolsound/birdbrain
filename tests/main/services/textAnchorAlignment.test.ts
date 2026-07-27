/**
 * The alignment text anchors depend on, pinned.
 *
 * A text anchor stores an offset into the capture's stored text. That offset
 * is taken from a selection the investigator makes in the viewer's Text tab,
 * and it is later searched by the resolver. The two are only meaningful
 * together: if the viewer displays one copy of the text and the resolver
 * searches another, every offset is wrong by however much the copies differ,
 * and nothing in a happy-path fixture would ever show it.
 *
 * There are two copies. `CAPTURES_GET_CONTENT` serves the Text tab via
 * `readArtifact(caseId, captureId, 'txt')` — the on-disk sidecar covered by
 * `captures.text_hash` — and `resolveTextAnchor` reads the same sidecar. That
 * agreement is what makes a selection offset usable, and it is load-bearing
 * rather than incidental: anyone switching the viewer to the `capture_texts`
 * row (the search copy, which looks identical in any healthy capture) would
 * silently desynchronise every anchor created afterwards.
 *
 * These tests fail if that ever changes.
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
import { buildTextAnchor } from '@shared/noteAnchor'

function sha256(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf-8')).digest('hex')
}

describe('text anchor offsets align between the viewer and the resolver', () => {
  let tempDir: string
  let store: CaptureStore

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-align-'))
    store = createCaptureStore({ getRoot: () => tempDir })
    initDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // The sidecar and the search copy are deliberately different lengths, so an
  // offset taken from one cannot accidentally be correct in the other.
  const SIDECAR = 'A much longer preamble here. the sum was transferred on 4 April to an account.'
  const SEARCH_COPY = 'Search copy: transferred on 4 April to an account.'

  function divergentCapture(): { captureId: string; caseId: string; textHash: string } {
    const caseId = createCase({ name: 'C', description: '', type: 'custom' }).id
    const cap = insertCapture({
      caseId,
      url: 'https://x.example',
      title: 'T',
      hash: 'h',
      timestamp: '2026-01-01T00:00:00Z',
      textContent: SEARCH_COPY,
      textHash: sha256(SIDECAR),
      format: 'mhtml'
    })
    store.writeText(caseId, cap.id, SIDECAR)
    return { captureId: cap.id, caseId, textHash: cap.textHash! }
  }

  /** What the Text tab shows: exactly what CAPTURES_GET_CONTENT returns for 'txt'. */
  function viewerText(caseId: string, captureId: string): string {
    const buffer = store.readArtifact(caseId, captureId, 'txt')
    return buffer!.toString('utf-8')
  }

  it('serves the Text tab the hashed sidecar, not the search copy', () => {
    const { captureId, caseId } = divergentCapture()

    expect(viewerText(caseId, captureId)).toBe(SIDECAR)
    // The fixture is only meaningful if the two copies really do differ.
    expect(getCaptureTextContent(captureId)).toBe(SEARCH_COPY)
  })

  it('resolves an anchor built from what the viewer displayed', () => {
    const { captureId, caseId, textHash } = divergentCapture()
    const shown = viewerText(caseId, captureId)
    const start = shown.indexOf('transferred on 4 April')

    const anchor = buildTextAnchor({
      text: shown,
      start,
      end: start + 'transferred on 4 April'.length,
      captureId
    })

    expect(resolveTextAnchor({ id: captureId, caseId, textHash }, anchor, store)).toEqual({
      status: 'resolved',
      via: 'offset',
      offset: start,
      basis: 'hash-verified'
    })
  })

  // This is the regression the file exists for. If the viewer were ever
  // switched to capture_texts, anchors would be built against these offsets.
  it('would not resolve at the offset if anchors were built from the search copy', () => {
    const { captureId, caseId, textHash } = divergentCapture()
    const start = SEARCH_COPY.indexOf('transferred on 4 April')

    const anchor = buildTextAnchor({
      text: SEARCH_COPY,
      start,
      end: start + 'transferred on 4 April'.length,
      captureId
    })

    const result = resolveTextAnchor({ id: captureId, caseId, textHash }, anchor, store)

    // It still resolves -- by falling back to the unique-quote rung -- but at
    // a different offset than the one recorded, and only because this quote
    // happens to be unique. That is the silent corruption: the citation looks
    // fine and points somewhere the investigator never selected.
    expect(result).not.toMatchObject({ via: 'offset' })
    expect(result).toMatchObject({ via: 'quote', offset: SIDECAR.indexOf('transferred') })
    expect(SIDECAR.indexOf('transferred')).not.toBe(start)
  })

  it('round-trips every offset in the document', () => {
    const { captureId, caseId, textHash } = divergentCapture()
    const shown = viewerText(caseId, captureId)

    // Walk the whole document in windows, so an off-by-one anywhere in the
    // builder or the resolver shows up rather than hiding between samples.
    for (let start = 0; start + 12 <= shown.length; start += 3) {
      const anchor = buildTextAnchor({ text: shown, start, end: start + 12, captureId })
      if (anchor.quote.trim().length === 0) continue

      expect(resolveTextAnchor({ id: captureId, caseId, textHash }, anchor, store)).toMatchObject({
        status: 'resolved',
        via: 'offset',
        offset: start
      })
    }
  })
})
