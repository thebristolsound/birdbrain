import type { Capture, InventoryRow } from '@shared/types'
import { formatBytes } from '@renderer/components/data/dataTableModel'
import { kindLabel } from '@renderer/components/data/dataTreeModel'

interface PropertiesTabProps {
  row: InventoryRow
  rows: InventoryRow[]
  // The Capture row for a Capture Exhibit, for the Collector fields.
  capture?: Capture
  // The inline route for the menu's Copy SHA-256 and Copy relative path
  // (#1151): a copy button beside each.
  onCopy?: (value: string, label: string) => void
}

interface Prop {
  label: string
  value: string
  mono?: boolean
  // What a copy of this value is announced as; absent means not copyable.
  copyAs?: string
}

// Q10: kind, origin, Exhibit Number, recorded size (labelled as recorded at
// ingest, never a fresh stat), the real relative path, and Collector from the
// four version fields. No Remote address — the app records none. A Derived
// File adds its parent and derivation.
export function propertiesFor(row: InventoryRow, rows: InventoryRow[], capture?: Capture): Prop[] {
  const props: Prop[] = []
  if (row.entity === 'exhibit') {
    props.push({ label: 'Kind', value: kindLabel(row.kind).replace(/s$/, '') })
    props.push({ label: 'Origin', value: row.origin })
    props.push({ label: 'Exhibit Number', value: `Exhibit ${row.exhibitNumber}` })
    props.push({
      label: 'Anchoring',
      value:
        row.manifestSeq === null
          ? 'No Manifest Entry (unanchored)'
          : `Manifest Entry ${row.manifestSeq}`
    })
    props.push({ label: 'Committed', value: row.committedAt })
  } else if (row.entity === 'derived-file') {
    const parent = rows.find((r) => r.entity === 'exhibit' && r.id === row.parentExhibitId)
    props.push({ label: 'Kind', value: 'Derived File' })
    props.push({ label: 'Parent', value: parent?.name ?? row.parentExhibitId })
    props.push({ label: 'Derivation', value: row.derivation })
    props.push({ label: 'Derivation tool', value: row.toolVersion })
    props.push({
      label: 'Anchoring',
      value:
        row.manifestSeq === null
          ? 'No Manifest Entry (unanchored)'
          : `Manifest Entry ${row.manifestSeq}`
    })
    props.push({ label: 'Created', value: row.createdAt })
  } else {
    props.push({ label: 'Kind', value: `${kindLabel(row.kind).replace(/s$/, '')} (not anchored)` })
    props.push({ label: 'Origin', value: row.origin })
    if (row.sourceUrl) props.push({ label: 'Stated source', value: row.sourceUrl })
    props.push({ label: 'Arrived', value: row.arrivedAt })
  }
  props.push({
    label: 'SHA-256',
    value: row.contentHash,
    mono: true,
    copyAs: row.entity === 'staged-file' ? 'SHA-256 (not anchored)' : 'SHA-256'
  })
  props.push({ label: 'Size (recorded at ingest)', value: formatBytes(row.sizeBytes) })
  props.push({
    label: 'Relative path',
    value: row.path ?? 'No file recorded',
    mono: true,
    ...(row.path ? { copyAs: 'relative path' } : {})
  })
  if (capture) {
    const collector = [
      capture.toolVersion && `Birdbrain ${capture.toolVersion}`,
      capture.extensionVersion && `extension ${capture.extensionVersion}`,
      capture.browserVersion && `browser ${capture.browserVersion}`
    ]
      .filter(Boolean)
      .join(' · ')
    if (collector) props.push({ label: 'Collector', value: collector })
    if (capture.userAgent) props.push({ label: 'User agent', value: capture.userAgent })
  }
  return props
}

export function PropertiesTab({ row, rows, capture, onCopy }: PropertiesTabProps) {
  return (
    <dl
      className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 p-4 text-xs"
      data-testid="properties-tab"
    >
      {propertiesFor(row, rows, capture).map((prop) => (
        <div key={prop.label} className="contents">
          <dt className="text-text-faint">{prop.label}</dt>
          <dd
            className={
              prop.mono
                ? 'break-all font-mono text-text-secondary'
                : 'break-words text-text-secondary'
            }
          >
            {prop.value}
            {prop.copyAs && onCopy && (
              <button
                type="button"
                className="ml-2 rounded px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent-subtle"
                onClick={() => onCopy(prop.value, prop.copyAs!)}
                data-testid={`copy-${prop.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
              >
                Copy
              </button>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
