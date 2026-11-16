import { describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import type { DerivedFile, DerivedFileVerification } from '@shared/types'
import {
  decidePackageContents,
  readOnce,
  type ExportForm,
  type PackageByteSource,
  type PackageContentsInput
} from '../index'
import { buildSyntheticToken } from '../../../../tests/helpers/timestampFixtures'

// The Package Contents decision, through its entry point and an in-memory byte source: no
// Case directory, no database, no zip.

const CASE = 'case-1'
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

interface MemorySource extends PackageByteSource {
  /** Every file the decision asked for, in order: a stored path, or `<captureId>.<type>`. */
  asked: string[]
}

/**
 * A byte source over a map. A Capture's file is keyed `<captureId>.<type>`, any other file by
 * its stored path. A key in `unreadable` is a Capture file that exists and cannot be read.
 */
function memorySource(files: Record<string, string>, unreadable: string[] = []): MemorySource {
  const asked: string[] = []
  const read = (key: string): Buffer | null => {
    asked.push(key)
    return key in files ? Buffer.from(files[key]) : null
  }
  return {
    asked,
    captureFile: ({ id }, type) => {
      const key = `${id}.${type}`
      if (unreadable.includes(key)) throw new Error(`EACCES: ${key}`)
      return read(key)
    },
    storedFile: read
  }
}

const capture = (id: string, content: string) => ({
  id,
  caseId: CASE,
  hash: sha256(content),
  mhtmlPath: `${CASE}/${id}.mhtml`
})

const document = (
  id: string,
  content: string,
  path: string | null = `${CASE}/documents/${id}.pdf`
) => ({
  id,
  kind: 'document',
  path,
  contentHash: sha256(content)
})

const derivedFile = (id: string, exhibitId: string, path: string): DerivedFile => ({
  id,
  exhibitId,
  derivation: 'text',
  toolVersion: '0.1.0',
  contentHash: sha256(id),
  path,
  createdAt: '2026-11-02T09:00:00.000Z',
  manifestSeq: null
})

const verified = (
  derivedFileId: string,
  status: DerivedFileVerification['status'] = 'verified',
  unanchoredCause?: DerivedFileVerification['unanchoredCause']
): DerivedFileVerification => ({
  derivedFileId,
  derivation: 'text',
  status,
  ...(unanchoredCause ? { unanchoredCause } : {})
})

let nextIndex = 0
/** A `timestamp` entry whose token attests `tokenFor`, filed against `contentHash`. */
const stamp = (
  contentHash: string,
  tokenFor = contentHash,
  serial = 1
): Record<string, unknown> => ({
  type: 'timestamp',
  index: nextIndex++,
  captureContentHash: contentHash,
  tsaToken: buildSyntheticToken({
    contentHash: tokenFor,
    genTime: new Date(Date.UTC(2026, 10, 2, 9, serial)),
    tsaDnsName: 'tsa.example'
  }).toString('base64')
})

/** A `capture` entry for `captureId` carrying the hash fields given. */
const captureEntry = (
  captureId: string,
  fields: Record<string, string> = {}
): Record<string, unknown> => ({
  type: 'capture',
  captureId,
  contentHash: 'c'.repeat(64),
  ...fields
})

const EVIDENCE: ExportForm = { kind: 'evidence-package', screenshots: false }
const WORKING_COPY: ExportForm = {
  kind: 'working-copy',
  pageArchives: false,
  operatorScreenshots: new Map()
}
const REPORT: ExportForm = { kind: 'report' }

const input = (over: Partial<PackageContentsInput>): PackageContentsInput => ({
  form: EVIDENCE,
  entries: [],
  chainNames: new Map(),
  captures: [],
  fileExhibits: [],
  derivedFiles: new Map(),
  derivedVerifications: new Map(),
  source: memorySource({}),
  ...over
})

describe("a Capture's own files in an Evidence Package", () => {
  const page = capture('cap-1', 'page')

  it('encloses the page archive under the chain id, anchored by the content hash', () => {
    const contents = decidePackageContents(
      input({
        captures: [page],
        entries: [captureEntry('cap-1')],
        source: memorySource({ 'cap-1.mhtml': 'page' })
      })
    )

    expect(contents.ofCapture('cap-1').pageArchive).toEqual({
      path: 'pages/cap-1.mhtml',
      sha256: sha256('page'),
      anchoredBy: 'contentHash'
    })
    expect(contents.files).toEqual([{ path: 'pages/cap-1.mhtml', bytes: Buffer.from('page') }])
  })

  it('encloses the page archive of a Capture no entry names, anchored by nothing', () => {
    const contents = decidePackageContents(
      input({ captures: [page], source: memorySource({ 'cap-1.mhtml': 'page' }) })
    )

    expect(contents.ofCapture('cap-1').pageArchive).toMatchObject({
      path: 'pages/cap-1.mhtml',
      anchoredBy: null
    })
  })

  it('states a Capture that holds no page archive as holding none', () => {
    const contents = decidePackageContents(input({ captures: [page] }))

    expect(contents.ofCapture('cap-1').pageArchive).toBeNull()
    expect(contents.files).toEqual([])
  })

  it('leaves out, unread, a screenshot no entry anchors when screenshots were not asked for', () => {
    const source = memorySource({ 'cap-1.mhtml': 'page', 'cap-1.png': 'pixels' })
    const contents = decidePackageContents(
      input({ captures: [page], entries: [captureEntry('cap-1')], source })
    )

    expect(contents.ofCapture('cap-1').screenshot).toBeNull()
    expect(source.asked).toEqual(['cap-1.mhtml'])
  })

  it('encloses a screenshot no entry anchors when screenshots were asked for', () => {
    const contents = decidePackageContents(
      input({
        form: { kind: 'evidence-package', screenshots: true },
        captures: [page],
        entries: [captureEntry('cap-1')],
        source: memorySource({ 'cap-1.png': 'pixels' })
      })
    )

    expect(contents.ofCapture('cap-1').screenshot).toEqual({
      path: `screenshots/${sha256('pixels')}.png`,
      sha256: sha256('pixels'),
      anchoredBy: null
    })
  })

  it('encloses a screenshot a signed entry anchors, whatever was asked for (#1986)', () => {
    const contents = decidePackageContents(
      input({
        captures: [page],
        entries: [captureEntry('cap-1', { screenshotHash: sha256('pixels') })],
        source: memorySource({ 'cap-1.png': 'pixels' })
      })
    )

    expect(contents.ofCapture('cap-1').screenshot).toEqual({
      path: `screenshots/${sha256('pixels')}.png`,
      sha256: sha256('pixels'),
      anchoredBy: 'screenshotHash'
    })
  })

  it('encloses a Transaction Record and a PDF the signed entry anchors', () => {
    const contents = decidePackageContents(
      input({
        captures: [page],
        entries: [
          captureEntry('cap-1', { transactionRecordHash: sha256('warc'), pdfHash: sha256('pdf') })
        ],
        source: memorySource({ 'cap-1.warc.gz': 'warc', 'cap-1.pdf': 'pdf' })
      })
    )

    expect(contents.ofCapture('cap-1')).toMatchObject({
      transactionRecord: {
        path: `transaction-records/${sha256('warc')}.warc.gz`,
        sha256: sha256('warc'),
        anchoredBy: 'transactionRecordHash'
      },
      pdf: { path: `pdfs/${sha256('pdf')}.pdf`, sha256: sha256('pdf'), anchoredBy: 'pdfHash' }
    })
  })

  it('leaves out, unread, a Transaction Record and a PDF no entry anchors', () => {
    const source = memorySource({ 'cap-1.warc.gz': 'warc', 'cap-1.pdf': 'pdf' })
    const contents = decidePackageContents(
      input({
        form: { kind: 'evidence-package', screenshots: true },
        captures: [page],
        entries: [captureEntry('cap-1')],
        source
      })
    )

    expect(contents.ofCapture('cap-1')).toMatchObject({ transactionRecord: null, pdf: null })
    expect(source.asked).toEqual(['cap-1.mhtml', 'cap-1.png'])
  })

  it('states an anchored file the Capture no longer holds as not enclosed', () => {
    const contents = decidePackageContents(
      input({
        captures: [page],
        entries: [captureEntry('cap-1', { pdfHash: sha256('pdf') })]
      })
    )

    expect(contents.ofCapture('cap-1').pdf).toBeNull()
  })

  it('reads the anchoring fields from the last entry a chain holds for the Capture', () => {
    const contents = decidePackageContents(
      input({
        captures: [page],
        entries: [captureEntry('cap-1', { pdfHash: sha256('pdf') }), captureEntry('cap-1')],
        source: memorySource({ 'cap-1.pdf': 'pdf' })
      })
    )

    expect(contents.ofCapture('cap-1').pdf).toBeNull()
  })

  it('writes one file for bytes two Captures share, and cites it from both', () => {
    const second = capture('cap-2', 'other page')
    const contents = decidePackageContents(
      input({
        form: { kind: 'evidence-package', screenshots: true },
        captures: [page, second],
        source: memorySource({ 'cap-1.png': 'same pixels', 'cap-2.png': 'same pixels' })
      })
    )

    const path = `screenshots/${sha256('same pixels')}.png`
    expect(contents.ofCapture('cap-1').screenshot?.path).toBe(path)
    expect(contents.ofCapture('cap-2').screenshot?.path).toBe(path)
    expect(contents.files.map((file) => file.path)).toEqual([path])
  })

  it('reads a renamed row under its own id and names its files by its chain id', () => {
    const renamed = capture('row-id', 'page')
    const source = memorySource({ 'row-id.mhtml': 'page', 'row-id.pdf': 'pdf' })
    const contents = decidePackageContents(
      input({
        captures: [renamed],
        entries: [captureEntry('chain-id', { pdfHash: sha256('pdf') })],
        chainNames: new Map([['row-id', { id: 'chain-id', path: null }]]),
        source
      })
    )

    expect(contents.ofCapture('row-id')).toMatchObject({
      pageArchive: { path: 'pages/chain-id.mhtml', anchoredBy: 'contentHash' },
      pdf: { anchoredBy: 'pdfHash' }
    })
    expect(source.asked).toEqual(['row-id.mhtml', 'row-id.pdf'])
  })

  it('fails the export on a file that exists and cannot be read', () => {
    expect(() =>
      decidePackageContents(input({ captures: [page], source: memorySource({}, ['cap-1.mhtml']) }))
    ).toThrow(/EACCES: cap-1.mhtml/)
  })

  it('does not fail on an unreadable file it has no reason to enclose', () => {
    const contents = decidePackageContents(
      input({
        captures: [page],
        entries: [captureEntry('cap-1')],
        source: memorySource({ 'cap-1.mhtml': 'page' }, ['cap-1.pdf', 'cap-1.png'])
      })
    )

    expect(contents.ofCapture('cap-1')).toMatchObject({ screenshot: null, pdf: null })
  })

  it("writes every Capture's own files, then the other Exhibits, then the Captures' Derived Files", () => {
    const second = capture('cap-2', 'second page')
    const statement = document('doc-1', 'statement')
    const contents = decidePackageContents(
      input({
        captures: [page, second],
        fileExhibits: [statement],
        entries: [
          captureEntry('cap-1', {
            screenshotHash: sha256('pixels'),
            transactionRecordHash: sha256('warc'),
            pdfHash: sha256('pdf')
          })
        ],
        derivedFiles: new Map([
          ['cap-1', [derivedFile('thumb-1', 'cap-1', `${CASE}/cap-1_thumb.jpg`)]],
          ['doc-1', [derivedFile('text-1', 'doc-1', `${CASE}/documents/doc-1_text.txt`)]]
        ]),
        derivedVerifications: new Map([
          ['cap-1', [verified('thumb-1')]],
          ['doc-1', [verified('text-1')]]
        ]),
        source: memorySource({
          'cap-1.mhtml': 'page',
          'cap-1.png': 'pixels',
          'cap-1.warc.gz': 'warc',
          'cap-1.pdf': 'pdf',
          'cap-2.mhtml': 'second page',
          [`${CASE}/cap-1_thumb.jpg`]: 'thumbnail',
          [`${CASE}/documents/doc-1.pdf`]: 'statement',
          [`${CASE}/documents/doc-1_text.txt`]: 'text'
        })
      })
    )

    expect(contents.files.map((file) => file.path)).toEqual([
      'pages/cap-1.mhtml',
      `screenshots/${sha256('pixels')}.png`,
      `transaction-records/${sha256('warc')}.warc.gz`,
      `pdfs/${sha256('pdf')}.pdf`,
      'pages/cap-2.mhtml',
      'documents/doc-1.pdf',
      'documents/doc-1_text.txt',
      'pages/cap-1_thumb.jpg'
    ])
  })
})

describe("a Capture's own files in a Working Copy", () => {
  const page = capture('cap-1', 'page')
  const anchored = captureEntry('cap-1', {
    screenshotHash: sha256('pixels'),
    transactionRecordHash: sha256('warc'),
    pdfHash: sha256('pdf')
  })
  const files = {
    'cap-1.mhtml': 'page',
    'cap-1.png': 'pixels',
    'cap-1.warc.gz': 'warc',
    'cap-1.pdf': 'pdf'
  }

  it('encloses the page archive only when page archives were asked for', () => {
    const decide = (pageArchives: boolean) =>
      decidePackageContents(
        input({
          form: { kind: 'working-copy', pageArchives, operatorScreenshots: new Map() },
          captures: [page],
          entries: [anchored],
          source: memorySource(files)
        })
      ).ofCapture('cap-1').pageArchive

    expect(decide(false)).toBeNull()
    expect(decide(true)).toEqual({
      path: 'pages/cap-1.mhtml',
      sha256: sha256('page'),
      anchoredBy: 'contentHash'
    })
  })

  it("encloses the operator's copy of the screenshot under the Capture's chain id", () => {
    const source = memorySource(files)
    const contents = decidePackageContents(
      input({
        form: {
          kind: 'working-copy',
          pageArchives: false,
          operatorScreenshots: new Map([['row-id', Buffer.from('annotated pixels')]])
        },
        captures: [capture('row-id', 'page')],
        chainNames: new Map([['row-id', { id: 'chain-id', path: null }]]),
        source
      })
    )

    expect(contents.ofCapture('row-id').screenshot).toEqual({
      path: 'screenshots/chain-id.png',
      sha256: sha256('annotated pixels'),
      anchoredBy: null
    })
    expect(contents.files).toEqual([
      { path: 'screenshots/chain-id.png', bytes: Buffer.from('annotated pixels') }
    ])
    expect(source.asked).toEqual([])
  })

  it('encloses no screenshot for an empty copy', () => {
    const contents = decidePackageContents(
      input({
        form: {
          kind: 'working-copy',
          pageArchives: false,
          operatorScreenshots: new Map([['cap-1', Buffer.alloc(0)]])
        },
        captures: [page]
      })
    )

    expect(contents.ofCapture('cap-1').screenshot).toBeNull()
  })

  it('encloses no Transaction Record and no PDF, anchored or not', () => {
    const source = memorySource(files)
    const contents = decidePackageContents(
      input({ form: WORKING_COPY, captures: [page], entries: [anchored], source })
    )

    expect(contents.ofCapture('cap-1')).toMatchObject({ transactionRecord: null, pdf: null })
    expect(source.asked).toEqual([])
  })

  it("writes each Capture's files and Derived Files together, then the other Exhibits", () => {
    const second = capture('cap-2', 'second page')
    const contents = decidePackageContents(
      input({
        form: {
          kind: 'working-copy',
          pageArchives: true,
          operatorScreenshots: new Map([['cap-1', Buffer.from('pixels')]])
        },
        captures: [page, second],
        fileExhibits: [document('doc-1', 'statement')],
        derivedFiles: new Map([
          ['cap-1', [derivedFile('thumb-1', 'cap-1', `${CASE}/cap-1_thumb.jpg`)]]
        ]),
        derivedVerifications: new Map([['cap-1', [verified('thumb-1')]]]),
        source: memorySource({
          'cap-1.mhtml': 'page',
          'cap-2.mhtml': 'second page',
          [`${CASE}/cap-1_thumb.jpg`]: 'thumbnail',
          [`${CASE}/documents/doc-1.pdf`]: 'statement'
        })
      })
    )

    expect(contents.files.map((file) => file.path)).toEqual([
      'pages/cap-1.mhtml',
      'screenshots/cap-1.png',
      'pages/cap-1_thumb.jpg',
      'pages/cap-2.mhtml',
      'documents/doc-1.pdf'
    ])
  })
})

describe('Timestamp Tokens', () => {
  it('encloses one token for a Content Hash and names it after the first Exhibit that has it', () => {
    const first = capture('cap-1', 'same bytes')
    const second = capture('cap-2', 'same bytes')
    const entry = stamp(first.hash)
    const contents = decidePackageContents(
      input({ captures: [first, second], entries: [entry, stamp(first.hash, first.hash, 2)] })
    )

    expect(contents.timestampTokens).toEqual([
      { path: 'timestamps/cap-1.tst', bytes: Buffer.from(entry.tsaToken as string, 'base64') }
    ])
    expect(contents.ofCapture('cap-1').timestampTokenPath).toBe('timestamps/cap-1.tst')
    expect(contents.ofCapture('cap-2').timestampTokenPath).toBe('timestamps/cap-1.tst')
  })

  it('stamps an Exhibit that is not a Capture, and writes the tokens in entry order', () => {
    const page = capture('cap-1', 'page')
    const statement = document('doc-1', 'statement')
    const contents = decidePackageContents(
      input({
        captures: [page],
        fileExhibits: [statement],
        entries: [stamp(statement.contentHash), stamp(page.hash)]
      })
    )

    expect(contents.timestampTokens.map(({ path }) => path)).toEqual([
      'timestamps/doc-1.tst',
      'timestamps/cap-1.tst'
    ])
    expect(contents.ofFileExhibit('doc-1').timestampTokenPath).toBe('timestamps/doc-1.tst')
  })

  it('names a token a Capture and another Exhibit share after the Capture', () => {
    const page = capture('cap-1', 'same bytes')
    const copy = document('doc-1', 'same bytes')
    const contents = decidePackageContents(
      input({ captures: [page], fileExhibits: [copy], entries: [stamp(page.hash)] })
    )

    expect(contents.timestampTokens.map(({ path }) => path)).toEqual(['timestamps/cap-1.tst'])
    expect(contents.ofFileExhibit('doc-1').timestampTokenPath).toBe('timestamps/cap-1.tst')
  })

  it('neither encloses nor cites a token that attests other content', () => {
    const page = capture('cap-1', 'page')
    const contents = decidePackageContents(
      input({ captures: [page], entries: [stamp(page.hash, sha256('something else'))] })
    )

    expect(contents.timestampTokens).toEqual([])
    expect(contents.ofCapture('cap-1').timestampTokenPath).toBeNull()
  })

  it('encloses the bytes of the entry that was accepted, not of the first naming the hash', () => {
    const page = capture('cap-1', 'page')
    const accepted = stamp(page.hash, page.hash, 2)
    const contents = decidePackageContents(
      input({ captures: [page], entries: [stamp(page.hash, sha256('other')), accepted] })
    )

    expect(contents.timestampTokens).toEqual([
      { path: 'timestamps/cap-1.tst', bytes: Buffer.from(accepted.tsaToken as string, 'base64') }
    ])
  })

  it('ignores a timestamp entry that carries no index or no token', () => {
    const page = capture('cap-1', 'page')
    const unindexed = { ...stamp(page.hash), index: undefined }
    const tokenless = { ...stamp(page.hash), tsaToken: undefined }
    const contents = decidePackageContents(
      input({ captures: [page], entries: [unindexed, tokenless] })
    )

    expect(contents.timestampTokens).toEqual([])
    expect(contents.ofCapture('cap-1').timestampTokenPath).toBeNull()
  })

  it('names the token of a renamed row by the id its signed entry carries', () => {
    const page = capture('row-id', 'page')
    const contents = decidePackageContents(
      input({
        captures: [page],
        entries: [stamp(page.hash)],
        chainNames: new Map([['row-id', { id: 'chain-id', path: null }]])
      })
    )

    expect(contents.ofCapture('row-id').timestampTokenPath).toBe('timestamps/chain-id.tst')
  })

  it.each([
    ['Working Copy', WORKING_COPY],
    ['standalone report', REPORT]
  ])('encloses no token in a %s', (_name, form) => {
    const page = capture('cap-1', 'page')
    const statement = document('doc-1', 'statement')
    const contents = decidePackageContents(
      input({
        form,
        captures: [page],
        fileExhibits: [statement],
        entries: [stamp(page.hash), stamp(statement.contentHash)]
      })
    )

    expect(contents.timestampTokens).toEqual([])
    expect(contents.ofCapture('cap-1').timestampTokenPath).toBeNull()
    expect(contents.ofFileExhibit('doc-1').timestampTokenPath).toBeNull()
  })
})

describe('Exhibits that are not Captures', () => {
  it('encloses the file where its stored path puts it in the Case', () => {
    const statement = document('doc-1', 'statement')
    const contents = decidePackageContents(
      input({
        fileExhibits: [statement],
        source: memorySource({ [`${CASE}/documents/doc-1.pdf`]: 'statement' })
      })
    )

    expect(contents.ofFileExhibit('doc-1').enclosed).toEqual({
      path: 'documents/doc-1.pdf',
      bytes: Buffer.from('statement')
    })
  })

  it('reads a renamed row from its own path and encloses it where its entry puts it', () => {
    const statement = document('row-id', 'statement')
    const contents = decidePackageContents(
      input({
        fileExhibits: [statement],
        chainNames: new Map([
          ['row-id', { id: 'chain-id', path: 'source-case/documents/chain-id.pdf' }]
        ]),
        source: memorySource({ [`${CASE}/documents/row-id.pdf`]: 'statement' })
      })
    )

    expect(contents.ofFileExhibit('row-id').enclosed).toEqual({
      path: 'documents/chain-id.pdf',
      bytes: Buffer.from('statement')
    })
  })

  it('does not enclose a file the source cannot read', () => {
    const contents = decidePackageContents(
      input({ fileExhibits: [document('doc-1', 'statement')] })
    )

    expect(contents.ofFileExhibit('doc-1').enclosed).toBeNull()
    expect(contents.files).toEqual([])
  })

  it('does not ask the source for an Exhibit with no stored path', () => {
    const source = memorySource({})
    const contents = decidePackageContents(
      input({ fileExhibits: [document('doc-1', 'statement', null)], source })
    )

    expect(contents.ofFileExhibit('doc-1').enclosed).toBeNull()
    expect(source.asked).toEqual([])
  })

  it("lists each Exhibit's file and then its Derived Files, in Exhibit order", () => {
    const first = document('doc-1', 'one')
    const second = document('doc-2', 'two')
    const text = derivedFile('text-1', 'doc-1', `${CASE}/documents/doc-1_text.txt`)
    const contents = decidePackageContents(
      input({
        fileExhibits: [first, second],
        derivedFiles: new Map([['doc-1', [text]]]),
        derivedVerifications: new Map([['doc-1', [verified('text-1')]]]),
        source: memorySource({
          [`${CASE}/documents/doc-1.pdf`]: 'one',
          [`${CASE}/documents/doc-1_text.txt`]: 'text of one',
          [`${CASE}/documents/doc-2.pdf`]: 'two'
        })
      })
    )

    expect(contents.files.map(({ path }) => path)).toEqual([
      'documents/doc-1.pdf',
      'documents/doc-1_text.txt',
      'documents/doc-2.pdf'
    ])
  })
})

describe('Derived Files', () => {
  const thumbnail = derivedFile('thumb-1', 'cap-1', `${CASE}/cap-1_thumb.jpg`)
  const files = { [`${CASE}/cap-1_thumb.jpg`]: 'thumbnail' }
  const decide = (
    verifications: DerivedFileVerification[],
    source = memorySource(files),
    form: ExportForm = EVIDENCE
  ) =>
    decidePackageContents(
      input({
        form,
        captures: [capture('cap-1', 'page')],
        derivedFiles: new Map([['cap-1', [thumbnail]]]),
        derivedVerifications: new Map([['cap-1', verifications]]),
        source
      })
    ).ofCapture('cap-1').derivedFiles

  it("encloses an anchored file beside its parent, under the parent's directory", () => {
    const verification = verified('thumb-1')

    expect(decide([verification])).toEqual([
      {
        file: thumbnail,
        verification,
        anchoring: 'anchored',
        enclosed: { path: 'pages/cap-1_thumb.jpg', bytes: Buffer.from('thumbnail') }
      }
    ])
  })

  it.each(['tampered', 'missing'] as const)('counts a %s file as anchored', (status) => {
    expect(decide([verified('thumb-1', status)])[0].anchoring).toBe('anchored')
  })

  it('holds back a file no entry names, without reading it', () => {
    const source = memorySource(files)
    const [decided] = decide([verified('thumb-1', 'unverified', 'no-entry')], source)

    expect(decided).toMatchObject({ anchoring: 'no-entry', enclosed: null })
    expect(source.asked).not.toContain(`${CASE}/cap-1_thumb.jpg`)
  })

  it('holds back a file nothing verified', () => {
    const [decided] = decide([])

    expect(decided).toEqual({ file: thumbnail, anchoring: 'no-entry', enclosed: null })
  })

  it('encloses a file an entry names on a chain that does not verify', () => {
    const [decided] = decide([verified('thumb-1', 'unverified', 'chain-unverified')])

    expect(decided).toMatchObject({
      anchoring: 'chain-unverified',
      enclosed: { path: 'pages/cap-1_thumb.jpg' }
    })
  })

  it('does not enclose an anchored file the source cannot read', () => {
    const [decided] = decide([verified('thumb-1')], memorySource({}))

    expect(decided).toMatchObject({ anchoring: 'anchored', enclosed: null })
  })

  it('encloses the same Derived Files in a Working Copy', () => {
    expect(decide([verified('thumb-1')], memorySource(files), WORKING_COPY)[0].enclosed).toEqual({
      path: 'pages/cap-1_thumb.jpg',
      bytes: Buffer.from('thumbnail')
    })
  })
})

describe('a standalone report', () => {
  it('encloses nothing and reads nothing, and still says what the chain anchors', () => {
    const source = memorySource({
      'cap-1.mhtml': 'page',
      'cap-1.png': 'pixels',
      [`${CASE}/documents/doc-1.pdf`]: 'statement',
      [`${CASE}/documents/doc-1_text.txt`]: 'text'
    })
    const contents = decidePackageContents(
      input({
        form: REPORT,
        captures: [capture('cap-1', 'page')],
        entries: [captureEntry('cap-1', { screenshotHash: sha256('pixels') })],
        fileExhibits: [document('doc-1', 'statement')],
        derivedFiles: new Map([
          ['doc-1', [derivedFile('text-1', 'doc-1', `${CASE}/documents/doc-1_text.txt`)]]
        ]),
        derivedVerifications: new Map([['doc-1', [verified('text-1')]]]),
        source
      })
    )

    expect(source.asked).toEqual([])
    expect(contents.files).toEqual([])
    expect(contents.ofCapture('cap-1')).toMatchObject({ pageArchive: null, screenshot: null })
    expect(contents.ofFileExhibit('doc-1')).toMatchObject({
      enclosed: null,
      derivedFiles: [{ anchoring: 'anchored', enclosed: null }]
    })
  })
})

describe('rows outside the scope', () => {
  it('refuses to answer for a row it was not given', () => {
    const contents = decidePackageContents(input({}))

    expect(() => contents.ofCapture('cap-9')).toThrow(/Capture cap-9 was not in the export's scope/)
    expect(() => contents.ofFileExhibit('doc-9')).toThrow(
      /Exhibit doc-9 was not in the export's scope/
    )
  })
})

describe('readOnce', () => {
  it('asks the source for each file once and repeats its answer, a null included', () => {
    const source = memorySource({ here: 'bytes', 'cap-1.png': 'pixels' })
    const once = readOnce(source)
    const cap = { caseId: CASE, id: 'cap-1' }

    expect(once.storedFile('here')).toEqual(Buffer.from('bytes'))
    expect(once.storedFile('here')).toEqual(Buffer.from('bytes'))
    expect(once.storedFile('absent')).toBeNull()
    expect(once.storedFile('absent')).toBeNull()
    expect(once.captureFile(cap, 'png')).toEqual(Buffer.from('pixels'))
    expect(once.captureFile(cap, 'png')).toEqual(Buffer.from('pixels'))
    expect(once.captureFile(cap, 'pdf')).toBeNull()
    expect(once.captureFile(cap, 'pdf')).toBeNull()
    expect(source.asked).toEqual(['here', 'absent', 'cap-1.png', 'cap-1.pdf'])
  })

  it('keeps a stored path apart from a Capture file of the same name', () => {
    // The Capture holds no screenshot and a stored file is spelled the way a screenshot of that
    // Capture would be, so an answer remembered under the bare name would be the wrong one.
    const once = readOnce({
      captureFile: () => null,
      storedFile: (storedPath) => Buffer.from(`stored ${storedPath}`)
    })

    expect(once.captureFile({ caseId: CASE, id: 'cap-1' }, 'png')).toBeNull()
    expect(once.storedFile('cap-1.png')).toEqual(Buffer.from('stored cap-1.png'))
    expect(once.captureFile({ caseId: CASE, id: 'cap-1' }, 'png')).toBeNull()
  })
})
