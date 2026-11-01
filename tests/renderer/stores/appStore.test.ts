import { describe, it, expect, beforeEach } from 'vitest'
import type { FieldHit } from '@shared/types'
import { useAppStore } from '@renderer/stores/appStore'

describe('appStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      sessionActive: false,
      connectedToExtension: false,
      selectedCaptureId: null,
      selectedCaptureIds: new Set(),
      selectedNoteId: null,
      selectionAnchorId: null,
      selectionRangeBase: [],
      searchQuery: '',
      activeSelectorFilters: [],
      filteredCaptureIds: null,
      activeTagFilters: [],
      tagFilteredCaptureIds: null,
      captureEvents: [],
      captureStats: { successCount: 0, failCount: 0, skipCount: 0 },
      captureTrail: []
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

    it('keeps an opened search hit only while its Capture stays selected', () => {
      const hit = { exhibitId: 'cap-1', fieldId: 1 } as FieldHit
      const { selectCapture, setSelectedCaptureId, setViewerHit } = useAppStore.getState()
      selectCapture('cap-1')
      setViewerHit(hit)

      selectCapture('cap-1')
      expect(useAppStore.getState().viewerHit).toBe(hit)
      selectCapture('cap-2')
      selectCapture('cap-1')
      expect(useAppStore.getState().viewerHit).toBeNull()

      setViewerHit(hit)
      setSelectedCaptureId(null)
      setSelectedCaptureId('cap-1')
      expect(useAppStore.getState().viewerHit).toBeNull()
    })

    it('counts each opening of a hit, the same hit object included', () => {
      const hit = { exhibitId: 'cap-1', fieldId: 1 } as FieldHit
      const { setViewerHit } = useAppStore.getState()
      const before = useAppStore.getState().viewerHitOpening
      setViewerHit(hit)
      setViewerHit(hit)
      expect(useAppStore.getState().viewerHitOpening).toBe(before + 2)
    })
  })

  describe('viewer tab per capture', () => {
    const tab = () => useAppStore.getState().activeViewerTab

    beforeEach(() => {
      useAppStore.setState({ activeViewerTab: 'screenshot', viewerTabs: {} })
    })

    it('opens a capture that has not been viewed on the Screenshot tab', () => {
      const { selectCapture, setActiveViewerTab } = useAppStore.getState()
      selectCapture('cap-1')
      setActiveViewerTab('wayback')
      selectCapture('cap-2')
      expect(tab()).toBe('screenshot')
    })

    it('reopens each capture on the tab it was left on', () => {
      const { selectCapture, setSelectedCaptureId, followCaptureLink, setActiveViewerTab } =
        useAppStore.getState()
      selectCapture('cap-1')
      setActiveViewerTab('wayback')
      selectCapture('cap-2')
      setActiveViewerTab('links')

      setSelectedCaptureId('cap-1')
      expect(tab()).toBe('wayback')
      followCaptureLink('cap-2')
      expect(tab()).toBe('links')
      useAppStore.getState().goBackInTrail(new Set(['cap-1']))
      expect(tab()).toBe('wayback')
    })

    // #1735: a link clicked in the Page or Links tab opens its Capture on that tab.
    it('opens a followed capture that has not been viewed on the tab the link was in', () => {
      const { selectCapture, followCaptureLink, setActiveViewerTab } = useAppStore.getState()
      selectCapture('cap-1')
      setActiveViewerTab('page')
      followCaptureLink('cap-2')
      expect(tab()).toBe('page')
    })

    it('keeps a tab chosen with nothing selected off every capture', () => {
      const { selectCapture, setSelectedCaptureId, setActiveViewerTab } = useAppStore.getState()
      setSelectedCaptureId(null)
      setActiveViewerTab('text')
      selectCapture('cap-1')
      expect(tab()).toBe('screenshot')
    })
  })

  // #1735, plan A3.
  describe('link trail', () => {
    const state = () => useAppStore.getState()

    it('pushes the viewed Capture on a link click and selects the destination', () => {
      state().selectCapture('a')
      state().followCaptureLink('b')
      state().followCaptureLink('c')

      expect(state().selectedCaptureId).toBe('c')
      expect(state().captureTrail).toEqual(['a', 'b'])
    })

    it('pushes nothing on a link to the viewed Capture or with none selected', () => {
      state().followCaptureLink('a')
      expect(state().selectedCaptureId).toBeNull()

      state().selectCapture('a')
      state().followCaptureLink('a')
      expect(state().captureTrail).toEqual([])
    })

    it('drops a search hit on another Capture when a link click leaves it', () => {
      state().selectCapture('a')
      state().setViewerHit({ exhibitId: 'a', fieldId: 1 } as FieldHit)
      state().followCaptureLink('b')

      expect(state().viewerHit).toBeNull()
    })

    it('pops the trail on Back, selecting the Capture it came from', () => {
      state().selectCapture('a')
      state().followCaptureLink('b')
      state().followCaptureLink('c')

      state().goBackInTrail(new Set(['a', 'b', 'c']))
      expect(state().selectedCaptureId).toBe('b')
      expect(state().captureTrail).toEqual(['a'])

      state().goBackInTrail(new Set(['a', 'b', 'c']))
      expect(state().selectedCaptureId).toBe('a')
      expect(state().captureTrail).toEqual([])
    })

    it('pops past a Capture deleted since it was pushed', () => {
      state().selectCapture('a')
      state().followCaptureLink('b')
      state().followCaptureLink('c')

      state().goBackInTrail(new Set(['a', 'c']))
      expect(state().selectedCaptureId).toBe('a')
      expect(state().captureTrail).toEqual([])
    })

    it('empties the trail and keeps the selection when every pushed Capture is gone', () => {
      state().selectCapture('a')
      state().followCaptureLink('b')

      state().goBackInTrail(new Set(['b']))
      expect(state().selectedCaptureId).toBe('b')
      expect(state().captureTrail).toEqual([])
    })

    it('clears on any other selection', () => {
      for (const select of [
        () => state().selectCapture('x'),
        () => state().setSelectedCaptureId('x')
      ]) {
        state().selectCapture('a')
        state().followCaptureLink('b')
        select()
        expect(state().captureTrail).toEqual([])
      }
    })

    // CaseWorkspace's reset on a Case change goes through setSelectedCaptureId(null).
    it('clears on a Case change', () => {
      state().selectCapture('a')
      state().followCaptureLink('b')

      state().setSelectedCaptureId(null)
      expect(state().captureTrail).toEqual([])
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

  describe('multi-select', () => {
    it('toggleCaptureSelection adds then removes an id', () => {
      useAppStore.getState().toggleCaptureSelection('cap-1')
      expect(useAppStore.getState().selectedCaptureIds.has('cap-1')).toBe(true)
      useAppStore.getState().toggleCaptureSelection('cap-1')
      expect(useAppStore.getState().selectedCaptureIds.has('cap-1')).toBe(false)
    })

    // Was 'replaces the whole set', which pinned the opposite of the contract
    // the hook documents and the feature claims: selection survives a filter
    // change. cmd-A under a filter that hides cap-hidden must not silently drop
    // it, because the bar's count never mentioned it and the operator has no
    // way to notice the loss.
    it('selectAllCaptures adds to the set without dropping ids the filter hides', () => {
      useAppStore.getState().toggleCaptureSelection('cap-hidden')
      useAppStore.getState().selectAllCaptures(['cap-1', 'cap-2'])
      const ids = useAppStore.getState().selectedCaptureIds
      expect([...ids].sort()).toEqual(['cap-1', 'cap-2', 'cap-hidden'])
    })

    it('clearCaptureSelection empties the set and resets the anchor', () => {
      useAppStore.getState().toggleCaptureSelection('cap-1')
      useAppStore.getState().setSelectionAnchor('cap-1')
      useAppStore.getState().clearCaptureSelection()
      expect(useAppStore.getState().selectedCaptureIds.size).toBe(0)
      expect(useAppStore.getState().selectionAnchorId).toBeNull()
    })

    it('deselectCaptures removes only the given ids', () => {
      useAppStore.getState().selectAllCaptures(['cap-1', 'cap-2', 'cap-3'])
      useAppStore.getState().deselectCaptures(['cap-1', 'cap-3'])
      expect([...useAppStore.getState().selectedCaptureIds]).toEqual(['cap-2'])
    })
  })

  describe('selectCaptureRange', () => {
    const order = ['cap-1', 'cap-2', 'cap-3', 'cap-4', 'cap-5']

    it('extends forward from the anchor', () => {
      useAppStore.getState().setSelectionAnchor('cap-2')
      useAppStore.getState().selectCaptureRange(order, 'cap-4')
      expect([...useAppStore.getState().selectedCaptureIds].sort()).toEqual([
        'cap-2',
        'cap-3',
        'cap-4'
      ])
    })

    it('extends backward when the target precedes the anchor', () => {
      useAppStore.getState().setSelectionAnchor('cap-4')
      useAppStore.getState().selectCaptureRange(order, 'cap-2')
      expect([...useAppStore.getState().selectedCaptureIds].sort()).toEqual([
        'cap-2',
        'cap-3',
        'cap-4'
      ])
    })

    it('unions the range with the existing selection', () => {
      useAppStore.getState().toggleCaptureSelection('cap-5')
      useAppStore.getState().setSelectionAnchor('cap-1')
      useAppStore.getState().selectCaptureRange(order, 'cap-2')
      expect([...useAppStore.getState().selectedCaptureIds].sort()).toEqual([
        'cap-1',
        'cap-2',
        'cap-5'
      ])
    })

    it('keeps the anchor after a range extension so it can re-extend', () => {
      useAppStore.getState().setSelectionAnchor('cap-2')
      useAppStore.getState().selectCaptureRange(order, 'cap-3')
      useAppStore.getState().selectCaptureRange(order, 'cap-5')
      expect(useAppStore.getState().selectionAnchorId).toBe('cap-2')
      expect(useAppStore.getState().selectedCaptureIds.size).toBe(4)
    })

    // The direction the original tests never went. An operator who overshoots
    // and shift-clicks a nearer row is correcting the gesture; if the range
    // only ever grows, the correction appears to do nothing and the bar's
    // Delete acts on rows they believe they dropped.
    it('shrinks the range when the next shift-click is nearer the anchor', () => {
      useAppStore.getState().setSelectionAnchor('cap-2')
      useAppStore.getState().selectCaptureRange(order, 'cap-5')
      expect([...useAppStore.getState().selectedCaptureIds].sort()).toEqual([
        'cap-2',
        'cap-3',
        'cap-4',
        'cap-5'
      ])

      useAppStore.getState().selectCaptureRange(order, 'cap-3')
      expect([...useAppStore.getState().selectedCaptureIds].sort()).toEqual(['cap-2', 'cap-3'])
    })

    it('keeps selections made before the anchor when a range replaces itself', () => {
      useAppStore.getState().toggleCaptureSelection('cap-1')
      useAppStore.getState().setSelectionAnchor('cap-3')
      useAppStore.getState().selectCaptureRange(order, 'cap-5')
      useAppStore.getState().selectCaptureRange(order, 'cap-4')
      // cap-1 was selected before the anchor, so it survives; cap-5 was part of
      // the range the second click replaced, so it does not.
      expect([...useAppStore.getState().selectedCaptureIds].sort()).toEqual([
        'cap-1',
        'cap-3',
        'cap-4'
      ])
    })

    it('falls back to the target when the anchor is missing, and adopts it', () => {
      useAppStore.getState().selectCaptureRange(order, 'cap-3')
      expect([...useAppStore.getState().selectedCaptureIds]).toEqual(['cap-3'])
      expect(useAppStore.getState().selectionAnchorId).toBe('cap-3')
    })

    it('falls back to the target when the anchor is filtered out of the order', () => {
      useAppStore.getState().setSelectionAnchor('cap-hidden')
      useAppStore.getState().selectCaptureRange(order, 'cap-2')
      expect([...useAppStore.getState().selectedCaptureIds]).toEqual(['cap-2'])
      expect(useAppStore.getState().selectionAnchorId).toBe('cap-2')
    })

    it('does nothing when the target is not in the order', () => {
      useAppStore.getState().setSelectionAnchor('cap-1')
      useAppStore.getState().selectCaptureRange(order, 'cap-unknown')
      expect(useAppStore.getState().selectedCaptureIds.size).toBe(0)
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

  describe('tag filters (#918)', () => {
    it('adds a tag filter, and never twice', () => {
      useAppStore.getState().addTagFilter('tag-1')
      useAppStore.getState().addTagFilter('tag-1')
      expect(useAppStore.getState().activeTagFilters).toEqual(['tag-1'])
    })

    it('removes one tag filter and leaves the rest', () => {
      useAppStore.getState().addTagFilter('tag-1')
      useAppStore.getState().addTagFilter('tag-2')
      useAppStore.getState().removeTagFilter('tag-1')
      expect(useAppStore.getState().activeTagFilters).toEqual(['tag-2'])
    })

    it('clears the resolved ids when the last tag filter goes', () => {
      useAppStore.getState().addTagFilter('tag-1')
      useAppStore.getState().addTagFilter('tag-2')
      useAppStore.getState().setTagFilteredCaptureIds(['cap-1'])

      useAppStore.getState().removeTagFilter('tag-1')
      expect(useAppStore.getState().tagFilteredCaptureIds).toEqual(['cap-1'])

      useAppStore.getState().removeTagFilter('tag-2')
      expect(useAppStore.getState().tagFilteredCaptureIds).toBeNull()
    })

    it('clears all tag filters', () => {
      useAppStore.getState().addTagFilter('tag-1')
      useAppStore.getState().setTagFilteredCaptureIds(['cap-1'])
      useAppStore.getState().clearTagFilters()
      expect(useAppStore.getState().activeTagFilters).toEqual([])
      expect(useAppStore.getState().tagFilteredCaptureIds).toBeNull()
    })

    // The reason the tag filter has its own slot. Both selector paths null
    // `filteredCaptureIds` whenever the selector list empties, and the selector
    // hook does it on every mount; a shared slot would silently drop a tag
    // narrowing the strip is still naming.
    it('survives every selector-filter path that nulls the selector slot', () => {
      useAppStore.getState().addTagFilter('tag-1')
      useAppStore.getState().setTagFilteredCaptureIds(['cap-1'])
      useAppStore.getState().addSelectorFilter('sel-1')
      useAppStore.getState().setFilteredCaptureIds(['cap-1', 'cap-2'])

      useAppStore.getState().removeSelectorFilter('sel-1')
      expect(useAppStore.getState().filteredCaptureIds).toBeNull()
      expect(useAppStore.getState().tagFilteredCaptureIds).toEqual(['cap-1'])

      useAppStore.getState().clearSelectorFilters()
      expect(useAppStore.getState().activeTagFilters).toEqual(['tag-1'])
      expect(useAppStore.getState().tagFilteredCaptureIds).toEqual(['cap-1'])
    })

    it('leaves the selector filter alone when the tag filter is cleared', () => {
      useAppStore.getState().addSelectorFilter('sel-1')
      useAppStore.getState().setFilteredCaptureIds(['cap-1'])
      useAppStore.getState().addTagFilter('tag-1')

      useAppStore.getState().clearTagFilters()
      expect(useAppStore.getState().activeSelectorFilters).toEqual(['sel-1'])
      expect(useAppStore.getState().filteredCaptureIds).toEqual(['cap-1'])
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
