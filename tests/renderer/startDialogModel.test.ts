import { describe, expect, it } from 'vitest'
import type { KnownEgress } from '@shared/types'
import {
  NO_BROWSER_REFUSAL,
  busyRefusal,
  egressName,
  launchSteps,
  refusalFor
} from '@renderer/components/launchedBrowser/startDialogModel'

const PROXY: KnownEgress = {
  kind: 'proxy',
  proxyUrl: 'socks5://127.0.0.1:1080',
  label: 'Harbor relay'
}
const DIRECT: KnownEgress = { kind: 'direct' }
const BROWSER = {
  family: 'chrome' as const,
  label: 'Google Chrome',
  caseId: 'case-1',
  version: null,
  extensionWarnings: [],
  sessionStartedAt: null,
  tabs: []
}

function coded(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

describe('egressName', () => {
  it('names a routed Egress by kind and label, and Direct alone', () => {
    expect(egressName(PROXY)).toBe('Proxy · Harbor relay')
    expect(egressName({ kind: 'tor', proxyUrl: 'socks5://127.0.0.1:9050', label: 'Tor' })).toBe(
      'Tor · Tor'
    )
    expect(egressName(DIRECT)).toBe('Direct')
  })
})

// States 1 to 4 (`1j`), with the message main sent where it names what was reported.
describe('refusalFor', () => {
  it('names the browser that did not answer on its pipe, with the message main sent', () => {
    const message =
      'Google Chrome did not open its debugging connection within 20 seconds, so Birdbrain ' +
      'closed it.'
    expect(refusalFor(coded(message, 'BROWSER_NO_CONNECTION'), 'Google Chrome', PROXY)).toEqual({
      state: 2,
      title: "Google Chrome didn't respond",
      detail: `${message} A setting on this computer may be blocking it.`
    })
  })

  it.each(['EGRESS_PROXY_UNREACHABLE', 'EGRESS_PROXY_INVALID'])(
    'names the Egress a %s refusal could not use, and where to fix it',
    (code) => {
      const message =
        'The Egress proxy socks5://127.0.0.1:1080 did not accept a connection (connect ' +
        'ECONNREFUSED), so the browser was not started.'
      expect(refusalFor(coded(message, code), 'Google Chrome', PROXY)).toEqual({
        state: 3,
        title: "Can't reach Proxy · Harbor relay",
        detail: `${message} Check the proxy in Settings → Network.`
      })
    }
  )

  it('says only one launched browser can be open', () => {
    const error = coded(
      'Birdbrain runs one launched browser at a time, and Brave is already open.',
      'BROWSER_ALREADY_RUNNING'
    )
    expect(refusalFor(error, 'Google Chrome', PROXY)).toEqual({
      state: 4,
      title: 'A launched browser is already open',
      detail: 'Only one can be open at a time.'
    })
  })

  it.each(['BROWSER_UNRECOGNIZED', 'BROWSER_BELOW_FLOOR'])(
    'keeps what the browser reported for %s',
    (code) => {
      const message = 'Google Chrome reported Chrome/148.0.7778.97, older than 149.0.7827.55.'
      expect(refusalFor(coded(message, code), 'Google Chrome', PROXY)).toEqual({
        state: 1,
        title: 'Birdbrain closed Google Chrome',
        detail: message
      })
    }
  )

  it('sends the Operator back to Settings for a browser that is gone', () => {
    const message = 'Birdbrain no longer finds that browser. Choose it again in Settings.'
    expect(refusalFor(coded(message, 'BROWSER_NOT_FOUND'), 'Brave', DIRECT)).toEqual({
      state: 1,
      title: 'No supported browser found',
      detail: message
    })
  })

  it.each([
    'EGRESS_WEBRTC_CANDIDATE',
    'EGRESS_WEBRTC_UNCHECKED',
    'EGRESS_BYPASS',
    'EGRESS_UNWATCHED'
  ])('says a connection check closed the browser for %s', (code) => {
    const message = 'Google Chrome is not keeping WebRTC on the Egress proxy.'
    expect(refusalFor(coded(message, code), 'Google Chrome', PROXY)).toEqual({
      title: 'Browser closed by a connection check',
      detail: message
    })
  })

  it('points an unreadable Egress at the Network tab', () => {
    const error = coded('The Egress setting could not be read', 'EGRESS_UNAVAILABLE')
    expect(refusalFor(error, 'Google Chrome', DIRECT)).toEqual({
      title: 'Birdbrain could not read the Egress setting',
      detail: 'The browser was not started. Choose an Egress in Settings → Network.'
    })
  })

  it('passes any other failure on with its message', () => {
    const message = 'Google Chrome could not be started: spawn EACCES'
    expect(refusalFor(coded(message, 'BROWSER_SPAWN_FAILED'), 'Google Chrome', DIRECT)).toEqual({
      title: 'The launch failed',
      detail: message
    })
    expect(refusalFor(new Error('IPC result is missing its envelope'), 'Brave', DIRECT)).toEqual({
      title: 'The launch failed',
      detail: 'IPC result is missing its envelope'
    })
    expect(refusalFor('gone', 'Brave', DIRECT)).toEqual({
      title: 'The launch failed',
      detail: 'gone'
    })
  })
})

describe('the refusals shown before a launch', () => {
  it('has state 1 for no browser at all', () => {
    expect(NO_BROWSER_REFUSAL).toEqual({
      state: 1,
      title: 'No supported browser found',
      detail: 'Choose one in Settings → Capture.'
    })
  })

  it('has state 4 while another launched browser is starting, open or closing', () => {
    expect(busyRefusal({ state: 'open', browser: BROWSER })).toEqual({
      state: 4,
      title: 'A launched browser is already open',
      detail: 'Only one can be open at a time.'
    })
    expect(busyRefusal({ state: 'starting', browser: BROWSER, step: 'browser' })?.title).toBe(
      'A launched browser is starting'
    )
    expect(busyRefusal({ state: 'closing', browser: BROWSER })?.title).toBe(
      'A launched browser is closing'
    )
  })

  // A closed browser leaves its Capture Session running, and launching again joins it.
  it('has none with no browser, or one that has closed', () => {
    expect(busyRefusal({ state: 'none' })).toBeNull()
    expect(busyRefusal({ state: 'closed', browser: BROWSER })).toBeNull()
    expect(busyRefusal(undefined)).toBeNull()
  })
})

// The checklist (`1e`): what is done, what runs now, and what is left.
describe('launchSteps', () => {
  it('lists the proxy, the browser and the first tab for a routed Egress', () => {
    expect(launchSteps(PROXY, 'browser')).toEqual([
      { step: 'proxy', progress: 'done', text: 'Proxy · Harbor relay is reachable' },
      { step: 'browser', progress: 'current', text: 'Starting the browser' },
      { step: 'first-tab', progress: 'pending', text: 'Check the connection on the first tab' }
    ])
    expect(launchSteps(PROXY, 'proxy').map(({ text }) => text)).toEqual([
      'Reaching Proxy · Harbor relay',
      'Start the browser',
      'Check the connection on the first tab'
    ])
    expect(launchSteps(PROXY, 'first-tab').map(({ text }) => text)).toEqual([
      'Proxy · Harbor relay is reachable',
      'Browser started',
      'Checking the connection on the first tab'
    ])
  })

  it('marks every step done once the browser is open', () => {
    expect(launchSteps(PROXY, 'open')).toEqual([
      { step: 'proxy', progress: 'done', text: 'Proxy · Harbor relay is reachable' },
      { step: 'browser', progress: 'done', text: 'Browser started' },
      { step: 'first-tab', progress: 'done', text: 'First tab checked' }
    ])
  })

  it('has only the browser to start while the Egress is Direct', () => {
    expect(launchSteps(DIRECT, 'browser')).toEqual([
      { step: 'browser', progress: 'current', text: 'Starting the browser' }
    ])
  })
})
