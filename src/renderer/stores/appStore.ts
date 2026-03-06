import { create } from 'zustand'

export type ActiveView = 'dashboard' | 'case-overview' | 'capture-viewer' | 'case-analysis' | 'settings'

interface AppState {
  activeCaseId: string | null
  activeView: ActiveView
  sessionActive: boolean
  connectedToExtension: boolean
  selectedCaptureId: string | null
  searchQuery: string
  sidebarCollapsed: boolean

  setActiveCaseId: (id: string | null) => void
  setActiveView: (view: ActiveView) => void
  setSessionActive: (active: boolean) => void
  setConnectedToExtension: (connected: boolean) => void
  setSelectedCaptureId: (id: string | null) => void
  setSearchQuery: (query: string) => void
  toggleSidebar: () => void
  selectCase: (id: string) => void
  selectCapture: (id: string) => void
  goToDashboard: () => void
}

export const useAppStore = create<AppState>((set) => ({
  activeCaseId: null,
  activeView: 'dashboard',
  sessionActive: false,
  connectedToExtension: false,
  selectedCaptureId: null,
  searchQuery: '',
  sidebarCollapsed: false,

  setActiveCaseId: (id) => set({ activeCaseId: id }),
  setActiveView: (view) => set({ activeView: view }),
  setSessionActive: (active) => set({ sessionActive: active }),
  setConnectedToExtension: (connected) => set({ connectedToExtension: connected }),
  setSelectedCaptureId: (id) => set({ selectedCaptureId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  selectCase: (id) =>
    set({ activeCaseId: id, activeView: 'case-overview', selectedCaptureId: null }),

  selectCapture: (id) => set({ selectedCaptureId: id, activeView: 'capture-viewer' }),

  goToDashboard: () =>
    set({ activeCaseId: null, activeView: 'dashboard', selectedCaptureId: null })
}))
