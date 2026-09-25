import type { InventoryRow } from '@shared/types'

// The Data screen's left rail as a pure function of the inventory (X33, R21).
//
// Four groups. Data Sources holds one subgroup per Exhibit kind, one node per
// Exhibit and its Derived Files as child rows — no `raw` / `derived` folders.
// Staging is its own top-level group beside Data Sources (ADR-0024), never a
// subgroup of it, because pooled rows are not evidence and a reader must not
// find them under the heading that says they are. Views holds File Types.
// Results holds the four nodes whose content is #1150.

export type DataNodeKey =
  | 'data-sources'
  | `kind:${string}`
  | `exhibit:${string}`
  | `derived:${string}`
  | 'staging'
  | 'views'
  | 'file-types'
  | `file-type:${string}`
  | 'results'
  | 'keyword-hits'
  | `keyword:${string}`
  | 'indicators'
  | 'integrity-exceptions'
  | 'manifest-ledger'

export interface DataTreeNode {
  key: DataNodeKey
  label: string
  depth: number
  // Group heads render as eyebrows; everything else is a selectable row.
  group: boolean
  hasChildren: boolean
  expanded: boolean
  // Every selectable row carries a count (#1149); group heads never do, as in
  // the mock (#1552). Otherwise null only where the count is owned by a view
  // that has not reported, and is rendered as absent rather than 0 so an
  // operator never reads "0 exceptions" off a node that has not looked.
  count: number | null
  // Integrity Exceptions carries the alert treatment when it is non-empty.
  alert: boolean
}

// Counts the tree cannot derive from the inventory alone. Each is owned by
// another query; the shell supplies what it has and leaves the rest null.
export interface ResultCounts {
  keywordHits: number | null
  indicators: number | null
  integrityExceptions: number | null
  manifestLedger: number | null
}

// One child per Selector under Keyword Hits (X39): the label the Signals
// screen shows and how many Captures it matched.
export interface KeywordHitNode {
  selectorId: string
  label: string
  count: number
}

const KIND_LABELS: Record<string, string> = {
  capture: 'Captures',
  attachment: 'Attachments',
  image: 'Images',
  document: 'Documents'
}

// Kinds this build populates sort first, in the order the ruling lists them; a
// kind a newer build wrote sorts after them by name rather than being dropped.
const KIND_ORDER = ['capture', 'attachment', 'image', 'document']

export function kindLabel(kind: string): string {
  const known = KIND_LABELS[kind]
  if (known) return known
  return kind.charAt(0).toUpperCase() + kind.slice(1) + 's'
}

// The singular for a Properties row: the stored kind, capitalised, never a
// pluralised label with a letter chopped off.
export function kindSingular(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

function kindSortIndex(kind: string): number {
  const index = KIND_ORDER.indexOf(kind)
  return index === -1 ? KIND_ORDER.length : index
}

// The file type of a row, from the extension of its stored path. A row with no
// recorded path (a legacy Capture whose artifact path was never written) is
// typed as such rather than guessed from its kind.
export function fileTypeOf(row: InventoryRow): string {
  if (!row.path) return 'No file'
  const base = row.path.split('/').pop() ?? row.path
  const dot = base.lastIndexOf('.')
  if (dot === -1 || dot === base.length - 1) return 'No extension'
  return base.slice(dot + 1).toUpperCase()
}

export function derivedFilesOf(
  rows: InventoryRow[],
  exhibitId: string
): Extract<InventoryRow, { entity: 'derived-file' }>[] {
  return rows.filter(
    (row): row is Extract<InventoryRow, { entity: 'derived-file' }> =>
      row.entity === 'derived-file' && row.parentExhibitId === exhibitId
  )
}

export interface BuildTreeInput {
  rows: InventoryRow[]
  expanded: ReadonlySet<string>
  results: ResultCounts
  keywordHits?: KeywordHitNode[]
}

// The visible rows of the rail, in order, with collapsed subtrees omitted.
export function buildDataTree({
  rows,
  expanded,
  results,
  keywordHits = []
}: BuildTreeInput): DataTreeNode[] {
  const out: DataTreeNode[] = []
  const isOpen = (key: string) => expanded.has(key)

  const exhibits = rows.filter((row) => row.entity === 'exhibit')
  // Every count is over anchored rows only (X16): a pooled file appears under
  // Staging and nowhere else, so a file-type count that included it would
  // disagree with the table the node selects.
  const anchored = rows.filter((row) => row.rowType === 'anchored')

  const push = (
    node: Omit<DataTreeNode, 'expanded' | 'alert'> & Partial<Pick<DataTreeNode, 'alert'>>
  ) => {
    out.push({ alert: false, ...node, expanded: node.hasChildren && isOpen(node.key) })
  }

  // --- Data Sources ---------------------------------------------------------
  const kinds = [...new Set(exhibits.map((row) => row.kind))].sort(
    (a, b) => kindSortIndex(a) - kindSortIndex(b) || a.localeCompare(b)
  )
  push({
    key: 'data-sources',
    label: 'Data Sources',
    depth: 0,
    group: true,
    hasChildren: kinds.length > 0,
    count: null
  })
  if (isOpen('data-sources')) {
    for (const kind of kinds) {
      const ofKind = exhibits.filter((row) => row.kind === kind)
      const kindKey: DataNodeKey = `kind:${kind}`
      const derivedOfKind = ofKind.reduce(
        (sum, exhibit) => sum + derivedFilesOf(rows, exhibit.id).length,
        0
      )
      push({
        key: kindKey,
        label: kindLabel(kind),
        depth: 1,
        group: false,
        hasChildren: ofKind.length > 0,
        count: ofKind.length + derivedOfKind
      })
      if (!isOpen(kindKey)) continue
      for (const exhibit of ofKind) {
        const derived = derivedFilesOf(rows, exhibit.id)
        const exhibitKey: DataNodeKey = `exhibit:${exhibit.id}`
        push({
          key: exhibitKey,
          label: exhibit.name,
          depth: 2,
          group: false,
          hasChildren: derived.length > 0,
          count: 1 + derived.length
        })
        if (!isOpen(exhibitKey)) continue
        for (const file of derived) {
          push({
            key: `derived:${file.id}`,
            label: file.derivation,
            depth: 3,
            group: false,
            hasChildren: false,
            count: 1
          })
        }
      }
    }
  }

  // --- Staging --------------------------------------------------------------
  push({
    key: 'staging',
    label: 'Staging',
    depth: 0,
    group: true,
    hasChildren: false,
    count: null
  })

  // --- Views ----------------------------------------------------------------
  const types = [...new Set(anchored.map(fileTypeOf))].sort((a, b) => a.localeCompare(b))
  push({
    key: 'views',
    label: 'Views',
    depth: 0,
    group: true,
    hasChildren: true,
    count: null
  })
  if (isOpen('views')) {
    push({
      key: 'file-types',
      label: 'File Types',
      depth: 1,
      group: false,
      hasChildren: types.length > 0,
      count: types.length
    })
    if (isOpen('file-types')) {
      for (const type of types) {
        push({
          key: `file-type:${type}`,
          label: type,
          depth: 2,
          group: false,
          hasChildren: false,
          count: anchored.filter((row) => fileTypeOf(row) === type).length
        })
      }
    }
  }

  // --- Results --------------------------------------------------------------
  push({
    key: 'results',
    label: 'Results',
    depth: 0,
    group: true,
    hasChildren: true,
    count: null
  })
  if (isOpen('results')) {
    push({
      key: 'keyword-hits',
      label: 'Keyword Hits',
      depth: 1,
      group: false,
      hasChildren: keywordHits.length > 0,
      count: results.keywordHits
    })
    if (isOpen('keyword-hits')) {
      for (const hit of keywordHits) {
        push({
          key: `keyword:${hit.selectorId}`,
          label: hit.label,
          depth: 2,
          group: false,
          hasChildren: false,
          count: hit.count
        })
      }
    }
    push({
      key: 'indicators',
      label: 'Indicators',
      depth: 1,
      group: false,
      hasChildren: false,
      count: results.indicators
    })
    push({
      key: 'integrity-exceptions',
      label: 'Integrity Exceptions',
      depth: 1,
      group: false,
      hasChildren: false,
      count: results.integrityExceptions,
      alert: (results.integrityExceptions ?? 0) > 0
    })
    push({
      key: 'manifest-ledger',
      label: 'Manifest Ledger',
      depth: 1,
      group: false,
      hasChildren: false,
      count: results.manifestLedger
    })
  }

  return out
}

// Groups open by default so a fresh Case reads as the four headings the ruling
// names, with the kinds beneath Data Sources visible.
export const DEFAULT_EXPANDED: ReadonlySet<string> = new Set(['data-sources', 'views', 'results'])

// Every node key the tree could show for this inventory, for "Expand below"
// and the tests: the keys of a node and everything under it.
export function descendantKeys(rows: InventoryRow[], key: DataNodeKey): DataNodeKey[] {
  const exhibits = rows.filter((row) => row.entity === 'exhibit')
  const anchored = rows.filter((row) => row.rowType === 'anchored')
  const under = (id: string): DataNodeKey[] => [
    `exhibit:${id}`,
    ...derivedFilesOf(rows, id).map((file): DataNodeKey => `derived:${file.id}`)
  ]
  if (key === 'data-sources') {
    const kinds = [...new Set(exhibits.map((row) => row.kind))]
    return kinds.flatMap((kind) => [
      `kind:${kind}` as DataNodeKey,
      ...exhibits.filter((row) => row.kind === kind).flatMap((row) => under(row.id))
    ])
  }
  if (key.startsWith('kind:')) {
    const kind = key.slice('kind:'.length)
    return exhibits.filter((row) => row.kind === kind).flatMap((row) => under(row.id))
  }
  if (key.startsWith('exhibit:')) return under(key.slice('exhibit:'.length)).slice(1)
  if (key === 'views') {
    return [
      'file-types',
      ...[...new Set(anchored.map(fileTypeOf))].map((t): DataNodeKey => `file-type:${t}`)
    ]
  }
  if (key === 'file-types') {
    return [...new Set(anchored.map(fileTypeOf))].map((t): DataNodeKey => `file-type:${t}`)
  }
  if (key === 'results') {
    return ['keyword-hits', 'indicators', 'integrity-exceptions', 'manifest-ledger']
  }
  return []
}
