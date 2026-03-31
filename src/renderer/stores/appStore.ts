import { create } from 'zustand'
import type { CaptureEvent } from '@shared/types'
import { CAPTURE_SERVER_BASE_URL } from '@shared/constants'

export type AppMode = 'dashboard' | 'case-workspace' | 'new-case-wizard'
export type CaseTab = 'overview' | 'captures' | 'selectors'

interface AppState {
  activeCaseId: string | null
  appMode: AppMode
  activeCaseTab: CaseTab
  settingsOpen: boolean
  sessionActive: boolean
  connectedToExtension: boolean
  selectedCaptureId: string | null
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

  setActiveCaseId: (id: string | null) => void
  setSessionActive: (active: boolean) => void
  setConnectedToExtension: (connected: boolean) => void
  setSelectedCaptureId: (id: string | null) => void
  setSearchQuery: (query: string) => void
  selectCase: (id: string) => void
  selectCapture: (id: string) => void
  navigateToCapture: (id: string) => void
  setActiveTab: (tab: CaseTab) => void
  goToDashboard: () => void
  goToNewCaseWizard: () => void
  toggleSettings: () => void
  addSelectorFilter: (selectorId: string) => void
  removeSelectorFilter: (selectorId: string) => void
  clearSelectorFilters: () => void
  setFilteredCaptureIds: (ids: string[] | null) => void
  addCaptureEvent: (event: CaptureEvent) => void
  clearCaptureEvents: () => void
}

export const useAppStore = create<AppState>((set) => ({
  activeCaseId: null,
  appMode: 'dashboard',
  activeCaseTab: 'overview',
  settingsOpen: false,
  sessionActive: false,
  connectedToExtension: false,
  selectedCaptureId: null,
  searchQuery: '',
  activeSelectorFilters: [],
  filteredCaptureIds: null,
  captureEvents: [],
  captureStats: { successCount: 0, failCount: 0, skipCount: 0 },

  setActiveCaseId: (id) => {
    set({ activeCaseId: id })
    if (id) {
      fetch(`${CAPTURE_SERVER_BASE_URL}/api/cases/${id}/activate`, { method: 'POST' }).catch((err) =>
        console.error('Failed to activate case on server:', err)
      )
    }
  },
  setSessionActive: (active) => set({ sessionActive: active }),
  setConnectedToExtension: (connected) => set({ connectedToExtension: connected }),
  setSelectedCaptureId: (id) => set({ selectedCaptureId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  selectCase: (id) => {
    set({ activeCaseId: id, appMode: 'case-workspace', selectedCaptureId: null })
    fetch(`${CAPTURE_SERVER_BASE_URL}/api/cases/${id}/activate`, { method: 'POST' }).catch((err) =>
        console.error('Failed to activate case on server:', err)
      )
  },

  selectCapture: (id) => set({ selectedCaptureId: id }),

  navigateToCapture: (id) => set({ activeCaseTab: 'captures', selectedCaptureId: id }),

  setActiveTab: (tab) => set({ activeCaseTab: tab }),

  goToDashboard: () =>
    set({ activeCaseId: null, appMode: 'dashboard', selectedCaptureId: null, settingsOpen: false }),

  goToNewCaseWizard: () => set({ appMode: 'new-case-wizard', settingsOpen: false }),

  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),

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
