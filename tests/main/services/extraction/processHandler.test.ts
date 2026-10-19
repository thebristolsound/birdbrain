import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import * as dataExtractor from '@main/services/dataExtractor'
import * as fieldExtractor from '@main/services/search/fieldExtractor'
import { handleExtractionMessage } from '@main/services/extraction/processHandler'
import {
  FIXTURE_DIR,
  FIXTURE_KNOWN_ANSWERS,
  rowKeys
} from '../../../helpers/extractionKnownAnswers'

describe('handleExtractionMessage', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'birdbrain-extraction-handler-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  for (const [fixture, expected] of Object.entries(FIXTURE_KNOWN_ANSWERS)) {
    it(`returns the known rows for ${fixture}`, () => {
      const reply = handleExtractionMessage({
        id: 7,
        mhtmlPath: join(FIXTURE_DIR, fixture),
        htmlPath: join(dir, 'absent.html')
      })
      if (!reply.ok) throw new Error(`extraction failed: ${reply.error.message}`)
      expect(reply.id).toBe(7)
      expect(rowKeys(reply.rows)).toEqual(expected)
      expect(reply.durationMs).toBeGreaterThan(0)
    })
  }

  it('reads a legacy Capture from its .html file when there is no MHTML', () => {
    const htmlPath = join(dir, 'legacy.html')
    writeFileSync(htmlPath, '<html><body>write to wren@desk.example.net</body></html>')
    const reply = handleExtractionMessage({ id: 1, mhtmlPath: join(dir, 'none.mhtml'), htmlPath })
    expect(reply).toMatchObject({ ok: true })
    expect(reply.ok && rowKeys(reply.rows)).toEqual([
      'Infrastructure|Domain Reference|desk.example.net',
      'Infrastructure|Email Address|wren@desk.example.net'
    ])
  })

  it('prefers the MHTML when both files exist', () => {
    const htmlPath = join(dir, 'legacy.html')
    writeFileSync(htmlPath, '<html><body>write to wren@desk.example.net</body></html>')
    const reply = handleExtractionMessage({
      id: 1,
      mhtmlPath: join(FIXTURE_DIR, 'cnn-iran-synthetic.mhtml'),
      htmlPath
    })
    expect(reply.ok && rowKeys(reply.rows)).toEqual(
      FIXTURE_KNOWN_ANSWERS['cnn-iran-synthetic.mhtml']
    )
  })

  it('builds Case search fields in the utility process', () => {
    const mhtmlPath = join(dir, 'page.mhtml')
    const textPath = join(dir, 'page.txt')
    const url = 'https://quillmere.example.net/page'
    writeFileSync(
      mhtmlPath,
      [
        'MIME-Version: 1.0',
        'Content-Type: multipart/related; type="text/html"; boundary="B"',
        '',
        '--B',
        'Content-Type: text/html',
        `Content-Location: ${url}`,
        '',
        '<a href="/contact">Contact</a>',
        '--B--',
        ''
      ].join('\r\n')
    )
    writeFileSync(
      textPath,
      'From: Wren <wren@quillmere.example.net>\nMessage-ID: <1@quillmere.example.net>\n'
    )

    const reply = handleExtractionMessage({
      id: 5,
      mhtmlPath,
      htmlPath: join(dir, 'absent.html'),
      fieldUrl: url,
      textPath
    })

    expect(reply.ok).toBe(true)
    if (!reply.ok || !reply.fieldBuild?.ok) throw new Error('field build failed')
    expect(reply.fieldBuild.result).toMatchObject({
      outcome: 'built',
      textHash: expect.any(String),
      fields: expect.arrayContaining([
        expect.objectContaining({ field: 'link.href', value: '/contact' }),
        expect.objectContaining({ field: 'header.from', norm: 'wren@quillmere.example.net' })
      ])
    })
    expect(reply.fieldBuild.durationMs).toBeGreaterThan(0)
  })

  it('reports a no-source field build when neither file exists', () => {
    const reply = handleExtractionMessage({
      id: 8,
      mhtmlPath: join(dir, 'none.mhtml'),
      htmlPath: join(dir, 'none.html'),
      fieldUrl: 'https://quillmere.example.net/none',
      textPath: join(dir, 'none.txt')
    })
    expect(reply).toMatchObject({ id: 8, ok: true, rows: [] })
    expect(reply.fieldBuild).toEqual({
      ok: true,
      result: { fields: [], textHash: null, outcome: 'no-source', skippedJson: null },
      durationMs: expect.any(Number)
    })
  })

  it('reports a read failure as a failed field build too, with the same error', () => {
    const htmlPath = join(dir, 'a-directory.html')
    mkdirSync(htmlPath)
    const reply = handleExtractionMessage({
      id: 9,
      mhtmlPath: join(dir, 'none.mhtml'),
      htmlPath,
      fieldUrl: 'https://quillmere.example.net/dir'
    })
    expect(reply).toMatchObject({ id: 9, ok: false, error: { code: 'EISDIR' } })
    expect(reply.fieldBuild).toEqual({
      ok: false,
      error: { name: 'Error', code: 'EISDIR', message: expect.any(String) },
      durationMs: 0
    })
  })

  it('reports a field extractor throw as a failed build and keeps the extracted rows', () => {
    vi.spyOn(fieldExtractor, 'extractFields').mockImplementation(() => {
      throw new Error('field extractor broke')
    })
    const reply = handleExtractionMessage({
      id: 10,
      mhtmlPath: join(FIXTURE_DIR, 'cnn-pope-synthetic.mhtml'),
      htmlPath: join(dir, 'none.html'),
      fieldUrl: 'https://quillmere.example.net/pope'
    })
    if (!reply.ok) throw new Error(`extraction failed: ${reply.error.message}`)
    expect(rowKeys(reply.rows)).toEqual(FIXTURE_KNOWN_ANSWERS['cnn-pope-synthetic.mhtml'])
    expect(reply.fieldBuild).toEqual({
      ok: false,
      error: { name: 'Error', code: null, message: 'field extractor broke' },
      durationMs: expect.any(Number)
    })
  })

  it('answers with no rows, without extracting, when neither file exists', () => {
    const extract = vi.spyOn(dataExtractor, 'extractData')
    const reply = handleExtractionMessage({
      id: 2,
      mhtmlPath: join(dir, 'none.mhtml'),
      htmlPath: join(dir, 'none.html')
    })
    expect(reply).toMatchObject({ id: 2, ok: true, rows: [] })
    expect(extract).not.toHaveBeenCalled()
  })

  it('answers a read failure with the error name and errno code', () => {
    const htmlPath = join(dir, 'a-directory.html')
    mkdirSync(htmlPath)
    const reply = handleExtractionMessage({ id: 3, mhtmlPath: join(dir, 'none.mhtml'), htmlPath })
    expect(reply).toMatchObject({ id: 3, ok: false, error: { name: 'Error', code: 'EISDIR' } })
  })

  it('answers a non-Error throw with a generic error', () => {
    vi.spyOn(dataExtractor, 'extractData').mockImplementation(() => {
      throw 'not an Error'
    })
    const reply = handleExtractionMessage({
      id: 4,
      mhtmlPath: join(FIXTURE_DIR, 'cnn-pope-synthetic.mhtml'),
      htmlPath: join(dir, 'none.html')
    })
    expect(reply).toMatchObject({
      id: 4,
      ok: false,
      error: { name: 'Error', code: null, message: 'not an Error' }
    })
  })
})
