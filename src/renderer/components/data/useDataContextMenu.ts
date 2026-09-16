import { useCallback } from 'react'
import type { InventoryRow } from '@shared/types'
import type { ManifestSnapshotEntry } from '@shared/manifestSnapshot'
import type {
  EntityMenuTarget,
  ExhibitMenuTarget,
  LedgerMenuTarget,
  NodeMenuTarget,
  StagedMenuTarget
} from '@renderer/components/contextmenu/entityMenu'
import type { ArtifactRow, RowContext } from '@renderer/components/data/dataTableModel'
import {
  descendantKeys,
  type DataNodeKey,
  type DataTreeNode
} from '@renderer/components/data/dataTreeModel'
import { rowsForNode } from '@renderer/components/data/dataTableModel'
import { targetExhibitId, type LedgerRow } from '@renderer/components/data/ledgerModel'
import { copyCaptureHash } from '@renderer/components/captures/useCopyCaptureHash'
import { copyValue } from '@renderer/components/data/copy'

interface DataContextMenuOptions {
  rows: InventoryRow[]
  entries: ManifestSnapshotEntry[]
  // What the table knows beyond the inventory, so a node's Verify covers the
  // rows the node actually shows (this session's buckets, a Selector's hits).
  context: RowContext
  /** Which Exhibits a Capture-only action can open: the ids with a viewer. */
  captureIds: ReadonlySet<string>
  onOpenCapture: (captureId: string) => void
  onVerify: (exhibitIds: string[]) => void
  onSelectNode: (key: DataNodeKey) => void
  onSetExpanded: (keys: DataNodeKey[], expanded: boolean) => void
  onShowRow: (rowId: string) => void
  onCommit: (stagingId: string) => void
  onDiscard: (file: { id: string; name: string }) => void
}

// Builds the context-menu targets for the Data screen (#1151, X38). The
// screen supplies the callbacks its inline controls already use, so a menu
// item and the control it accelerates cannot behave differently; this only
// decides which callback each item reaches and with what.
export function useDataContextMenu({
  rows,
  entries,
  context,
  captureIds,
  onOpenCapture,
  onVerify,
  onSelectNode,
  onSetExpanded,
  onShowRow,
  onCommit,
  onDiscard
}: DataContextMenuOptions) {
  const rowTarget = useCallback(
    (row: ArtifactRow): EntityMenuTarget => {
      if (row.staged) {
        const target: StagedMenuTarget = {
          kind: 'staged',
          stagingId: row.id,
          name: row.name,
          actions: {
            commit: () => onCommit(row.id),
            discard: () => onDiscard({ id: row.id, name: row.name }),
            copyHash: () => void copyValue(row.hash, 'SHA-256 (not anchored)')
          }
        }
        return target
      }
      const parentId = row.raw.entity === 'derived-file' ? row.raw.parentExhibitId : row.id
      const target: ExhibitMenuTarget = {
        kind: 'exhibit',
        exhibitId: parentId,
        name: row.name,
        entity: row.entity === 'derived-file' ? 'derived-file' : 'exhibit',
        canOpen: captureIds.has(parentId),
        hasPath: row.path !== null,
        actions: {
          open: () => onOpenCapture(parentId),
          copyHash: () => void copyCaptureHash(row.hash),
          copyPath: () => {
            if (row.path) void copyValue(row.path, 'relative path')
          },
          verify: () => onVerify([parentId])
        }
      }
      return target
    },
    [captureIds, onOpenCapture, onVerify, onCommit, onDiscard]
  )

  const nodeTarget = useCallback(
    (node: DataTreeNode): EntityMenuTarget => {
      const { captures, ...extras } = context
      // The Manifest Ledger node lists entries, not Exhibits, and the pane
      // header offers no Verify there, so the menu offers none either.
      const exhibitIds =
        node.key === 'manifest-ledger'
          ? []
          : rowsForNode(rows, node.key, captures, extras)
              .filter((row) => row.entity === 'exhibit')
              .map((row) => row.id)
      const target: NodeMenuTarget = {
        kind: 'node',
        nodeKey: node.key,
        label: node.label,
        hasChildren: node.hasChildren,
        hasExhibits: exhibitIds.length > 0,
        actions: {
          showOnly: () => onSelectNode(node.key),
          expandBelow: () => onSetExpanded([node.key, ...descendantKeys(rows, node.key)], true),
          collapseBelow: () => onSetExpanded([node.key, ...descendantKeys(rows, node.key)], false),
          verify: () => onVerify(exhibitIds)
        }
      }
      return target
    },
    [rows, context, onSelectNode, onSetExpanded, onVerify]
  )

  const ledgerTarget = useCallback(
    (row: LedgerRow): EntityMenuTarget => {
      const line = entries.find((entry) => entry.index === row.index)
      const named = line ? targetExhibitId(line, rows) : null
      // A deleted Capture's entry names an id the inventory no longer holds.
      const targetId = named && rows.some((r) => r.id === named) ? named : null
      const target: LedgerMenuTarget = {
        kind: 'ledger',
        index: row.index,
        entryType: row.type,
        canShowTarget: targetId !== null,
        hasEntryHash: row.entryHash !== '',
        hasPrevHash: row.prevHash !== '',
        actions: {
          showTarget: () => {
            if (targetId) onShowRow(targetId)
          },
          copyEntryHash: () => void copyValue(row.entryHash, 'entry hash'),
          copyPrevHash: () => void copyValue(row.prevHash, 'previous hash')
        }
      }
      return target
    },
    [entries, rows, onShowRow]
  )

  return { rowTarget, nodeTarget, ledgerTarget }
}
