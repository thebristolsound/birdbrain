import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { createServer, type AddressInfo, type Server } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { localAddressKind } from '@shared/localAddress'
import type { EgressSetting, KnownEgress } from '@shared/types'
import { EgressUnavailableError } from '@main/services/egress'
import { createCdpClient } from '@main/services/launchedBrowser/cdpClient'
import type { NetworkResponse } from '@main/services/launchedBrowser/commands'
import {
  bypassedProxy,
  canonicalAddress,
  checkProxyAccepts,
  checkWebRtc,
  connectToProxy,
  EGRESS_CHECK_TIMEOUTS,
  prepareEgressChecks,
  webRtcCheckScript,
  type EgressCheckDeps,
  type ProxyEgress,
  type ProxyEndpoint
} from '@main/services/launchedBrowser/egressChecks'
import { launchBrowser } from '@main/services/launchedBrowser/launcher'
import {
  FakeBrowserProcess,
  fakeBrowser,
  settle,
  targetInfo,
  type FakeBrowserOptions,
  type FakeReply,
  type SentCommand
} from '../../../helpers/fakeLaunchedBrowser'

const CHROME = {
  family: 'chrome' as const,
  label: 'Google Chrome',
  executablePath: '/opt/google/chrome/chrome'
}
const DIRECT: KnownEgress = { kind: 'direct' }
const PROXY: ProxyEgress = { kind: 'proxy', proxyUrl: 'socks5://10.0.0.2:1080', label: 'Office' }
const NAMED: ProxyEgress = { kind: 'proxy', proxyUrl: 'socks5://proxy.example:1080', label: '' }
const NAMED_ADDRESSES = ['203.0.113.7', '2001:DB8:0:0::7']
const SITE_URL = 'https://site.example/private/path?q=1'
const ISOLATED_WORLD = 7

const accepts: EgressCheckDeps = {
  connect: async () => {},
  lookup: async () => NAMED_ADDRESSES
}

let sessionData: string

beforeEach(() => {
  sessionData = mkdtempSync(join(tmpdir(), 'birdbrain-egress-checks-'))
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(sessionData, { recursive: true, force: true })
})

function codeOf(error: unknown): unknown {
  return (error as { code?: unknown }).code
}

function endpoint(remoteIPAddress?: string, remotePort?: number): NetworkResponse {
  return { url: SITE_URL, status: 200, remoteIPAddress, remotePort }
}

function responseEvent(remoteIPAddress?: string, remotePort?: number) {
  return {
    requestId: 'r1',
    loaderId: 'l1',
    timestamp: 1,
    type: 'Document',
    response: endpoint(remoteIPAddress, remotePort)
  }
}

// Answers the WebRTC check with `value` as the count the script returned.
function webRtcCount(value: unknown, before: (command: SentCommand) => void = () => {}) {
  return (command: SentCommand): FakeReply | undefined => {
    before(command)
    if (command.method === 'Page.createIsolatedWorld') {
      return { result: { executionContextId: ISOLATED_WORLD } }
    }
    if (command.method === 'Runtime.evaluate') {
      return { result: { result: { type: typeof value, value } } }
    }
    return undefined
  }
}

interface GuardedSetup {
  egress?: EgressSetting
  deps?: EgressCheckDeps
  respond?: FakeBrowserOptions['respond']
}

async function launchGuarded({
  egress = PROXY,
  deps = accepts,
  respond = webRtcCount(0)
}: GuardedSetup = {}) {
  const guard = await prepareEgressChecks(egress, CHROME.label, deps)
  const fake = fakeBrowser({ respond })
  const launching = launchBrowser(
    { browser: CHROME, egress: guard.egress, sessionDataPath: sessionData, hooks: guard.hooks },
    { spawn: fake.spawn }
  )
  // Asserted later; marked handled so an early rejection is not reported before then.
  launching.catch(() => {})
  return { ...fake, guard, launching }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

describe('canonicalAddress', () => {
  it('writes each address one way, IPv6 in brackets, and refuses what is not an address', () => {
    expect(canonicalAddress('127.0.0.1')).toBe('127.0.0.1')
    expect(canonicalAddress('2001:DB8:0:0::1')).toBe('[2001:db8::1]')
    expect(canonicalAddress('[2001:db8::1]')).toBe('[2001:db8::1]')
    expect(canonicalAddress('::ffff:127.0.0.1')).toBe('[::ffff:7f00:1]')
    expect(canonicalAddress('fe80::1%eth0')).toBe('[fe80::1]')
    expect(canonicalAddress('proxy.example')).toBeNull()
    expect(canonicalAddress('')).toBeNull()
  })
})

describe('bypassedProxy', () => {
  const proxy: ProxyEndpoint = {
    url: 'socks5://proxy.example:1080',
    host: 'proxy.example',
    port: 1080,
    addresses: new Set(['203.0.113.7', '[2001:db8::7]'])
  }

  it.each([
    ['no endpoint', undefined, undefined],
    ['the empty endpoint a service worker response carries', '', 0],
    ['a loopback address', '127.0.0.1', 8080],
    ['an IPv6 loopback address', '::1', 8080],
    ['a bracketed IPv6 loopback address', '[::1]', 8080],
    ['an IPv4-mapped loopback address', '::ffff:127.0.0.1', 8080],
    ['an IPv4 link-local address', '169.254.10.1', 80],
    ['an IPv6 link-local address', 'fe80::1', 80],
    ['the proxy', '203.0.113.7', 1080],
    ['the proxy at its IPv6 address', '2001:db8::7', 1080],
    ['the proxy at its IPv6 address in brackets', '[2001:db8::7]', 1080]
  ])('passes a response from %s', (_name, address, port) => {
    expect(bypassedProxy(endpoint(address, port), proxy)).toBe(false)
  })

  it.each([
    ['a public address', '198.51.100.1', 1080],
    ['a private address, which the proxy carries', '10.0.0.5', 443],
    ['a public IPv6 address', '2001:db8::8', 1080],
    ['the proxy host on another port', '203.0.113.7', 443],
    ['the proxy host with no port', '203.0.113.7', undefined],
    ['an endpoint that is not an address', 'proxy.example', 1080]
  ])('flags a response from %s', (_name, address, port) => {
    expect(bypassedProxy(endpoint(address, port), proxy)).toBe(true)
  })
})

describe('checkProxyAccepts', () => {
  it('opens and closes a connection to the proxy, sending nothing', async () => {
    const received: Buffer[] = []
    let closed: () => void = () => {}
    const gone = new Promise<void>((resolve) => {
      closed = resolve
    })
    const server = createServer((socket) => {
      socket.on('data', (chunk: Buffer) => received.push(chunk))
      socket.on('close', () => closed())
    })
    const port = await listen(server)
    try {
      const proxyUrl = `socks5://127.0.0.1:${port}`
      const proxy = await checkProxyAccepts({ kind: 'tor', proxyUrl, label: 'Tor' })
      expect(proxy).toEqual({
        url: proxyUrl,
        host: '127.0.0.1',
        port,
        addresses: new Set(['127.0.0.1'])
      })
      await gone
      expect(received).toEqual([])
    } finally {
      await closeServer(server)
    }
  })

  it('refuses and names the proxy when nothing accepts', async () => {
    const server = createServer()
    const port = await listen(server)
    await closeServer(server)
    const proxyUrl = `socks5://127.0.0.1:${port}`
    const error = await checkProxyAccepts({ kind: 'tor', proxyUrl, label: 'Tor' }).catch(
      (err: unknown) => err
    )
    expect(codeOf(error)).toBe('EGRESS_PROXY_UNREACHABLE')
    expect((error as Error).message).toBe(
      `The Egress proxy ${proxyUrl} did not accept a connection ` +
        `(connect ECONNREFUSED 127.0.0.1:${port}), so the browser was not started.`
    )
  })

  it('gives up when the proxy does not answer within the timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let signal: AbortSignal | undefined
    const connect = vi.fn(
      (_host: string, _port: number, abort: AbortSignal) =>
        new Promise<void>((_, reject) => {
          signal = abort
          abort.addEventListener('abort', () => reject(abort.reason))
        })
    )
    const checking = checkProxyAccepts(PROXY, { connect })
    const outcome = checking.then(
      () => 'accepted',
      (err: unknown) => err
    )
    await vi.advanceTimersByTimeAsync(EGRESS_CHECK_TIMEOUTS.proxyConnectMs - 1)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const error = await outcome
    expect(signal?.aborted).toBe(true)
    expect(codeOf(error)).toBe('EGRESS_PROXY_UNREACHABLE')
    expect((error as Error).message).toBe(
      'The Egress proxy socks5://10.0.0.2:1080 did not accept a connection ' +
        '(no answer within 10 seconds), so the browser was not started.'
    )
    expect(connect).toHaveBeenCalledWith('10.0.0.2', 1080, signal)
  })

  it('resolves a proxy named by host, keeps every address, and connects by name', async () => {
    const connect = vi.fn(async () => {})
    const lookup = vi.fn(async () => NAMED_ADDRESSES)
    const proxy = await checkProxyAccepts(NAMED, { connect, lookup })
    expect(lookup).toHaveBeenCalledWith('proxy.example')
    expect(connect).toHaveBeenCalledWith('proxy.example', 1080, expect.any(AbortSignal))
    expect(proxy.addresses).toEqual(new Set(['203.0.113.7', '[2001:db8::7]']))
  })

  it('refuses a proxy host that does not resolve, without connecting', async () => {
    const connect = vi.fn(async () => {})
    const notFound = new Error('getaddrinfo ENOTFOUND proxy.example')
    const error = await checkProxyAccepts(NAMED, {
      connect,
      lookup: async () => {
        throw notFound
      }
    }).catch((err: unknown) => err)
    expect(codeOf(error)).toBe('EGRESS_PROXY_UNREACHABLE')
    expect((error as Error).message).toBe(
      'Birdbrain could not find the address of the Egress proxy socks5://proxy.example:1080 ' +
        '(getaddrinfo ENOTFOUND proxy.example), so the browser was not started.'
    )
    expect(connect).not.toHaveBeenCalled()
  })

  it('refuses a proxy host that resolves to no address', async () => {
    const connect = vi.fn(async () => {})
    const error = await checkProxyAccepts(NAMED, { connect, lookup: async () => [] }).catch(
      (err: unknown) => err
    )
    expect(codeOf(error)).toBe('EGRESS_PROXY_UNREACHABLE')
    expect((error as Error).message).toContain('(no address found)')
    expect(connect).not.toHaveBeenCalled()
  })

  it('connects to an IPv6 proxy without its brackets and looks nothing up', async () => {
    const connect = vi.fn(async () => {})
    const lookup = vi.fn(async () => [])
    const proxy = await checkProxyAccepts(
      { kind: 'tor', proxyUrl: 'socks5://[::1]:9050', label: '' },
      { connect, lookup }
    )
    expect(connect).toHaveBeenCalledWith('::1', 9050, expect.any(AbortSignal))
    expect(lookup).not.toHaveBeenCalled()
    expect(proxy.addresses).toEqual(new Set(['[::1]']))
  })

  it("reads http's default port, which the parsed address leaves out", async () => {
    const connect = vi.fn(async () => {})
    const proxy = await checkProxyAccepts(
      { kind: 'proxy', proxyUrl: 'http://10.0.0.2:80', label: '' },
      { connect }
    )
    expect(proxy.port).toBe(80)
    expect(connect).toHaveBeenCalledWith('10.0.0.2', 80, expect.any(AbortSignal))
  })

  it('refuses a proxy address that does not parse, without connecting', async () => {
    const connect = vi.fn(async () => {})
    const error = await checkProxyAccepts(
      { kind: 'proxy', proxyUrl: 'ftp://10.0.0.2:21', label: '' },
      { connect }
    ).catch((err: unknown) => err)
    expect(codeOf(error)).toBe('EGRESS_PROXY_INVALID')
    expect(connect).not.toHaveBeenCalled()
  })

  it('resolves localhost with the system resolver to loopback addresses', async () => {
    const server = createServer()
    const port = await listen(server)
    try {
      const proxy = await checkProxyAccepts(
        { kind: 'tor', proxyUrl: `socks5://localhost:${port}`, label: '' },
        { connect: async () => {} }
      )
      expect(proxy.addresses.size).toBeGreaterThan(0)
      for (const address of proxy.addresses) {
        expect(localAddressKind(`http://${address}/`)).toBe('loopback')
      }
    } finally {
      await closeServer(server)
    }
  })
})

describe('connectToProxy', () => {
  it('stops when its signal is aborted', async () => {
    const server = createServer()
    const port = await listen(server)
    try {
      await expect(connectToProxy('127.0.0.1', port, AbortSignal.abort())).rejects.toMatchObject({
        name: 'AbortError'
      })
    } finally {
      await closeServer(server)
    }
  })
})

describe('prepareEgressChecks', () => {
  it('refuses an Egress that could not be read, without connecting', async () => {
    const connect = vi.fn(async () => {})
    await expect(
      prepareEgressChecks({ kind: 'unavailable' }, CHROME.label, { connect })
    ).rejects.toBeInstanceOf(EgressUnavailableError)
    expect(connect).not.toHaveBeenCalled()
  })

  it('checks nothing while the Egress is Direct', async () => {
    const connect = vi.fn(async () => {})
    const lookup = vi.fn(async () => [])
    const guard = await prepareEgressChecks(DIRECT, CHROME.label, { connect, lookup })
    expect(guard).toMatchObject({ egress: DIRECT, proxy: null })
    expect(guard.hooks).toEqual({})
    expect(connect).not.toHaveBeenCalled()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('launches with the very Egress it checked', async () => {
    const guard = await prepareEgressChecks(PROXY, CHROME.label, accepts)
    expect(guard.egress).toBe(PROXY)
    expect(guard.proxy).toMatchObject({ host: '10.0.0.2', port: 1080 })
  })

  it('sends no command and watches nothing under Direct', async () => {
    const { browser, guard, launching } = await launchGuarded({ egress: DIRECT })
    const launched = await launching
    const onBypass = vi.fn()
    guard.enforce(launched, onBypass)
    browser.event('Network.responseReceived', responseEvent('198.51.100.1', 443), 'session-1')
    await settle()
    expect(onBypass).not.toHaveBeenCalled()
    expect(browser.methods()).not.toContain('Page.createIsolatedWorld@session-1')
    await launched.stop()
  })
})

describe('checkWebRtc', () => {
  function firstTab(respond: FakeBrowserOptions['respond']) {
    const browser = new FakeBrowserProcess({ respond })
    const client = createCdpClient({
      toBrowser: browser.toBrowser,
      fromBrowser: browser.fromBrowser
    })
    return { browser, tab: { targetId: 'first-tab', session: client.session('session-1') } }
  }

  it('counts candidates from an isolated world on the tab, with no Page domain enabled', async () => {
    const { browser, tab } = firstTab(webRtcCount(0))
    await checkWebRtc(tab, CHROME.label, 1_500)
    expect(browser.methods()).toEqual([
      'Page.createIsolatedWorld@session-1',
      'Runtime.evaluate@session-1'
    ])
    const [isolated, evaluate] = browser.commands
    expect(isolated.params).toEqual({ frameId: 'first-tab', worldName: 'birdbrain-egress-check' })
    expect(evaluate.params).toEqual({
      expression: webRtcCheckScript(1_500),
      contextId: ISOLATED_WORLD,
      awaitPromise: true,
      returnByValue: true
    })
  })

  it('gathers with no ICE servers, counts each candidate, and stops at the deadline', () => {
    const script = webRtcCheckScript(1_500)
    expect(script).toContain('new RTCPeerConnection({ iceServers: [] })')
    expect(script).toContain('setTimeout(resolve, 1500)')
    expect(script).toContain('return count')
  })

  it.each([
    ['one candidate', 1, 'found 1 WebRTC candidate outside the proxy'],
    ['two candidates', 2, 'found 2 WebRTC candidates outside the proxy']
  ])('refuses the browser on %s', async (_name, count, wording) => {
    const { tab } = firstTab(webRtcCount(count))
    const error = await checkWebRtc(tab, CHROME.label).catch((err: unknown) => err)
    expect(codeOf(error)).toBe('EGRESS_WEBRTC_CANDIDATE')
    expect((error as Error).message).toBe(
      `Google Chrome is not keeping WebRTC on the Egress proxy: a check on its first tab ${wording}. ` +
        'Birdbrain closed the browser.'
    )
  })

  it('fails closed when the check script throws', async () => {
    const { tab } = firstTab((command) =>
      command.method === 'Runtime.evaluate'
        ? {
            result: {
              result: { type: 'object' },
              exceptionDetails: {
                exceptionId: 1,
                text: 'Uncaught',
                lineNumber: 0,
                columnNumber: 0,
                exception: { type: 'object', description: 'TypeError: no RTCPeerConnection' }
              }
            }
          }
        : webRtcCount(0)(command)
    )
    const error = await checkWebRtc(tab, CHROME.label).catch((err: unknown) => err)
    expect(codeOf(error)).toBe('EGRESS_WEBRTC_UNCHECKED')
    expect((error as Error).message).toBe(
      'Birdbrain could not check WebRTC in Google Chrome (TypeError: no RTCPeerConnection), ' +
        'so it closed the browser.'
    )
  })

  it('fails closed on an exception with no description, naming its text', async () => {
    const { tab } = firstTab((command) =>
      command.method === 'Runtime.evaluate'
        ? {
            result: {
              result: { type: 'object' },
              exceptionDetails: { exceptionId: 1, text: 'Uncaught', lineNumber: 0, columnNumber: 0 }
            }
          }
        : webRtcCount(0)(command)
    )
    const error = await checkWebRtc(tab, CHROME.label).catch((err: unknown) => err)
    expect((error as Error).message).toContain('(Uncaught)')
  })

  it.each([
    [
      'no result',
      (command: SentCommand) =>
        command.method === 'Runtime.evaluate' ? { result: {} } : webRtcCount(0)(command)
    ],
    ['a string', webRtcCount('0')],
    ['a fraction', webRtcCount(0.5)],
    ['a negative count', webRtcCount(-1)]
  ])('fails closed when the check returns %s', async (_name, respond) => {
    const { tab } = firstTab(respond)
    const error = await checkWebRtc(tab, CHROME.label).catch((err: unknown) => err)
    expect(codeOf(error)).toBe('EGRESS_WEBRTC_UNCHECKED')
    expect((error as Error).message).toBe(
      'Birdbrain could not check WebRTC in Google Chrome (the check returned no count), ' +
        'so it closed the browser.'
    )
  })

  it('fails closed when the isolated world cannot be created', async () => {
    const { tab } = firstTab((command) =>
      command.method === 'Page.createIsolatedWorld'
        ? { error: { message: 'No frame for given id found' } }
        : undefined
    )
    const error = await checkWebRtc(tab, CHROME.label).catch((err: unknown) => err)
    expect(codeOf(error)).toBe('EGRESS_WEBRTC_UNCHECKED')
    expect((error as Error).message).toContain('No frame for given id found')
  })
})

describe('the Egress checks in a launch', () => {
  it('closes the browser before any held tab runs when the first tab gathers a candidate', async () => {
    const ref: { browser?: FakeBrowserProcess } = {}
    const { browser, launching } = await launchGuarded({
      respond: webRtcCount(1, ({ method }) => {
        if (method === 'Page.createIsolatedWorld') {
          ref.browser?.attach(targetInfo('popup', 'page', ''), { waiting: true })
        }
      })
    })
    ref.browser = browser
    const error = await launching.catch((err: unknown) => err)
    expect(codeOf(error)).toBe('EGRESS_WEBRTC_CANDIDATE')
    expect(browser.signals).toEqual(['SIGKILL'])
    expect(browser.methods()).toContain('Network.enable@session-2')
    expect(browser.methods().some((m) => m.startsWith('Runtime.runIfWaitingForDebugger'))).toBe(
      false
    )
  })

  it('resumes the held tabs once the first tab gathers no candidate', async () => {
    const ref: { browser?: FakeBrowserProcess } = {}
    const { browser, launching } = await launchGuarded({
      respond: webRtcCount(0, ({ method }) => {
        if (method === 'Page.createIsolatedWorld') {
          ref.browser?.attach(targetInfo('popup', 'page', ''), { waiting: true })
        }
      })
    })
    ref.browser = browser
    const launched = await launching
    await settle()
    const methods = browser.methods()
    expect(methods.indexOf('Runtime.runIfWaitingForDebugger@session-2')).toBeGreaterThan(
      methods.indexOf('Runtime.evaluate@session-1')
    )
    expect(browser.signals).toEqual([])
    await launched.stop()
  })

  it('closes the browser through the launch when the WebRTC check cannot run', async () => {
    const { browser, launching } = await launchGuarded({
      respond: (command) =>
        command.method === 'Page.createIsolatedWorld'
          ? { error: { message: 'No frame for given id found' } }
          : undefined
    })
    const error = await launching.catch((err: unknown) => err)
    expect(codeOf(error)).toBe('EGRESS_WEBRTC_UNCHECKED')
    expect(browser.signals).toEqual(['SIGKILL'])
  })

  it('closes the browser on a response from outside the proxy, naming no URL or address', async () => {
    const { browser, guard, launching } = await launchGuarded()
    const launched = await launching
    const onBypass = vi.fn()
    guard.enforce(launched, onBypass)
    browser.event('Network.responseReceived', responseEvent('198.51.100.1', 443), 'session-1')
    browser.event('Network.responseReceived', responseEvent('198.51.100.2', 443), 'session-1')
    await settle()
    expect(onBypass).toHaveBeenCalledTimes(1)
    const [error, closing] = onBypass.mock.calls[0] as [Error, Promise<unknown>]
    expect(codeOf(error)).toBe('EGRESS_BYPASS')
    expect(error.message).toBe(
      'A response in Google Chrome did not come through the Egress proxy, ' +
        'so Birdbrain closed the browser.'
    )
    expect(browser.methods()).toContain('Browser.close')
    await expect(closing).resolves.toMatchObject({ code: 0 })
  })

  it('watches every recorded tab, not only the first', async () => {
    const { browser, guard, launching } = await launchGuarded()
    const launched = await launching
    const onBypass = vi.fn()
    guard.enforce(launched, onBypass)
    const popup = browser.attach(targetInfo('popup', 'page', ''), { waiting: true })
    await settle()
    browser.event('Network.responseReceived', responseEvent('198.51.100.1', 443), popup)
    await settle()
    expect(onBypass).toHaveBeenCalledTimes(1)
    await onBypass.mock.calls[0][1]
  })

  it('keeps the browser open for responses through the proxy and from this machine', async () => {
    const { browser, guard, launching } = await launchGuarded()
    const launched = await launching
    const onBypass = vi.fn()
    guard.enforce(launched, onBypass)
    browser.event('Network.responseReceived', responseEvent('10.0.0.2', 1080), 'session-1')
    browser.event('Network.responseReceived', responseEvent('127.0.0.1', 8080), 'session-1')
    browser.event('Network.responseReceived', responseEvent('', 0), 'session-1')
    await settle()
    expect(onBypass).not.toHaveBeenCalled()
    expect(browser.methods()).not.toContain('Browser.close')
    await launched.stop()
  })

  it('matches every address of a proxy named by host, in either IPv6 form', async () => {
    const { browser, guard, launching } = await launchGuarded({ egress: NAMED })
    const launched = await launching
    const onBypass = vi.fn()
    guard.enforce(launched, onBypass)
    browser.event('Network.responseReceived', responseEvent('203.0.113.7', 1080), 'session-1')
    browser.event('Network.responseReceived', responseEvent('2001:db8::7', 1080), 'session-1')
    browser.event('Network.responseReceived', responseEvent('[2001:db8::7]', 1080), 'session-1')
    await settle()
    expect(onBypass).not.toHaveBeenCalled()
    browser.event('Network.responseReceived', responseEvent('2001:db8::8', 1080), 'session-1')
    await settle()
    expect(onBypass).toHaveBeenCalledTimes(1)
    await onBypass.mock.calls[0][1]
  })

  it('refuses the launch when a response bypasses the proxy during the first-tab check', async () => {
    const ref: { browser?: FakeBrowserProcess } = {}
    const { browser, launching } = await launchGuarded({
      respond: (command) => {
        if (command.method === 'Page.createIsolatedWorld') {
          ref.browser?.event(
            'Network.responseReceived',
            responseEvent('198.51.100.1', 443),
            'session-1'
          )
          return { result: { executionContextId: ISOLATED_WORLD } }
        }
        // The check never answers, so only the bypass can end it.
        return command.method === 'Runtime.evaluate' ? 'silent' : undefined
      }
    })
    ref.browser = browser
    const outcome = launching.then(
      () => 'launched',
      (err: unknown) => codeOf(err)
    )
    await settle(30)
    expect(await Promise.race([outcome, Promise.resolve('still checking')])).toBe('EGRESS_BYPASS')
    expect(browser.signals).toEqual(['SIGKILL'])
  })

  // The popup's Network.enable fails while the browser still lists it, or lists only the first tab.
  function popupUnwatched(open: string[]): FakeBrowserOptions['respond'] {
    return (command) => {
      const { method, sessionId } = command
      if (method === 'Network.enable' && sessionId === 'session-2') {
        return { error: { message: 'Not allowed' } }
      }
      if (method === 'Target.getTargets') {
        return { result: { targetInfos: open.map((id) => targetInfo(id)) } }
      }
      return webRtcCount(0)(command)
    }
  }

  it('closes the browser when a tab stays open after its setup failed, naming the failure', async () => {
    const { browser, guard, launching } = await launchGuarded({
      respond: popupUnwatched(['first-tab', 'popup'])
    })
    const launched = await launching
    const onBypass = vi.fn()
    guard.enforce(launched, onBypass)
    browser.attach(targetInfo('popup', 'page', ''), { waiting: true })
    await settle()
    expect(onBypass).toHaveBeenCalledTimes(1)
    const [error, closing] = onBypass.mock.calls[0] as [Error, Promise<unknown>]
    expect(codeOf(error)).toBe('EGRESS_UNWATCHED')
    expect(error.message).toBe(
      'Birdbrain could not watch the responses of a tab in Google Chrome ' +
        '(Network.enable failed: Not allowed), so it closed the browser.'
    )
    await expect(closing).resolves.toMatchObject({ code: 0 })
  })

  it('keeps the browser open when the tab that failed its setup has closed', async () => {
    const { browser, guard, launching } = await launchGuarded({
      respond: popupUnwatched(['first-tab'])
    })
    const launched = await launching
    const onBypass = vi.fn()
    guard.enforce(launched, onBypass)
    browser.attach(targetInfo('popup', 'page', ''), { waiting: true })
    await settle()
    expect(onBypass).not.toHaveBeenCalled()
    await launched.stop()
  })

  it('refuses the launch when a held tab fails its setup during the first-tab check', async () => {
    const ref: { browser?: FakeBrowserProcess } = {}
    const { browser, launching } = await launchGuarded({
      respond: (command) => {
        if (command.method === 'Page.createIsolatedWorld') {
          ref.browser?.attach(targetInfo('popup', 'page', ''), { waiting: true })
        }
        // The check never answers, so only the unwatched tab can end it.
        if (command.method === 'Runtime.evaluate') return 'silent'
        return popupUnwatched(['first-tab', 'popup'])(command)
      }
    })
    ref.browser = browser
    const error = await launching.catch((err: unknown) => err)
    expect(codeOf(error)).toBe('EGRESS_UNWATCHED')
    expect(browser.signals).toEqual(['SIGKILL'])
  })

  it('reports a bypass seen before enforce was called', async () => {
    const { browser, guard, launching } = await launchGuarded()
    const launched = await launching
    browser.event('Network.responseReceived', responseEvent('198.51.100.1', 443), 'session-1')
    await settle()
    const onBypass = vi.fn()
    guard.enforce(launched, onBypass)
    await settle()
    expect(onBypass).toHaveBeenCalledTimes(1)
    await onBypass.mock.calls[0][1]
  })
})
