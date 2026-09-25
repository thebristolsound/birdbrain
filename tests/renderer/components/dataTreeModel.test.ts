import { describe, it, expect } from 'vitest'
import {
  buildDataTree,
  DEFAULT_EXPANDED,
  descendantKeys,
  fileTypeOf,
  kindLabel,
  kindSingular
} from '@renderer/components/data/dataTreeModel'
import { CAPTURE_A, CAPTURE_LEGACY, INVENTORY, STAGED_PDF, THUMB_A } from '../dataFixtures'

const RESULTS = { keywordHits: 2, indicators: 5, integrityExceptions: 1, manifestLedger: 7 }

describe('buildDataTree', () => {
  it('renders the four groups with Staging beside Data Sources, never under it', () => {
    const nodes = buildDataTree({ rows: INVENTORY, expanded: new Set(), results: RESULTS })
    expect(nodes.filter((n) => n.group).map((n) => [n.key, n.depth])).toEqual([
      ['data-sources', 0],
      ['staging', 0],
      ['views', 0],
      ['results', 0]
    ])
  })

  it('counts every selectable row and no group head: file types and the Results nodes', () => {
    const nodes = buildDataTree({
      rows: INVENTORY,
      expanded: new Set([...DEFAULT_EXPANDED, 'file-types']),
      results: RESULTS
    })
    const count = (key: string) => nodes.find((n) => n.key === key)?.count
    // The mock draws no count on a group eyebrow (#1552); the four heads
    // carried one before, which was the superseded design.
    for (const group of ['data-sources', 'staging', 'views', 'results']) {
      expect(count(group)).toBeNull()
    }
    // Two Captures and one thumbnail are anchored rows; the pooled PDF is not,
    // and no file-type count includes it (X16).
    expect(count('file-types')).toBe(3)
    expect(count('file-type:MHTML')).toBe(1)
    expect(nodes.find((n) => n.key === 'file-type:PDF')).toBeUndefined()
    expect(count('keyword-hits')).toBe(2)
    expect(count('indicators')).toBe(5)
    expect(count('integrity-exceptions')).toBe(1)
    expect(count('manifest-ledger')).toBe(7)
  })

  it('groups Data Sources by kind with Derived Files as child rows and no raw/derived folders', () => {
    const nodes = buildDataTree({
      rows: INVENTORY,
      expanded: new Set(['data-sources', 'kind:capture', `exhibit:${CAPTURE_A.id}`]),
      results: RESULTS
    })
    const keys = nodes.map((n) => n.key)
    expect(keys).toContain('kind:capture')
    expect(keys.indexOf(`exhibit:${CAPTURE_A.id}`)).toBeGreaterThan(keys.indexOf('kind:capture'))
    expect(keys.indexOf(`derived:${THUMB_A.id}`)).toBe(keys.indexOf(`exhibit:${CAPTURE_A.id}`) + 1)
    expect(keys).toContain(`exhibit:${CAPTURE_LEGACY.id}`)
    expect(keys.some((k) => /raw|derived-folder/.test(k))).toBe(false)
    // The Captures subgroup counts its Exhibits and their Derived Files.
    expect(nodes.find((n) => n.key === 'kind:capture')?.count).toBe(3)
    expect(nodes.find((n) => n.key === `exhibit:${CAPTURE_A.id}`)?.count).toBe(2)
  })

  it('never lists a pooled row under Data Sources', () => {
    const nodes = buildDataTree({
      rows: INVENTORY,
      expanded: new Set(['data-sources', 'kind:document', 'kind:capture']),
      results: RESULTS
    })
    expect(nodes.map((n) => n.key)).not.toContain(`exhibit:${STAGED_PDF.id}`)
    expect(nodes.map((n) => n.key)).not.toContain('kind:document')
  })

  it('marks Integrity Exceptions with the alert only when there are exceptions', () => {
    const with1 = buildDataTree({ rows: INVENTORY, expanded: DEFAULT_EXPANDED, results: RESULTS })
    expect(with1.find((n) => n.key === 'integrity-exceptions')?.alert).toBe(true)
    const none = buildDataTree({
      rows: INVENTORY,
      expanded: DEFAULT_EXPANDED,
      results: { ...RESULTS, integrityExceptions: 0 }
    })
    expect(none.find((n) => n.key === 'integrity-exceptions')?.alert).toBe(false)
  })

  it('reports a count it does not own as null rather than 0', () => {
    const nodes = buildDataTree({
      rows: INVENTORY,
      expanded: DEFAULT_EXPANDED,
      results: {
        keywordHits: null,
        indicators: null,
        integrityExceptions: null,
        manifestLedger: null
      }
    })
    expect(nodes.find((n) => n.key === 'integrity-exceptions')?.count).toBeNull()
    expect(nodes.find((n) => n.key === 'integrity-exceptions')?.alert).toBe(false)
  })

  it('lists one Keyword Hits child per Selector with its match count (X39)', () => {
    const nodes = buildDataTree({
      rows: INVENTORY,
      expanded: new Set(['results', 'keyword-hits']),
      results: RESULTS,
      keywordHits: [
        { selectorId: 's1', label: 'proton.me', count: 3 },
        { selectorId: 's2', label: 'bc1q', count: 0 }
      ]
    })
    const keys = nodes.map((n) => n.key)
    expect(keys.indexOf('keyword:s1')).toBe(keys.indexOf('keyword-hits') + 1)
    expect(nodes.find((n) => n.key === 'keyword:s1')).toMatchObject({
      label: 'proton.me',
      depth: 2,
      count: 3
    })
    expect(nodes.find((n) => n.key === 'keyword-hits')?.hasChildren).toBe(true)
    // Collapsed by default: no children until the node is opened.
    const closed = buildDataTree({
      rows: INVENTORY,
      expanded: new Set(['results']),
      results: RESULTS,
      keywordHits: [{ selectorId: 's1', label: 'proton.me', count: 3 }]
    })
    expect(closed.map((n) => n.key)).not.toContain('keyword:s1')
  })

  it('hides a collapsed subtree', () => {
    const nodes = buildDataTree({ rows: INVENTORY, expanded: new Set(), results: RESULTS })
    expect(nodes.map((n) => n.key)).toEqual(['data-sources', 'staging', 'views', 'results'])
  })
})

describe('descendantKeys', () => {
  it('walks each group and node kind', () => {
    expect(descendantKeys(INVENTORY, 'kind:capture')).toEqual([
      `exhibit:${CAPTURE_A.id}`,
      `derived:${THUMB_A.id}`,
      `exhibit:${CAPTURE_LEGACY.id}`
    ])
    expect(descendantKeys(INVENTORY, 'views')).toEqual([
      'file-types',
      'file-type:MHTML',
      'file-type:HTML',
      'file-type:JPG'
    ])
    expect(descendantKeys(INVENTORY, 'file-types')).toEqual([
      'file-type:MHTML',
      'file-type:HTML',
      'file-type:JPG'
    ])
    expect(descendantKeys(INVENTORY, 'results')).toEqual([
      'keyword-hits',
      'indicators',
      'integrity-exceptions',
      'manifest-ledger'
    ])
  })

  it('walks kinds, Exhibits and Derived Files under Data Sources', () => {
    expect(descendantKeys(INVENTORY, 'data-sources')).toEqual([
      'kind:capture',
      `exhibit:${CAPTURE_A.id}`,
      `derived:${THUMB_A.id}`,
      `exhibit:${CAPTURE_LEGACY.id}`
    ])
    expect(descendantKeys(INVENTORY, `exhibit:${CAPTURE_A.id}`)).toEqual([`derived:${THUMB_A.id}`])
    expect(descendantKeys(INVENTORY, 'staging')).toEqual([])
  })
})

describe('labels', () => {
  it('names the known kinds and pluralizes an unknown one', () => {
    expect(kindLabel('capture')).toBe('Captures')
    expect(kindLabel('attachment')).toBe('Attachments')
    expect(kindLabel('recording')).toBe('Recordings')
    expect(kindSingular('capture')).toBe('Capture')
    expect(kindSingular('attachment')).toBe('Attachment')
  })

  it('sorts the ruling’s kinds first and an unknown kind after them by name', () => {
    const mixed = [
      { ...CAPTURE_A, id: 'r1', kind: 'recording', exhibitNumber: 3 },
      { ...CAPTURE_A, id: 'a1', kind: 'attachment', exhibitNumber: 4 },
      CAPTURE_A
    ]
    const nodes = buildDataTree({
      rows: mixed,
      expanded: new Set(['data-sources']),
      results: RESULTS
    })
    expect(nodes.filter((n) => n.key.startsWith('kind:')).map((n) => n.key)).toEqual([
      'kind:capture',
      'kind:attachment',
      'kind:recording'
    ])
  })

  it('types a row by its stored extension and says so when there is no file', () => {
    expect(fileTypeOf(CAPTURE_A)).toBe('MHTML')
    expect(fileTypeOf(THUMB_A)).toBe('JPG')
    expect(fileTypeOf({ ...CAPTURE_A, path: null })).toBe('No file')
    expect(fileTypeOf({ ...CAPTURE_A, path: 'case1/blob' })).toBe('No extension')
  })
})
