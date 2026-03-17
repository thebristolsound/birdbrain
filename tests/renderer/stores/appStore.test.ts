import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@renderer/stores/appStore'

describe('appStore', () => {
  beforeEach(() => {
    // Reset store to initial state between tests
    useAppStore.setState({
      activeCaseId: null,
      appMode: 'dashboard',
      activeCaseTab: 'overview',
      settingsOpen: false,
      sessionActive: false,
      connectedToExtension: false,
      selectedCaptureId: null,
      searchQuery: ''
    })
  })

  describe('initial state', () => {
    it('starts in dashboard mode with overview tab', () => {
      const state = useAppStore.getState()
      expect(state.appMode).toBe('dashboard')
      expect(state.activeCaseTab).toBe('overview')
      expect(state.activeCaseId).toBeNull()
      expect(state.selectedCaptureId).toBeNull()
      expect(state.settingsOpen).toBe(false)
    })
  })

  describe('selectCase', () => {
    it('switches to case-workspace mode and sets case id', () => {
      useAppStore.getState().selectCase('case-1')
      const state = useAppStore.getState()
      expect(state.appMode).toBe('case-workspace')
      expect(state.activeCaseId).toBe('case-1')
      expect(state.selectedCaptureId).toBeNull()
    })

    it('preserves current activeCaseTab when switching cases', () => {
      useAppStore.getState().selectCase('case-1')
      useAppStore.getState().setActiveTab('captures')
      useAppStore.getState().selectCase('case-2')
      const state = useAppStore.getState()
      expect(state.activeCaseTab).toBe('captures')
      expect(state.activeCaseId).toBe('case-2')
    })

    it('clears selectedCaptureId when switching cases', () => {
      useAppStore.getState().selectCase('case-1')
      useAppStore.getState().selectCapture('cap-1')
      useAppStore.getState().selectCase('case-2')
      expect(useAppStore.getState().selectedCaptureId).toBeNull()
    })
  })

  describe('goToDashboard', () => {
    it('resets to dashboard mode and clears case/capture', () => {
      useAppStore.getState().selectCase('case-1')
      useAppStore.getState().selectCapture('cap-1')
      useAppStore.getState().goToDashboard()
      const state = useAppStore.getState()
      expect(state.appMode).toBe('dashboard')
      expect(state.activeCaseId).toBeNull()
      expect(state.selectedCaptureId).toBeNull()
    })
  })

  describe('setActiveTab', () => {
    it('changes the active case tab', () => {
      useAppStore.getState().setActiveTab('entities')
      expect(useAppStore.getState().activeCaseTab).toBe('entities')
    })
  })

  describe('selectCapture', () => {
    it('sets selectedCaptureId without changing mode or tab', () => {
      useAppStore.getState().selectCase('case-1')
      useAppStore.getState().setActiveTab('captures')
      useAppStore.getState().selectCapture('cap-1')
      const state = useAppStore.getState()
      expect(state.selectedCaptureId).toBe('cap-1')
      expect(state.appMode).toBe('case-workspace')
      expect(state.activeCaseTab).toBe('captures')
    })
  })

  describe('navigateToCapture', () => {
    it('switches to captures tab and sets capture id', () => {
      useAppStore.getState().selectCase('case-1')
      useAppStore.getState().setActiveTab('entities')
      useAppStore.getState().navigateToCapture('cap-1')
      const state = useAppStore.getState()
      expect(state.activeCaseTab).toBe('captures')
      expect(state.selectedCaptureId).toBe('cap-1')
    })
  })

  describe('toggleSettings', () => {
    it('toggles settingsOpen without changing appMode', () => {
      useAppStore.getState().selectCase('case-1')
      useAppStore.getState().toggleSettings()
      const state = useAppStore.getState()
      expect(state.settingsOpen).toBe(true)
      expect(state.appMode).toBe('case-workspace')
      expect(state.activeCaseId).toBe('case-1')
    })

    it('toggles back to closed', () => {
      useAppStore.getState().toggleSettings()
      useAppStore.getState().toggleSettings()
      expect(useAppStore.getState().settingsOpen).toBe(false)
    })
  })
})
