import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { spawnSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { gunzipSync, gzipSync } from 'zlib'
import { writeTransactionRecord } from '../src/packages/transaction-record/writer'
import {
  compare,
  describeMhtml,
  describeRecords,
  describeRun,
  requireArtifacts,
  requireBothMethods,
  requireLabel
  // @ts-expect-error - skill script with no type declarations
} from '../.claude/skills/run-birdbrain/capture-proof.mjs'

const SCRIPT = resolve(__dirname, '../.claude/skills/run-birdbrain/capture-proof.mjs')
const sha = (text: string) => createHash('sha256').update(text).digest('hex')

describe('requireLabel', () => {
  it('accepts a plain name', () => {
    for (const label of ['main', 'branch', 'v1.2.3', 'run_2', 'after-fix']) {
      expect(requireLabel(label)).toBe(label)
    }
  })

  it.each(['..', '../..', '.', '', 'a/b', '/tmp/a', 'a\\b', '.hidden', '-flag', 'a b'])(
    'refuses %j, which is not a plain name',
    (label) => {
      expect(() => requireLabel(label)).toThrow(
        `the label ${JSON.stringify(label)} is not a plain name`
      )
    }
  )
})

describe('a label on the command line', () => {
  let base: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'capture-proof-take-'))
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('take refuses a label that names a folder outside the output folder, deleting nothing', () => {
    const outside = join(base, 'outside')
    const out = join(outside, 'proof', 'runs')
    const repo = join(base, 'repo')
    mkdirSync(out, { recursive: true })
    mkdirSync(repo)
    writeFileSync(join(outside, 'kept.txt'), 'kept')

    const run = spawnSync(
      process.execPath,
      [SCRIPT, 'take', '../..', '--repo', repo, '--out', out],
      { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
    )

    // The message alone: with DEBUG set the script prints the error's stack, which puts
    // `Error: ` before it.
    expect(run.stderr).toContain('the label "../.." is not a plain name')
    expect(run.status).toBe(1)
    expect(existsSync(join(outside, 'kept.txt'))).toBe(true)
  })

  // The check runs where the command line is read, so it has to cover every label of every
  // command: each of these would build a folder name from `../..` if its label went unchecked.
  it.each(['compare ../.. b', 'compare a ../..', 'verify ../..'])('refuses `%s`', (command) => {
    const out = join(base, 'runs')
    mkdirSync(out)
    const run = spawnSync(
      process.execPath,
      [SCRIPT, ...command.split(' '), '--repo', base, '--out', out],
      { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
    )
    expect(run.stderr).toContain('the label "../.." is not a plain name')
    expect(run.status).toBe(1)
  })
})

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

  // A file it cannot read part by part is refused: one description for every unreadable file
  // would make two different pages compare as identical.
  const text = (edit: (page: string) => string) =>
    Buffer.from(edit(mhtml().toString('latin1')), 'latin1')

  it('refuses a file with no quoted boundary', () => {
    expect(() => describeMhtml(Buffer.from('plain text'), 'the page')).toThrow(
      'the page names no quoted multipart boundary, so its parts cannot be compared'
    )
    const unquoted = text((page) => page.replace('boundary="B1"', 'boundary=B1'))
    expect(() => describeMhtml(unquoted)).toThrow('names no quoted multipart boundary')
  })

  it('refuses a part with no blank line after its headers, as in a file of line feeds alone', () => {
    const lineFeeds = text((page) => page.replaceAll('\r\n', '\n'))
    expect(() => describeMhtml(lineFeeds)).toThrow(
      'has no blank line after the headers of part 1, so its parts cannot be compared'
    )
  })

  it('refuses a file that is cut short, holds no part, or has text after its end', () => {
    const cut = text((page) => page.replace('--B1--\r\n', ''))
    expect(() => describeMhtml(cut)).toThrow('does not end at its closing boundary')
    const trailing = text((page) => `${page}more`)
    expect(() => describeMhtml(trailing)).toThrow('does not end at its closing boundary')
    const empty = text((page) => `${page.slice(0, page.indexOf('--B1'))}--B1--\r\n`)
    expect(() => describeMhtml(empty)).toThrow('holds no part')
  })

  it.each(['Content-Type: text/html', 'Content-Transfer-Encoding: quoted-printable'])(
    'refuses a part without its %s line',
    (line) => {
      const without = text((page) => page.replace(`${line}\r\n`, ''))
      expect(without.length).toBeLessThan(mhtml().length)
      expect(() => describeMhtml(without)).toThrow(
        'names no type or no transfer encoding for part 1'
      )
    }
  )
})

describe('describeRecords', () => {
  const record = (...lines: string[]) => lines.join('\r\n')
  const info = record(
    'WARC/1.1',
    'WARC-Type: warcinfo',
    'WARC-Record-ID: <urn:uuid:1>',
    '',
    'software: Birdbrain',
    'capture-id: c1',
    '',
    ''
  )
  const response = record(
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
  )

  it('names each record by type, first line, address, payload digest and header names', () => {
    expect(describeRecords(info + response)).toEqual([
      'warcinfo software: Birdbrain | capture-id: ID',
      'response HTTP/1.1 200 OK http://127.0.0.1:29412/ payload=sha256:aa ' +
        'headers=[content-type,set-cookie] Set-Cookie: sid=[replaced]'
    ])
  })

  it('reads a record the app wrote: every record has a type and none is refused', async () => {
    const url = 'http://127.0.0.1:29412/'
    const { bytes } = await writeTransactionRecord({
      exchanges: [
        {
          requestId: 'r1',
          hop: 0,
          state: 'complete',
          complete: true,
          startedAt: '2026-10-11T20:47:45.500Z',
          request: { method: 'GET', url, headers: { Accept: '*/*', Cookie: 'sid=1' } },
          response: {
            url,
            status: 200,
            statusText: 'OK',
            mimeType: 'text/html',
            remoteIPAddress: '127.0.0.1',
            headers: { 'Content-Type': 'text/html' }
          },
          responseBody: { data: '<p>page</p>', base64Encoded: false }
        }
      ],
      captureId: 'c1',
      birdbrainVersion: '1.0.0',
      browserVersion: 'Chrome/146.0.7680.65',
      userAgent: 'Mozilla/5.0',
      egress: 'direct',
      date: '2026-10-11T20:47:46.000Z'
    })
    const described = describeRecords(gunzipSync(bytes).toString('latin1'))
    expect(described.map((line: string) => line.split(' ')[0])).toEqual([
      'warcinfo',
      'request',
      'response'
    ])
    expect(described.join('\n')).toContain(`GET / HTTP/1.1 ${url}`)
  })

  it.each([
    ['empty text', ''],
    ['text that is no WARC record', 'abc'],
    ['text before the first record', `abc\r\n${info}`]
  ])('refuses %s', (_name, text) => {
    expect(() => describeRecords(text)).toThrow(
      'the transaction record does not start with a WARC record, so its records cannot be compared'
    )
  })

  it('refuses a record with no blank line after its headers', () => {
    expect(() => describeRecords(`${info}WARC/1.1\r\nWARC-Type: response`)).toThrow(
      'has no blank line after the headers of record 2'
    )
  })

  it('refuses a record whose WARC headers run into the HTTP block with no blank line', () => {
    const joined = (cookie: string) =>
      info +
      record(
        'WARC/1.1',
        'WARC-Type: response',
        'HTTP/1.1 200 OK',
        `Set-Cookie: sid=${cookie}`,
        '',
        'body'
      )
    for (const cookie of ['a', 'b']) {
      expect(() => describeRecords(joined(cookie))).toThrow(
        'has a line that is no WARC header among the headers of record 2'
      )
    }
  })

  it('refuses a warcinfo record whose WARC headers run into its fields with no blank line', () => {
    for (const software of ['Birdbrain 1.0.0', 'Birdbrain 1.1.0']) {
      const joined = record(
        'WARC/1.1',
        'WARC-Type: warcinfo',
        'Content-Type: application/warc-fields',
        `software: ${software}`,
        'capture-id: c1',
        '',
        ''
      )
      expect(() => describeRecords(joined + response)).toThrow(
        'has a line that is no WARC header among the headers of record 1'
      )
    }
  })

  it('refuses a record that names no type', () => {
    const untyped = record('WARC/1.1', 'WARC-Record-ID: <urn:uuid:2>', '', 'body')
    expect(() => describeRecords(info + untyped)).toThrow('names no type for record 2')
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
  // `page` is the stored page's body; `quote` and `eol` are how the MHTML names its boundary
  // and ends its lines, which Chromium writes as a quoted value and CRLF.
  const writeRun = (
    label: string,
    id: string,
    {
      text = 'Capture proof',
      page = '<p>page</p>',
      quote = '"',
      eol = '\r\n',
      record = undefined as Buffer | undefined
    } = {}
  ) => {
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
            `Content-Type: multipart/related; boundary=${quote}B-${id}${quote}`,
            '',
            '',
            `--B-${id}`,
            'Content-Type: text/html',
            `Content-ID: <frame-${id}@mhtml.blink>`,
            'Content-Transfer-Encoding: quoted-printable',
            'Content-Location: http://127.0.0.1:29412/',
            '',
            page,
            `--B-${id}--`,
            ''
          ].join(eol),
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
      if (record) files['warc.gz'] = record
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
    writeRun('b', 'run-b', { text: 'Another page' })
    expect(compare('a', 'b', { out })).toBe(1)
    const printed = log.mock.calls.flat().join('\n')
    expect(printed).toContain('background: DIFFERENT between a and b')
    expect(printed).toContain('  text\n    a: "Capture proof"')
  })

  it('exits 1 and names the MHTML when one run stored another page', () => {
    writeRun('a', 'run-a')
    writeRun('b', 'run-b', { page: '<p>another page</p>' })
    expect(compare('a', 'b', { out })).toBe(1)
    const printed = log.mock.calls.flat().join('\n')
    expect(printed).toContain('launched: DIFFERENT between a and b')
    expect(printed).toContain('  mhtml\n    a: {"snapshot":"http://127.0.0.1:29412/"')
  })

  // Two runs whose stored pages differ, in an MHTML the description cannot read part by part.
  // Every file still hashes to what its entry signs, so only the comparison can refuse them.
  it.each([
    ['an unquoted boundary', { quote: '' }, 'names no quoted multipart boundary'],
    ['line feeds alone', { eol: '\n' }, 'has no blank line after the headers of part 1']
  ])('refuses two runs whose MHTML has %s, and does not find them identical', (_, shape, why) => {
    writeRun('a', 'run-a', { ...shape, page: '<p>one page</p>' })
    writeRun('b', 'run-b', { ...shape, page: '<p>another page</p>' })
    expect(() => compare('a', 'b', { out })).toThrow(
      `the run a: the background Capture's mhtml file ${why}, so its parts cannot be compared`
    )
    expect(log.mock.calls.flat().join('\n')).not.toContain('IDENTICAL')
  })

  // The two refusals below are also tested on their own above. These go through `compare`, so
  // taking either call out of `describeRun` fails here: two runs that lack the same thing
  // describe alike.
  const entriesOf = (label: string) => {
    const file = join(out, label, 'case', 'manifest.jsonl')
    const entries = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    return { file, entries }
  }

  it('refuses two runs that both lack the launched Capture', () => {
    for (const label of ['a', 'b']) {
      writeRun(label, `run-${label}`)
      const { file, entries } = entriesOf(label)
      const kept = entries.filter((entry) => entry.method !== 'launched')
      writeFileSync(file, `${kept.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
    }
    expect(() => compare('a', 'b', { out })).toThrow('the run a holds 0 launched Captures, not one')
  })

  it('refuses two runs that both lost a file their entries declare', () => {
    for (const label of ['a', 'b']) {
      writeRun(label, `run-${label}`)
      unlinkSync(join(out, label, 'case', `run-${label}-launched.pdf`))
    }
    expect(() => compare('a', 'b', { out })).toThrow(
      "the run a: the launched Capture's pdf file is missing, and its entry declares one"
    )
  })

  it('refuses two runs whose stored text was changed alike after its entry signed it', () => {
    for (const label of ['a', 'b']) {
      writeRun(label, `run-${label}`)
      writeFileSync(join(out, label, 'case', `run-${label}-background.txt`), 'changed')
    }
    expect(() => compare('a', 'b', { out })).toThrow(
      "the run a: the background Capture's txt file does not hash to the value its entry signs"
    )
  })

  it('refuses two runs whose transaction records are both empty', () => {
    for (const label of ['a', 'b']) {
      writeRun(label, `run-${label}`, { record: gzipSync(Buffer.alloc(0)) })
    }
    expect(() => compare('a', 'b', { out })).toThrow(
      "the run a: the background Capture's warc.gz file does not start with a WARC record"
    )
  })

  it('describes a Capture whose entry declares no transaction record with no records', () => {
    for (const label of ['a', 'b']) {
      writeRun(label, `run-${label}`)
      unlinkSync(join(out, label, 'case', `run-${label}-launched.warc.gz`))
      const { file, entries } = entriesOf(label)
      for (const entry of entries) {
        if (entry.method !== 'launched') continue
        entry.inventory.transactionRecord = { present: false }
        delete entry.transactionRecordHash
      }
      writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
    }
    const { background, launched } = describeRun(out, 'a')
    expect(launched).toMatchObject({
      records: null,
      recordHoldsCookieValue: null,
      recordHoldsPostBody: null
    })
    expect(background.records).toHaveLength(2)
    expect(compare('a', 'b', { out })).toBe(0)
  })

  it('refuses a label that was never taken', () => {
    writeRun('a', 'run-a')
    expect(() => compare('a', 'missing', { out })).toThrow('no run labelled missing')
  })
})
