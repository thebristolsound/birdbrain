import { create } from 'zustand'

export type AppMode = 'dashboard' | 'case-workspace'
export type CaseTab = 'overview' | 'captures' | 'entities' | 'analysis' | 'selectors'

interface AppState {
  activeCaseId: string | null
  appMode: AppMode
  activeCaseTab: CaseTab
  settingsOpen: boolean
  sessionActive: boolean
  connectedToExtension: boolean
  selectedCaptureId: string | null
  searchQuery: string

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
  toggleSettings: () => void
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

  setActiveCaseId: (id) => set({ activeCaseId: id }),
  setSessionActive: (active) => set({ sessionActive: active }),
  setConnectedToExtension: (connected) => set({ connectedToExtension: connected }),
  setSelectedCaptureId: (id) => set({ selectedCaptureId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  selectCase: (id) =>
    set({ activeCaseId: id, appMode: 'case-workspace', selectedCaptureId: null }),

  selectCapture: (id) => set({ selectedCaptureId: id }),

  navigateToCapture: (id) =>
    set({ activeCaseTab: 'captures', selectedCaptureId: id }),

  setActiveTab: (tab) => set({ activeCaseTab: tab }),

  goToDashboard: () =>
    set({ activeCaseId: null, appMode: 'dashboard', selectedCaptureId: null, settingsOpen: false }),

  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen }))
}))
