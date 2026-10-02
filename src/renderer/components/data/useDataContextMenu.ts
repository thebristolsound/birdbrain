import { useCallback } from 'react'
import type { InventoryRow } from '@shared/types'
import type {
  EntityMenuTarget,
  ExhibitMenuTarget,
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
import { copyCaptureHash } from '@renderer/components/captures/useCopyCaptureHash'
import { copyValue } from '@renderer/components/data/copy'

interface DataContextMenuOptions {
  rows: InventoryRow[]
  // The categories under Indicators, so Expand below reaches them.
  indicatorCategories: string[]
  // What the table knows beyond the inventory, so a node's Verify covers the
  // rows the node actually shows (this session's buckets, a Selector's hits).
  context: RowContext
  /** Which Exhibits a Capture-only action can open: the ids with a viewer. */
  captureIds: ReadonlySet<string>
  onOpenCapture: (captureId: string) => void
  onVerify: (exhibitIds: string[]) => void
  onSelectNode: (key: DataNodeKey) => void
  onSetExpanded: (keys: DataNodeKey[], expanded: boolean) => void
  onCommit: (stagingId: string) => void
  onDiscard: (file: { id: string; name: string }) => void
}

// Builds the context-menu targets for the Data screen (#1151, X38). The
// screen supplies the callbacks its inline controls already use, so a menu
// item and the control it accelerates cannot behave differently; this only
// decides which callback each item reaches and with what.
//
// A menu is mounted only on a row that reads as clickable and only when it
// offers an action beyond the click and a copy. Exhibit rows always have
// Verify and pooled rows Commit and Discard; a tree node qualifies through a
// subtree to expand or Exhibits to verify; a Manifest Ledger entry never
// does (its menu would be the row click and the two hash cells), so it has
// no menu.
export function useDataContextMenu({
  rows,
  indicatorCategories,
  context,
  captureIds,
  onOpenCapture,
  onVerify,
  onSelectNode,
  onSetExpanded,
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
    (node: DataTreeNode): EntityMenuTarget | null => {
      // Group heads render as eyebrows, not rows.
      if (node.group) return null
      const { captures, ...extras } = context
      // The Manifest Ledger node lists entries, not Exhibits, and the pane
      // header offers no Verify there, so the node has nothing to offer.
      const exhibitIds =
        node.key === 'manifest-ledger'
          ? []
          : rowsForNode(rows, node.key, captures, extras)
              .filter((row) => row.entity === 'exhibit')
              .map((row) => row.id)
      if (!node.hasChildren && exhibitIds.length === 0) return null
      const target: NodeMenuTarget = {
        kind: 'node',
        nodeKey: node.key,
        label: node.label,
        hasChildren: node.hasChildren,
        hasExhibits: exhibitIds.length > 0,
        actions: {
          showOnly: () => onSelectNode(node.key),
          expandBelow: () =>
            onSetExpanded([node.key, ...descendantKeys(rows, node.key, indicatorCategories)], true),
          collapseBelow: () =>
            onSetExpanded(
              [node.key, ...descendantKeys(rows, node.key, indicatorCategories)],
              false
            ),
          verify: () => onVerify(exhibitIds)
        }
      }
      return target
    },
    [rows, indicatorCategories, context, onSelectNode, onSetExpanded, onVerify]
  )

  return { rowTarget, nodeTarget }
}
