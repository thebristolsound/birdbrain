import { describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import type { DerivedFile, DerivedFileVerification } from '@shared/types'
import {
  decidePackageContents,
  readOnce,
  type PackageByteSource,
  type PackageContentsInput
} from '../index'
import { buildSyntheticToken } from '../../../../tests/helpers/timestampFixtures'

// The Package Contents decision, through its entry point and an in-memory byte source: no
// Case directory, no database, no zip.

const CASE = 'case-1'
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/** A byte source over a map of stored paths, which records every path it is asked for. */
function memorySource(files: Record<string, string>): PackageByteSource & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    storedFile: (storedPath) => {
      asked.push(storedPath)
      return storedPath in files ? Buffer.from(files[storedPath]) : null
    }
  }
}

const capture = (id: string, content: string) => ({
  id,
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

const input = (over: Partial<PackageContentsInput>): PackageContentsInput => ({
  form: 'evidence-package',
  entries: [],
  chainNames: new Map(),
  captures: [],
  fileExhibits: [],
  derivedFiles: new Map(),
  derivedVerifications: new Map(),
  source: memorySource({}),
  ...over
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

  it('stamps an Exhibit that is not a Capture, after the Captures and in entry order', () => {
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

  it.each(['working-copy', 'report'] as const)('encloses no token in a %s', (form) => {
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
    expect(contents.fileExhibitFiles).toEqual([])
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

    expect(contents.fileExhibitFiles.map(({ path }) => path)).toEqual([
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
    form: PackageContentsInput['form'] = 'evidence-package'
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
    expect(source.asked).toEqual([])
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
    expect(decide([verified('thumb-1')], memorySource(files), 'working-copy')[0].enclosed).toEqual({
      path: 'pages/cap-1_thumb.jpg',
      bytes: Buffer.from('thumbnail')
    })
  })
})

describe('a standalone report', () => {
  it('encloses nothing and reads nothing, and still says what the chain anchors', () => {
    const source = memorySource({
      [`${CASE}/documents/doc-1.pdf`]: 'statement',
      [`${CASE}/documents/doc-1_text.txt`]: 'text'
    })
    const contents = decidePackageContents(
      input({
        form: 'report',
        fileExhibits: [document('doc-1', 'statement')],
        derivedFiles: new Map([
          ['doc-1', [derivedFile('text-1', 'doc-1', `${CASE}/documents/doc-1_text.txt`)]]
        ]),
        derivedVerifications: new Map([['doc-1', [verified('text-1')]]]),
        source
      })
    )

    expect(source.asked).toEqual([])
    expect(contents.fileExhibitFiles).toEqual([])
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
  it('asks the source for each path once and repeats its answer, a null included', () => {
    const source = memorySource({ here: 'bytes' })
    const once = readOnce(source)

    expect(once.storedFile('here')).toEqual(Buffer.from('bytes'))
    expect(once.storedFile('here')).toEqual(Buffer.from('bytes'))
    expect(once.storedFile('absent')).toBeNull()
    expect(once.storedFile('absent')).toBeNull()
    expect(source.asked).toEqual(['here', 'absent'])
  })
})
