import { useCallback, useLayoutEffect } from 'react'
import { usePanelCallbackRef, type LayoutChangedMeta } from 'react-resizable-panels'
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
export function useListColumnWidth() {
  const [panel, panelRef] = usePanelCallbackRef()

  useLayoutEffect(() => {
    panel?.resize(readStoredListWidth())
  }, [panel])

  // Only a drag is saved: a window too narrow for the stored width squeezes the list, and
  // that squeeze must not become the width the next screen opens at.
  const onLayoutChanged = useCallback(
    (meta: LayoutChangedMeta) => {
      if (!meta.isUserInteraction || !panel) return
      const width = Math.round(panel.getSize().inPixels)
      localStorage.setItem(LIST_COLUMN_WIDTH_STORAGE_KEY, String(width))
    },
    [panel]
  )

  return { panelRef, onLayoutChanged } as const
}
