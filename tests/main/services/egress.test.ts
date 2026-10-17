import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { EgressSetting } from '@shared/types'

const ctl = vi.hoisted(() => ({
  egress: { kind: 'direct' } as EgressSetting,
  setProxy: vi.fn(async () => {}),
  sessionFetch: vi.fn(async () => new Response('routed')),
  fromPartition: vi.fn()
}))

vi.mock('electron', () => ({
  session: {
    fromPartition: (...args: unknown[]) => {
      ctl.fromPartition(...args)
      return { setProxy: ctl.setProxy, fetch: ctl.sessionFetch }
    }
  }
}))
vi.mock('@main/services/settings', () => ({ getSettings: () => ({ egress: ctl.egress }) }))

import {
  applyEgressToSession,
  captureEgressOf,
  createRoutedSession,
  egressFetch,
  EgressUnavailableError,
  knownEgress,
  proxyConfigFor,
  webRtcPolicyFor
} from '@main/services/egress'

const tor: EgressSetting = {
  kind: 'tor',
  proxyUrl: 'socks5://127.0.0.1:9150',
  label: 'Tor Browser'
}
const proxy: EgressSetting = { kind: 'proxy', proxyUrl: 'http://10.0.0.2:3128', label: '' }

describe('proxyConfigFor', () => {
  it('names the proxy alone, with no direct fallback, and routes loopback through it', () => {
    expect(proxyConfigFor(tor)).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'socks5://127.0.0.1:9150',
      proxyBypassRules: '<-loopback>'
    })
    expect(proxyConfigFor(tor).proxyRules).not.toContain('direct')
  })

  it('is plain direct for Direct', () => {
    expect(proxyConfigFor({ kind: 'direct' })).toEqual({ mode: 'direct' })
  })
})

describe('captureEgressOf', () => {
  it('records the kind and label, never the address', () => {
    expect(captureEgressOf(tor)).toEqual({ kind: 'tor', label: 'Tor Browser' })
    expect(JSON.stringify(captureEgressOf(tor))).not.toContain('9150')
  })

  it('omits an empty label, and records nothing for Direct', () => {
    expect(captureEgressOf(proxy)).toEqual({ kind: 'proxy' })
    expect(captureEgressOf({ kind: 'direct' })).toBeUndefined()
  })
})

describe('applyEgressToSession', () => {
  it('sets the configuration on the session it is given', async () => {
    const setProxy = vi.fn(async () => {})
    await applyEgressToSession({ setProxy } as unknown as Electron.Session, tor)
    expect(setProxy).toHaveBeenCalledWith(proxyConfigFor(tor))
  })
})

describe('egressFetch', () => {
  let globalFetch: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    ctl.setProxy.mockReset().mockResolvedValue(undefined)
    ctl.sessionFetch.mockReset().mockResolvedValue(new Response('routed'))
    ctl.fromPartition.mockReset()
    globalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('direct'))
  })

  afterEach(() => {
    globalFetch.mockRestore()
  })

  it('is the global fetch while the Egress is Direct', async () => {
    ctl.egress = { kind: 'direct' }
    const res = await egressFetch('https://web.archive.org/cdx', { method: 'GET' })
    expect(await res.text()).toBe('direct')
    expect(globalFetch).toHaveBeenCalledWith('https://web.archive.org/cdx', { method: 'GET' })
    expect(ctl.fromPartition).not.toHaveBeenCalled()
  })

  it('goes through an uncached session carrying the proxy otherwise', async () => {
    ctl.egress = tor
    const init = { method: 'POST' }
    const res = await egressFetch(new URL('http://timestamp.example/tsr'), init)
    expect(await res.text()).toBe('routed')
    expect(globalFetch).not.toHaveBeenCalled()
    expect(ctl.fromPartition).toHaveBeenCalledWith('egress-requests', { cache: false })
    expect(ctl.setProxy).toHaveBeenCalledWith(proxyConfigFor(tor))
    expect(ctl.sessionFetch).toHaveBeenCalledWith('http://timestamp.example/tsr', init)
  })

  it('applies the proxy once, and again when the setting changes', async () => {
    ctl.egress = { ...tor, proxyUrl: 'socks5://127.0.0.1:9050' }
    await egressFetch('https://a.example/')
    await egressFetch('https://b.example/')
    expect(ctl.setProxy).toHaveBeenCalledTimes(1)
    ctl.egress = proxy
    await egressFetch('https://c.example/')
    expect(ctl.setProxy).toHaveBeenCalledTimes(2)
    expect(ctl.setProxy).toHaveBeenLastCalledWith(proxyConfigFor(proxy))
  })

  it('fails, sending nothing, when the session refuses the proxy', async () => {
    ctl.egress = { ...proxy, proxyUrl: 'http://10.0.0.3:3128' }
    ctl.setProxy.mockRejectedValueOnce(new Error('bad proxy rules'))
    await expect(egressFetch('https://d.example/')).rejects.toThrow('bad proxy rules')
    expect(ctl.sessionFetch).not.toHaveBeenCalled()
    expect(globalFetch).not.toHaveBeenCalled()
  })
})

describe('the unavailable Egress (ADR-0032 rule 2)', () => {
  let globalFetch: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    ctl.sessionFetch.mockReset()
    globalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('direct'))
  })

  afterEach(() => {
    globalFetch.mockRestore()
  })

  it('refuses to name a route', () => {
    expect(() => knownEgress({ kind: 'unavailable' })).toThrow(EgressUnavailableError)
    expect(knownEgress(tor)).toBe(tor)
  })

  it('makes egressFetch fail before anything is sent', async () => {
    ctl.egress = { kind: 'unavailable' }
    await expect(egressFetch('https://web.archive.org/cdx')).rejects.toThrow(EgressUnavailableError)
    expect(globalFetch).not.toHaveBeenCalled()
    expect(ctl.sessionFetch).not.toHaveBeenCalled()
  })
})

describe('webRtcPolicyFor', () => {
  it('keeps UDP inside the proxy unless the Egress is Direct', () => {
    expect(webRtcPolicyFor({ kind: 'direct' })).toBe('default')
    expect(webRtcPolicyFor(tor)).toBe('disable_non_proxied_udp')
    expect(webRtcPolicyFor({ kind: 'unavailable' })).toBe('disable_non_proxied_udp')
  })
})

describe('createRoutedSession', () => {
  function fakeSession() {
    const pending: Array<{ resolve: () => void; reject: (err: Error) => void }> = []
    const setProxy = vi.fn(
      () => new Promise<void>((resolve, reject) => pending.push({ resolve, reject }))
    )
    return { session: { setProxy } as unknown as Electron.Session, setProxy, pending }
  }
  const flush = () => new Promise((resolve) => setImmediate(resolve))

  it('leaves a session Direct since creation untouched and open', () => {
    const { session, setProxy } = fakeSession()
    const route = createRoutedSession(session, vi.fn(), () => ({ kind: 'direct' }))
    expect(route.allowsRequests()).toBe(true)
    expect(setProxy).not.toHaveBeenCalled()
  })

  it('refuses requests until the current proxy is on the session', async () => {
    const { session, setProxy, pending } = fakeSession()
    const route = createRoutedSession(session, vi.fn(), () => tor)
    expect(setProxy).toHaveBeenCalledWith(proxyConfigFor(tor))
    expect(route.allowsRequests()).toBe(false)
    pending[0].resolve()
    await flush()
    expect(route.allowsRequests()).toBe(true)
  })

  it('closes on a change of setting until the new route is applied, Direct included', async () => {
    let egress: EgressSetting = tor
    const { session, setProxy, pending } = fakeSession()
    const route = createRoutedSession(session, vi.fn(), () => egress)
    pending[0].resolve()
    await flush()
    egress = { kind: 'direct' }
    route.sync(egress)
    expect(route.allowsRequests()).toBe(false)
    expect(setProxy).toHaveBeenLastCalledWith({ mode: 'direct' })
    pending[1].resolve()
    await flush()
    expect(route.allowsRequests()).toBe(true)
  })

  it('stays closed while the setting is unreadable, and opens once it reads again', async () => {
    let egress: EgressSetting = { kind: 'unavailable' }
    const { session, setProxy, pending } = fakeSession()
    const route = createRoutedSession(session, vi.fn(), () => egress)
    expect(route.allowsRequests()).toBe(false)
    expect(setProxy).not.toHaveBeenCalled()
    egress = tor
    expect(route.allowsRequests()).toBe(false)
    expect(setProxy).toHaveBeenCalledTimes(1)
    pending[0].resolve()
    await flush()
    expect(route.allowsRequests()).toBe(true)
  })

  it('stays closed after the session refuses a proxy, and does not retry it on every request', async () => {
    const onApplyFailed = vi.fn()
    const { session, setProxy, pending } = fakeSession()
    const route = createRoutedSession(session, onApplyFailed, () => tor)
    pending[0].reject(new Error('bad proxy rules'))
    await flush()
    expect(onApplyFailed).toHaveBeenCalledTimes(1)
    expect(route.allowsRequests()).toBe(false)
    expect(route.allowsRequests()).toBe(false)
    expect(setProxy).toHaveBeenCalledTimes(1)
  })

  it('shuts once open when the file becomes unreadable with no change event', async () => {
    let egress: EgressSetting = tor
    const { session, pending } = fakeSession()
    const route = createRoutedSession(session, vi.fn(), () => egress)
    pending[0].resolve()
    await flush()
    expect(route.allowsRequests()).toBe(true)
    egress = { kind: 'unavailable' }
    expect(route.allowsRequests()).toBe(false)
    egress = tor
    expect(route.allowsRequests()).toBe(true)
  })

  it('shuts and applies when the file is changed to a proxy outside the app', async () => {
    let egress: EgressSetting = { kind: 'direct' }
    const { session, setProxy, pending } = fakeSession()
    const route = createRoutedSession(session, vi.fn(), () => egress)
    expect(route.allowsRequests()).toBe(true)
    egress = tor
    expect(route.allowsRequests()).toBe(false)
    expect(setProxy).toHaveBeenCalledWith(proxyConfigFor(tor))
    pending[0].resolve()
    await flush()
    expect(route.allowsRequests()).toBe(true)
  })

  it('stays shut when an unreadable change arrives while a Direct apply is in flight', async () => {
    let egress: EgressSetting = tor
    const { session, pending } = fakeSession()
    const route = createRoutedSession(session, vi.fn(), () => egress)
    pending[0].resolve()
    await flush()
    egress = { kind: 'direct' }
    route.sync(egress)
    egress = { kind: 'unavailable' }
    route.sync(egress)
    pending[1].resolve()
    await flush()
    expect(route.allowsRequests()).toBe(false)
  })

  it('stays shut until the latest of two changes lands, whichever order they land in', async () => {
    let egress: EgressSetting = tor
    const other: EgressSetting = { kind: 'proxy', proxyUrl: 'http://10.0.0.2:3128', label: '' }
    const { session, pending } = fakeSession()
    const route = createRoutedSession(session, vi.fn(), () => egress)
    egress = other
    route.sync(egress)
    pending[1].resolve()
    await flush()
    pending[0].resolve()
    await flush()
    expect(route.allowsRequests()).toBe(false)
  })

  it('retries a refused proxy once another proxy has applied', async () => {
    let egress: EgressSetting = tor
    const other: EgressSetting = { kind: 'proxy', proxyUrl: 'http://10.0.0.2:3128', label: '' }
    const { session, setProxy, pending } = fakeSession()
    const route = createRoutedSession(session, vi.fn(), () => egress)
    pending[0].reject(new Error('bad proxy rules'))
    await flush()
    egress = other
    route.sync(egress)
    pending[1].resolve()
    await flush()
    egress = { kind: 'unavailable' }
    route.sync(egress)
    egress = tor
    expect(route.allowsRequests()).toBe(false)
    expect(setProxy).toHaveBeenCalledTimes(3)
    pending[2].resolve()
    await flush()
    expect(route.allowsRequests()).toBe(true)
  })

  it('tells onRoute each Egress it follows, once per change, unreadable included', async () => {
    let egress: EgressSetting = { kind: 'direct' }
    const onRoute = vi.fn()
    const { session } = fakeSession()
    const route = createRoutedSession(session, vi.fn(), () => egress, onRoute)
    route.allowsRequests()
    egress = tor
    route.allowsRequests()
    route.allowsRequests()
    egress = { kind: 'unavailable' }
    route.allowsRequests()
    expect(onRoute.mock.calls.map(([e]) => e.kind)).toEqual(['direct', 'tor', 'unavailable'])
  })
})
