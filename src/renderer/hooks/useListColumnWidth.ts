import { useCallback, useLayoutEffect, useRef } from 'react'
import {
  usePanelCallbackRef,
  type Layout,
  type LayoutChangedMeta,
  type PanelImperativeHandle
} from 'react-resizable-panels'
import { LIST_COLUMN_SIZE } from '@renderer/components/layout/listColumnSize'

export const LIST_COLUMN_WIDTH_STORAGE_KEY = 'listColumnWidth'

export function readStoredListWidth(): number {
  const stored = Number(localStorage.getItem(LIST_COLUMN_WIDTH_STORAGE_KEY))
  const { defaultSize, minSize, maxSize } = LIST_COLUMN_SIZE
  return stored >= minSize && stored <= maxSize ? stored : defaultSize
}

/**
 * The list column's width in pixels, one value for the Captures and Notes screens.
 *
 * The panel library saves a layout as percentages of its group, and the two groups are
 * never the same width: the Captures group gives up room to the details rail, and both
 * follow the window. A saved percentage would reopen the list at a different width on each
 * screen, so the width is kept here in pixels and applied whenever the list panel mounts.
 */
export function useListColumnWidth(panelId: string) {
  const [panel, setPanel] = usePanelCallbackRef()
  // The handle as of this commit. The state copy lags a render, so it can arrive in the
  // render that removed its panel again (a deep link into another case shows the list
  // for one render), and resizing a panel the Group no longer holds throws.
  const mountedPanel = useRef<PanelImperativeHandle | null>(null)
  const panelRef = useCallback(
    (handle: PanelImperativeHandle | null) => {
      mountedPanel.current = handle
      setPanel(handle)
    },
    [setPanel]
  )
  // The list's share of the group after the last layout change of any kind.
  const lastShare = useRef<number | undefined>(undefined)

  useLayoutEffect(() => {
    if (panel && panel === mountedPanel.current) panel.resize(readStoredListWidth())
  }, [panel])

  // Only a drag that moved the list is saved. A window too narrow for the stored width
  // squeezes the list, and dragging the Captures details separator is a user interaction
  // too; neither squeeze may become the width the next screen opens at.
  const onLayoutChanged = useCallback(
    (layout: Layout, meta: LayoutChangedMeta) => {
      const share = layout[panelId]
      const moved = share !== lastShare.current
      lastShare.current = share
      if (!meta.isUserInteraction || !moved || share === undefined || !panel) return
      const width = Math.round(panel.getSize().inPixels)
      localStorage.setItem(LIST_COLUMN_WIDTH_STORAGE_KEY, String(width))
    },
    [panel, panelId]
  )

  return { panelRef, onLayoutChanged } as const
}
