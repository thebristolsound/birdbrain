// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { Capture } from '@shared/types'
import { fakeBridge } from '../fakeBridge'
import { queryKeys } from '@renderer/lib/api/keys'
import { subscribeToMainEvents, type MainEventRouter } from '@renderer/lib/api/events'
import { useAppStore } from '@renderer/stores/appStore'

type Handler = (payload: never) => void

function setup(pathname = '/') {
  const handlers: Record<string, Handler> = {}
  const unsubs: Record<string, ReturnType<typeof vi.fn>> = {}
  const capture = (name: string) =>
    vi.fn((cb: Handler) => {
      handlers[name] = cb
      unsubs[name] = vi.fn()
      return unsubs[name]
    })

  fakeBridge({
    onExtensionConnection: capture('extension'),
    onSessionStateChanged: capture('session'),
    onCaptureActivity: capture('activity'),
    onNewCapture: capture('newCapture'),
    onSelectorRematched: capture('rematch'),
    onDeepLinkNavigate: capture('deepLink')
  })

  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
  const router: MainEventRouter = {
    state: { location: { pathname } },
    navigate: vi.fn()
  }

  const unsubscribe = subscribeToMainEvents({ queryClient, router })
  return { handlers, unsubs, queryClient, invalidate, router, unsubscribe }
}

describe('subscribeToMainEvents', () => {
  beforeEach(() => {
    useAppStore.setState({ sessionActive: false, connectedToExtension: false })
  })

  it('onSelectorRematched invalidates the three selector key families', () => {
    const { handlers, invalidate, unsubscribe } = setup()

    handlers.rematch({ caseId: 'case1' } as never)

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['selectors', 'matchCounts', 'case1'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['selectors', 'coverage', 'case1'] })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['selectors', 'matchingCaptures', 'case1']
    })
    unsubscribe()
  })

  it('onNewCapture prepends to the captures cache and invalidates captureCounts', () => {
    const { handlers, queryClient, invalidate } = setup()
    const old = { id: 'old', caseId: 'case1' } as Capture
    const fresh = { id: 'new', caseId: 'case1' } as Capture
    queryClient.setQueryData(queryKeys.captures('case1'), [old])

    handlers.newCapture(fresh as never)

    expect(queryClient.getQueryData(queryKeys.captures('case1'))).toEqual([fresh, old])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.captureCounts })
  })

  it('onNewCapture seeds the captures cache when empty', () => {
    const { handlers, queryClient } = setup()
    const fresh = { id: 'new', caseId: 'case1' } as Capture

    handlers.newCapture(fresh as never)

    expect(queryClient.getQueryData(queryKeys.captures('case1'))).toEqual([fresh])
  })

  it('onExtensionConnection and onSessionStateChanged update the app store', () => {
    const { handlers } = setup()

    handlers.extension({ connected: true } as never)
    expect(useAppStore.getState().connectedToExtension).toBe(true)

    handlers.session({ sessionActive: true, activeCaseId: null, captureCount: 0 } as never)
    expect(useAppStore.getState().sessionActive).toBe(true)
  })

  it('navigates to the active case only when not already viewing it', () => {
    const away = setup('/')
    away.handlers.session({ sessionActive: true, activeCaseId: 'case1', captureCount: 1 } as never)
    expect(away.router.navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId',
      params: { caseId: 'case1' }
    })

    const onCase = setup('/cases/case1/captures')
    onCase.handlers.session({
      sessionActive: true,
      activeCaseId: 'case1',
      captureCount: 1
    } as never)
    expect(onCase.router.navigate).not.toHaveBeenCalled()
  })

  it('routes deep links to settings or home', () => {
    const { handlers, router } = setup()

    handlers.deepLink('settings' as never)
    expect(router.navigate).toHaveBeenCalledWith({ to: '/settings' })

    handlers.deepLink('home' as never)
    expect(router.navigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('returns a combined unsubscribe covering every channel', () => {
    const { unsubs, unsubscribe } = setup()

    unsubscribe()

    for (const name of ['extension', 'session', 'activity', 'newCapture', 'rematch', 'deepLink']) {
      expect(unsubs[name]).toHaveBeenCalledTimes(1)
    }
  })
})
