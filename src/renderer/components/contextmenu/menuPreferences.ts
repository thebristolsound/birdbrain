const STORAGE_KEY = 'birdbrain.context-menu.hidden-actions'

export function readHiddenActions(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

export function saveHiddenActions(hidden: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden))
  } catch {
    // Keep the open menu usable when browser storage is unavailable.
  }
}
