import { useCallback, useState } from 'react'

// One flag for the Captures and Notes lists, so moving between the two screens never
// changes the left column. The key is the one the Captures list used on its own, kept so
// a collapse made before the lists shared it carries over.
export const LIST_COLUMN_COLLAPSED_STORAGE_KEY = 'captureListCollapsed'

export function readStoredListCollapsed(): boolean {
  return localStorage.getItem(LIST_COLUMN_COLLAPSED_STORAGE_KEY) === 'true'
}

/** Whether the list column is collapsed to its rail, remembered per machine. */
export function useListColumnCollapsed() {
  const [collapsed, setCollapsedState] = useState<boolean>(readStoredListCollapsed)

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next)
    localStorage.setItem(LIST_COLUMN_COLLAPSED_STORAGE_KEY, String(next))
  }, [])

  return { collapsed, setCollapsed } as const
}
