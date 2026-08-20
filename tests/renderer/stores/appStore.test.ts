import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@renderer/stores/appStore'

describe('appStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      sessionActive: false,
      connectedToExtension: false,
      selectedCaptureId: null,
      selectedNoteId: null,
      searchQuery: '',
      activeSelectorFilters: [],
      filteredCaptureIds: null,
      captureEvents: [],
      captureStats: { successCount: 0, failCount: 0, skipCount: 0 }
    })
  })

  describe('initial state', () => {
    it('starts with no selection and session inactive', () => {
      const state = useAppStore.getState()
      expect(state.selectedCaptureId).toBeNull()
      expect(state.sessionActive).toBe(false)
      expect(state.connectedToExtension).toBe(false)
      expect(state.searchQuery).toBe('')
    })
  })

  describe('selectCapture', () => {
    it('sets selectedCaptureId', () => {
      useAppStore.getState().selectCapture('cap-1')
      expect(useAppStore.getState().selectedCaptureId).toBe('cap-1')
    })
  })

  describe('setSelectedNoteId', () => {
    it('sets and clears the note the Notes tab should mark as selected', () => {
      useAppStore.getState().setSelectedNoteId('note-1')
      expect(useAppStore.getState().selectedNoteId).toBe('note-1')

      useAppStore.getState().setSelectedNoteId(null)
      expect(useAppStore.getState().selectedNoteId).toBeNull()
    })
  })

  describe('session state', () => {
    it('sets sessionActive', () => {
      useAppStore.getState().setSessionActive(true)
      expect(useAppStore.getState().sessionActive).toBe(true)
    })

    it('sets connectedToExtension', () => {
      useAppStore.getState().setConnectedToExtension(true)
      expect(useAppStore.getState().connectedToExtension).toBe(true)
    })
  })

  describe('onboarding overlay', () => {
    it('defaults to closed', () => {
      expect(useAppStore.getState().onboardingOverlayOpen).toBe(false)
    })

    it('opens and closes the onboarding overlay', () => {
      useAppStore.getState().setOnboardingOverlayOpen(true)
      expect(useAppStore.getState().onboardingOverlayOpen).toBe(true)
      useAppStore.getState().setOnboardingOverlayOpen(false)
      expect(useAppStore.getState().onboardingOverlayOpen).toBe(false)
    })
  })

  describe('selector filters', () => {
    it('adds a selector filter', () => {
      useAppStore.getState().addSelectorFilter('sel-1')
      expect(useAppStore.getState().activeSelectorFilters).toEqual(['sel-1'])
    })

    it('does not duplicate selector filters', () => {
      useAppStore.getState().addSelectorFilter('sel-1')
      useAppStore.getState().addSelectorFilter('sel-1')
      expect(useAppStore.getState().activeSelectorFilters).toEqual(['sel-1'])
    })

    it('removes a selector filter', () => {
      useAppStore.getState().addSelectorFilter('sel-1')
      useAppStore.getState().addSelectorFilter('sel-2')
      useAppStore.getState().removeSelectorFilter('sel-1')
      expect(useAppStore.getState().activeSelectorFilters).toEqual(['sel-2'])
    })

    it('clears filteredCaptureIds when last filter removed', () => {
      useAppStore.getState().addSelectorFilter('sel-1')
      useAppStore.getState().setFilteredCaptureIds(['cap-1'])
      useAppStore.getState().removeSelectorFilter('sel-1')
      expect(useAppStore.getState().filteredCaptureIds).toBeNull()
    })

    it('clears all selector filters', () => {
      useAppStore.getState().addSelectorFilter('sel-1')
      useAppStore.getState().addSelectorFilter('sel-2')
      useAppStore.getState().setFilteredCaptureIds(['cap-1'])
      useAppStore.getState().clearSelectorFilters()
      expect(useAppStore.getState().activeSelectorFilters).toEqual([])
      expect(useAppStore.getState().filteredCaptureIds).toBeNull()
    })
  })

  describe('capture events', () => {
    it('adds capture events and updates stats', () => {
      useAppStore.getState().addCaptureEvent({
        type: 'stored',
        captureId: 'cap-1',
        source: 'manual',
        url: 'https://example.com',
        timestamp: new Date().toISOString()
      })
      const state = useAppStore.getState()
      expect(state.captureEvents).toHaveLength(1)
      expect(state.captureStats.successCount).toBe(1)
    })

    it('tracks failed events', () => {
      useAppStore.getState().addCaptureEvent({
        type: 'failed',
        captureId: 'cap-1',
        source: 'manual',
        url: 'https://example.com',
        timestamp: new Date().toISOString(),
        error: 'Network error'
      })
      const state = useAppStore.getState()
      expect(state.captureStats.failCount).toBe(1)
      expect(state.captureStats.lastError?.message).toBe('Network error')
    })

    it('limits events to 50', () => {
      for (let i = 0; i < 60; i++) {
        useAppStore.getState().addCaptureEvent({
          type: 'stored',
          captureId: `cap-${i}`,
          source: 'manual',
          url: 'https://example.com',
          timestamp: new Date().toISOString()
        })
      }
      expect(useAppStore.getState().captureEvents).toHaveLength(50)
    })

    it('removes received spinner when stored event arrives for same url+source', () => {
      useAppStore.getState().addCaptureEvent({
        type: 'received',
        source: 'auto',
        url: 'https://example.com',
        timestamp: new Date().toISOString()
      })
      expect(useAppStore.getState().captureEvents).toHaveLength(1)

      useAppStore.getState().addCaptureEvent({
        type: 'stored',
        captureId: 'cap-1',
        source: 'auto',
        url: 'https://example.com',
        timestamp: new Date().toISOString()
      })
      const events = useAppStore.getState().captureEvents
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('stored')
    })

    it('removes received spinner when failed event arrives', () => {
      useAppStore.getState().addCaptureEvent({
        type: 'received',
        source: 'manual',
        url: 'https://example.com',
        timestamp: new Date().toISOString()
      })
      useAppStore.getState().addCaptureEvent({
        type: 'failed',
        source: 'manual',
        url: 'https://example.com',
        timestamp: new Date().toISOString(),
        error: 'timeout'
      })
      const events = useAppStore.getState().captureEvents
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('failed')
    })

    it('does not remove received spinner for different url', () => {
      useAppStore.getState().addCaptureEvent({
        type: 'received',
        source: 'auto',
        url: 'https://other.com',
        timestamp: new Date().toISOString()
      })
      useAppStore.getState().addCaptureEvent({
        type: 'stored',
        captureId: 'cap-1',
        source: 'auto',
        url: 'https://example.com',
        timestamp: new Date().toISOString()
      })
      const events = useAppStore.getState().captureEvents
      expect(events).toHaveLength(2)
    })

    it('clears events and stats', () => {
      useAppStore.getState().addCaptureEvent({
        type: 'stored',
        captureId: 'cap-1',
        source: 'manual',
        url: 'https://example.com',
        timestamp: new Date().toISOString()
      })
      useAppStore.getState().clearCaptureEvents()
      const state = useAppStore.getState()
      expect(state.captureEvents).toHaveLength(0)
      expect(state.captureStats.successCount).toBe(0)
    })
  })
})
