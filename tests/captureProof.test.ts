import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { gzipSync } from 'zlib'
import {
  compare,
  describeMhtml,
  describeRun,
  requireArtifacts,
  requireBothMethods
  // @ts-expect-error - skill script with no type declarations
} from '../.claude/skills/run-birdbrain/capture-proof.mjs'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

describe('requireBothMethods', () => {
  const background = { method: 'background' }
  const launched = { method: 'launched' }

  it('accepts one Capture of each method', () => {
    expect(requireBothMethods([background, launched], 'the run a')).toHaveLength(2)
  })

  it('refuses a run that lacks a method, repeats one, or holds another', () => {
    expect(() => requireBothMethods([launched], 'the run a')).toThrow(
      'the run a holds 0 background Captures, not one'
    )
    expect(() => requireBothMethods([background], 'the run a')).toThrow('0 launched Captures')
    expect(() => requireBothMethods([background, background, launched], 'the run a')).toThrow(
      '2 background Captures'
    )
    expect(() =>
      requireBothMethods([background, launched, { method: 'extension' }], 'the run a')
    ).toThrow('a Capture of a method other than background and launched')
    expect(() => requireBothMethods([], 'the run a')).toThrow('0 background Captures')
  })
})

describe('requireArtifacts', () => {
  let dir: string
  const files = { mhtml: 'page', png: 'image', txt: 'text', 'warc.gz': 'record', pdf: 'print' }
  const entry = (overrides: Record<string, unknown> = {}) => ({
    captureId: 'c1',
    method: 'background',
    contentHash: sha(files.mhtml),
    screenshotHash: sha(files.png),
    textHash: sha(files.txt),
    transactionRecordHash: sha(files['warc.gz']),
    pdfHash: sha(files.pdf),
    inventory: {
      screenshot: { present: true },
      transactionRecord: { present: true },
      pdf: { present: true }
    },
    ...overrides
  })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'capture-proof-'))
    for (const [ext, text] of Object.entries(files)) writeFileSync(join(dir, `c1.${ext}`), text)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('accepts a Capture whose files hash to what its entry signs', () => {
    expect(() => requireArtifacts(dir, entry(), 'the run a')).not.toThrow()
  })

  it.each(Object.keys(files))('refuses a missing %s file the entry declares', (ext) => {
    unlinkSync(join(dir, `c1.${ext}`))
    expect(() => requireArtifacts(dir, entry(), 'the run a')).toThrow(
      `the run a: the background Capture's ${ext} file is missing, and its entry declares one`
    )
  })

  it.each(Object.keys(files))('refuses a %s file that does not hash to the signed value', (ext) => {
    writeFileSync(join(dir, `c1.${ext}`), 'changed')
    expect(() => requireArtifacts(dir, entry(), 'the run a')).toThrow(
      `${ext} file does not hash to the value its entry signs`
    )
  })

  it('accepts a record and a PDF the inventory declares absent, and refuses them when there', () => {
    const absent = entry({
      transactionRecordHash: undefined,
      pdfHash: undefined,
      inventory: {
        screenshot: { present: true },
        transactionRecord: { present: false, reason: 'failed' },
        pdf: { present: false, reason: 'failed' }
      }
    })
    expect(() => requireArtifacts(dir, absent, 'the run a')).toThrow(
      'warc.gz file is there, and its entry declares none'
    )
    unlinkSync(join(dir, 'c1.warc.gz'))
    expect(() => requireArtifacts(dir, absent, 'the run a')).toThrow('pdf file is there')
    unlinkSync(join(dir, 'c1.pdf'))
    expect(() => requireArtifacts(dir, absent, 'the run a')).not.toThrow()
  })

  it('takes the text file as declared only when the entry signs a text hash', () => {
    const noText = entry({ textHash: undefined })
    expect(() => requireArtifacts(dir, noText, 'the run a')).toThrow(
      'txt file is there, and its entry declares none'
    )
    unlinkSync(join(dir, 'c1.txt'))
    expect(() => requireArtifacts(dir, noText, 'the run a')).not.toThrow()
  })

  it('refuses a declared file whose entry signs no hash', () => {
    expect(() => requireArtifacts(dir, entry({ pdfHash: undefined }), 'the run a')).toThrow(
      'pdf file does not hash to the value its entry signs'
    )
  })
})

describe('describeMhtml', () => {
  const mhtml = ({
    boundary = 'B1',
    date = 'Mon, 16 Nov 2026 19:03:14 GMT',
    frame = 'F1',
    encoding = 'quoted-printable',
    body = '<p>=41</p>'
  } = {}) =>
    Buffer.from(
      [
        'From: <Saved by Blink>',
        'Snapshot-Content-Location: http://127.0.0.1:29412/',
        'Subject: Capture proof page',
        `Date: ${date}`,
        'MIME-Version: 1.0',
        'Content-Type: multipart/related;',
        '\ttype="text/html";',
        `\tboundary="${boundary}"`,
        '',
        '',
        `--${boundary}`,
        'Content-Type: text/html',
        `Content-ID: <frame-${frame}@mhtml.blink>`,
        `Content-Transfer-Encoding: ${encoding}`,
        'Content-Location: http://127.0.0.1:29412/',
        '',
        body,
        `--${boundary}--`,
        ''
      ].join('\r\n'),
      'latin1'
    )

  it('names the page and each part by type, encoding, location and body digest', () => {
    expect(describeMhtml(mhtml())).toEqual({
      snapshot: 'http://127.0.0.1:29412/',
      subject: 'Capture proof page',
      parts: [`text/html quoted-printable http://127.0.0.1:29412/ ${sha('<p>=41</p>\r\n')}`]
    })
  })

  it('is the same for another boundary, date and frame id', () => {
    const other = mhtml({ boundary: 'B2', date: 'Tue, 17 Nov 2026 08:00:00 GMT', frame: 'F2' })
    expect(describeMhtml(other)).toEqual(describeMhtml(mhtml()))
  })

  it('differs when only the transfer encoding or only a body changes', () => {
    expect(describeMhtml(mhtml({ encoding: '8bit' }))).not.toEqual(describeMhtml(mhtml()))
    expect(describeMhtml(mhtml({ body: '<p>=42</p>' }))).not.toEqual(describeMhtml(mhtml()))
  })

  it('says so when the file is not multipart', () => {
    expect(describeMhtml(Buffer.from('plain text'))).toBe('no multipart boundary')
  })
})

describe('compare', () => {
  let out: string
  const log = vi.spyOn(console, 'log')

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'capture-proof-runs-'))
    log.mockImplementation(() => undefined)
  })

  afterEach(() => {
    rmSync(out, { recursive: true, force: true })
    log.mockReset()
  })

  const png = Buffer.alloc(24)
  png.writeUInt32BE(40, 16)
  png.writeUInt32BE(30, 20)

  // One run: a Case folder with one Capture per method. `id` stands for everything that differs
  // between two runs of the same build: the capture ids, the frame id and the MHTML boundary.
  const writeRun = (label: string, id: string, text = 'Capture proof') => {
    const dir = join(out, label, 'case')
    mkdirSync(dir, { recursive: true })
    const entries = ['background', 'launched'].map((method) => {
      const captureId = `${id}-${method}`
      const files: Record<string, Buffer> = {
        mhtml: Buffer.from(
          [
            'Snapshot-Content-Location: http://127.0.0.1:29412/',
            'Subject: Capture proof page',
            `Date: ${id}`,
            `Content-Type: multipart/related; boundary="B-${id}"`,
            '',
            '',
            `--B-${id}`,
            'Content-Type: text/html',
            `Content-ID: <frame-${id}@mhtml.blink>`,
            'Content-Transfer-Encoding: quoted-printable',
            'Content-Location: http://127.0.0.1:29412/',
            '',
            '<p>page</p>',
            `--B-${id}--`,
            ''
          ].join('\r\n'),
          'latin1'
        ),
        png,
        txt: Buffer.from(text),
        pdf: Buffer.from('%PDF-1.4 << /Type /Page >> << /Type /Pages >>'),
        'warc.gz': gzipSync(
          Buffer.from(
            [
              'WARC/1.1',
              'WARC-Type: warcinfo',
              `WARC-Record-ID: <urn:uuid:${id}>`,
              '',
              'software: Birdbrain',
              `capture-id: ${captureId}`,
              '',
              '',
              'WARC/1.1',
              'WARC-Type: response',
              'WARC-Target-URI: http://127.0.0.1:29412/',
              'WARC-Payload-Digest: sha256:aa',
              '',
              'HTTP/1.1 200 OK',
              'Content-Type: text/html',
              'Set-Cookie: sid=[replaced]',
              '',
              'body'
            ].join('\r\n'),
            'latin1'
          )
        )
      }
      for (const [ext, bytes] of Object.entries(files)) {
        writeFileSync(join(dir, `${captureId}.${ext}`), bytes)
      }
      const hash = (ext: string) => createHash('sha256').update(files[ext]).digest('hex')
      return {
        type: 'capture',
        captureId,
        method,
        schemaVersion: method === 'background' ? 6 : 7,
        url: 'http://127.0.0.1:29412/',
        httpStatus: 200,
        contentHash: hash('mhtml'),
        screenshotHash: hash('png'),
        textHash: hash('txt'),
        transactionRecordHash: hash('warc.gz'),
        pdfHash: hash('pdf'),
        boundTlsAbsent: 'not-https',
        inventory: {
          mhtml: {},
          screenshot: { present: true },
          transactionRecord: { present: true },
          pdf: { present: true, afterCollection: true }
        }
      }
    })
    const lines = [{ type: 'case' }, ...entries].map((entry) => JSON.stringify(entry))
    writeFileSync(join(dir, 'manifest.jsonl'), `${lines.join('\n')}\n`)
  }

  it('finds two runs identical when only ids, dates and boundaries differ', () => {
    writeRun('a', 'run-a')
    writeRun('b', 'run-b')
    expect(compare('a', 'b', { out })).toBe(0)
    expect(log.mock.calls.flat().join('\n')).toContain('background: IDENTICAL between a and b')
    expect(log.mock.calls.flat().join('\n')).toContain('launched: IDENTICAL between a and b')
  })

  it('describes each Capture by what the two builds must agree on', () => {
    writeRun('a', 'run-a')
    const { background } = describeRun(out, 'a')
    expect(background).toMatchObject({
      schemaVersion: 6,
      httpStatus: 200,
      boundTlsAbsent: 'not-https',
      pdfPages: 1,
      screenshot: { width: 40, height: 30 },
      text: 'Capture proof',
      recordHoldsCookieValue: false,
      recordHoldsPostBody: false
    })
    expect(background.records).toEqual([
      'warcinfo software: Birdbrain | capture-id: ID',
      'response HTTP/1.1 200 OK http://127.0.0.1:29412/ payload=sha256:aa ' +
        'headers=[content-type,set-cookie] Set-Cookie: sid=[replaced]'
    ])
    expect(JSON.parse(readFileSync(join(out, 'a.json'), 'utf8')).launched.schemaVersion).toBe(7)
  })

  it('exits 1 and names the field when one run wrote different text', () => {
    writeRun('a', 'run-a')
    writeRun('b', 'run-b', 'Another page')
    expect(compare('a', 'b', { out })).toBe(1)
    const printed = log.mock.calls.flat().join('\n')
    expect(printed).toContain('background: DIFFERENT between a and b')
    expect(printed).toContain('  text\n    a: "Capture proof"')
  })

  it('refuses a label that was never taken', () => {
    writeRun('a', 'run-a')
    expect(() => compare('a', 'missing', { out })).toThrow('no run labelled missing')
  })
})
