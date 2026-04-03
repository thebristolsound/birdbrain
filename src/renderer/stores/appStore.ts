import { create } from 'zustand'
import type { CaptureEvent } from '@shared/types'

interface AppState {
  sessionActive: boolean
  connectedToExtension: boolean
  selectedCaptureId: string | null
  selectedCaptureIds: Set<string>
  searchQuery: string
  activeSelectorFilters: string[]
  filteredCaptureIds: string[] | null
  captureEvents: CaptureEvent[]
  captureStats: {
    successCount: number
    failCount: number
    skipCount: number
    lastError?: { message: string; timestamp: string }
  }

  setSessionActive: (active: boolean) => void
  setConnectedToExtension: (connected: boolean) => void
  setSelectedCaptureId: (id: string | null) => void
  setSearchQuery: (query: string) => void
  selectCapture: (id: string) => void
  toggleCaptureSelection: (id: string) => void
  selectAllCaptures: (ids: string[]) => void
  clearCaptureSelection: () => void
  addSelectorFilter: (selectorId: string) => void
  removeSelectorFilter: (selectorId: string) => void
  clearSelectorFilters: () => void
  setFilteredCaptureIds: (ids: string[] | null) => void
  addCaptureEvent: (event: CaptureEvent) => void
  clearCaptureEvents: () => void
}

export const useAppStore = create<AppState>((set) => ({
  sessionActive: false,
  connectedToExtension: false,
  selectedCaptureId: null,
  selectedCaptureIds: new Set(),
  searchQuery: '',
  activeSelectorFilters: [],
  filteredCaptureIds: null,
  captureEvents: [],
  captureStats: { successCount: 0, failCount: 0, skipCount: 0 },

  setSessionActive: (active) => set({ sessionActive: active }),
  setConnectedToExtension: (connected) => set({ connectedToExtension: connected }),
  setSelectedCaptureId: (id) => set({ selectedCaptureId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  selectCapture: (id) => set({ selectedCaptureId: id }),

  toggleCaptureSelection: (id) =>
    set((s) => {
      const newSet = new Set(s.selectedCaptureIds)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return { selectedCaptureIds: newSet }
    }),

  selectAllCaptures: (ids) => set({ selectedCaptureIds: new Set(ids) }),

  clearCaptureSelection: () => set({ selectedCaptureIds: new Set() }),

  addSelectorFilter: (selectorId) =>
    set((s) => ({
      activeSelectorFilters: s.activeSelectorFilters.includes(selectorId)
        ? s.activeSelectorFilters
        : [...s.activeSelectorFilters, selectorId]
    })),

  removeSelectorFilter: (selectorId) =>
    set((s) => {
      const updated = s.activeSelectorFilters.filter((id) => id !== selectorId)
      return {
        activeSelectorFilters: updated,
        filteredCaptureIds: updated.length === 0 ? null : s.filteredCaptureIds
      }
    }),

  clearSelectorFilters: () => set({ activeSelectorFilters: [], filteredCaptureIds: null }),

  setFilteredCaptureIds: (ids) => set({ filteredCaptureIds: ids }),

  addCaptureEvent: (event) =>
    set((s) => {
      const events = [event, ...s.captureEvents].slice(0, 50)
      const stats = { ...s.captureStats }
      if (event.type === 'stored') stats.successCount++
      if (event.type === 'failed') {
        stats.failCount++
        stats.lastError = { message: event.error || 'Unknown error', timestamp: event.timestamp }
      }
      if (event.type === 'skipped') stats.skipCount++
      return { captureEvents: events, captureStats: stats }
    }),

  clearCaptureEvents: () =>
    set({ captureEvents: [], captureStats: { successCount: 0, failCount: 0, skipCount: 0 } })
}))
