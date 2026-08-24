/**
 * Known-answer coverage of the <webview> policy (#401).
 *
 * The Wayback compare puts two live guests on screen at once under two
 * partitions with opposite policies, and the discriminator between them is the
 * only thing standing between "the replay pane loads archive.org" and "the MHTML
 * evidence viewer will follow a link out of the artefact it was handed". Each
 * case below is an answer that must not change silently.
 */
import { describe, it, expect } from 'vitest'
import {
  allowWebviewPermission,
  decideWebviewAttach,
  decideWebviewDownload,
  decideWebviewNavigation,
  MHTML_PARTITION,
  resolveAttachPartition,
  sanitizeWebviewPreferences,
  WAYBACK_PARTITION,
  WAYBACK_REPLAY_PREFIX,
  webviewPolicyFor,
  WEBVIEW_PARTITIONS
} from '@main/webviewPolicy'

const REPLAY_URL = `${WAYBACK_REPLAY_PREFIX}20200114000000/https://example.com/`

describe('webviewPolicyFor', () => {
  it('knows exactly the two partitions the app mounts', () => {
    expect(WEBVIEW_PARTITIONS).toEqual([MHTML_PARTITION, WAYBACK_PARTITION])
    expect(webviewPolicyFor(MHTML_PARTITION)?.partition).toBe(MHTML_PARTITION)
    expect(webviewPolicyFor(WAYBACK_PARTITION)?.partition).toBe(WAYBACK_PARTITION)
  })

  it('refuses any partition it was not given', () => {
    // A persisted lookalike, a case variant, and the three absent forms.
    for (const partition of ['persist:mhtml-sandbox', 'MHTML-SANDBOX', '', null, undefined]) {
      expect(webviewPolicyFor(partition)).toBeNull()
    }
  })

  it('keeps JavaScript off for the evidence viewer and on for the replay pane', () => {
    expect(webviewPolicyFor(MHTML_PARTITION)?.javascript).toBe(false)
    expect(webviewPolicyFor(WAYBACK_PARTITION)?.javascript).toBe(true)
  })
})

describe('resolveAttachPartition', () => {
  it('prefers the webview attribute, falling back to the resolved preferences', () => {
    expect(resolveAttachPartition({ partition: WAYBACK_PARTITION }, { partition: 'other' })).toBe(
      WAYBACK_PARTITION
    )
    expect(resolveAttachPartition({}, { partition: MHTML_PARTITION })).toBe(MHTML_PARTITION)
    expect(resolveAttachPartition({ partition: '' }, {})).toBeNull()
    expect(resolveAttachPartition(null, null)).toBeNull()
    // A non-string attribute is not a partition, whatever it stringifies to.
    expect(resolveAttachPartition({ partition: 7 }, {})).toBeNull()
  })
})

describe('decideWebviewAttach', () => {
  it('admits an archive.org replay URL on the wayback partition', () => {
    const decision = decideWebviewAttach({ partition: WAYBACK_PARTITION, src: REPLAY_URL })
    expect(decision).toEqual({ allowed: true, policy: webviewPolicyFor(WAYBACK_PARTITION) })
  })

  it('admits a file:// artefact on the mhtml partition', () => {
    const decision = decideWebviewAttach({ partition: MHTML_PARTITION, src: 'file:///c/a.mhtml' })
    expect(decision.allowed).toBe(true)
  })

  it.each([
    ['https://web.archive.org/about/', 'archive.org outside the replay path'],
    ['https://webarchive.org.evil.test/web/', 'a host that merely starts the same way'],
    ['http://web.archive.org/web/1/https://example.com/', 'plaintext http'],
    ['file:///etc/passwd', 'a local file on the remote partition'],
    ['', 'no src at all']
  ])('refuses %s on the wayback partition (%s)', (src) => {
    expect(decideWebviewAttach({ partition: WAYBACK_PARTITION, src })).toEqual({
      allowed: false,
      reason: 'src-not-allowed'
    })
  })

  it('refuses a remote src on the evidence viewer partition', () => {
    // The load-bearing case: a wrong discriminator here would let the MHTML
    // viewer load the network.
    expect(decideWebviewAttach({ partition: MHTML_PARTITION, src: REPLAY_URL })).toEqual({
      allowed: false,
      reason: 'src-not-allowed'
    })
  })

  it('refuses any partition it does not know, whatever the src', () => {
    expect(decideWebviewAttach({ partition: 'guest', src: REPLAY_URL })).toEqual({
      allowed: false,
      reason: 'unknown-partition'
    })
    expect(decideWebviewAttach({ partition: undefined, src: 'file:///a.mhtml' })).toEqual({
      allowed: false,
      reason: 'unknown-partition'
    })
  })
})

describe('sanitizeWebviewPreferences', () => {
  it('strips a preload and forces isolation whatever the renderer asked for', () => {
    const prefs: Record<string, unknown> = {
      preload: '/tmp/evil.js',
      preloadURL: 'file:///tmp/evil.js',
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      nodeIntegrationInSubFrames: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      experimentalFeatures: true,
      webviewTag: true
    }
    sanitizeWebviewPreferences(prefs, webviewPolicyFor(WAYBACK_PARTITION)!)

    expect('preload' in prefs).toBe(false)
    expect('preloadURL' in prefs).toBe(false)
    expect(prefs).toMatchObject({
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      javascript: true
    })
  })

  it('carries the partition’s JavaScript setting rather than a global default', () => {
    const prefs: Record<string, unknown> = { javascript: true }
    sanitizeWebviewPreferences(prefs, webviewPolicyFor(MHTML_PARTITION)!)
    expect(prefs.javascript).toBe(false)
  })
})

describe('decideWebviewNavigation', () => {
  it('allows the evidence viewer exactly one file:// load', () => {
    expect(
      decideWebviewNavigation({
        partition: MHTML_PARTITION,
        url: 'file:///c/a.mhtml',
        initialLoadDone: false
      })
    ).toBe('allow')
    expect(
      decideWebviewNavigation({
        partition: MHTML_PARTITION,
        url: 'file:///c/b.mhtml',
        initialLoadDone: true
      })
    ).toBe('block')
  })

  it('blocks a remote navigation from the evidence viewer at any point', () => {
    expect(
      decideWebviewNavigation({
        partition: MHTML_PARTITION,
        url: 'https://example.com/',
        initialLoadDone: false
      })
    ).toBe('block')
  })

  it('lets the replay pane follow archive.org redirects, but only inside the prefix', () => {
    expect(
      decideWebviewNavigation({
        partition: WAYBACK_PARTITION,
        url: REPLAY_URL,
        initialLoadDone: true
      })
    ).toBe('allow')
    expect(
      decideWebviewNavigation({
        partition: WAYBACK_PARTITION,
        url: 'https://example.com/',
        initialLoadDone: true
      })
    ).toBe('block')
    expect(
      decideWebviewNavigation({
        partition: WAYBACK_PARTITION,
        url: 'https://web.archive.org/account/login',
        initialLoadDone: true
      })
    ).toBe('block')
  })

  it('blocks everything on an unknown partition or a missing url', () => {
    expect(
      decideWebviewNavigation({ partition: null, url: REPLAY_URL, initialLoadDone: false })
    ).toBe('block')
    expect(
      decideWebviewNavigation({ partition: WAYBACK_PARTITION, url: null, initialLoadDone: false })
    ).toBe('block')
  })
})

describe('permissions and downloads', () => {
  it.each([
    'media',
    'geolocation',
    'notifications',
    'midi',
    'midiSysex',
    'pointerLock',
    'fullscreen',
    'openExternal',
    'clipboard-read',
    'clipboard-sanitized-write',
    'display-capture',
    'idle-detection',
    'window-management',
    'unknown-future-permission'
  ])('denies %s on every partition', (permission) => {
    for (const partition of WEBVIEW_PARTITIONS) {
      expect(allowWebviewPermission(partition, permission)).toBe(false)
    }
    expect(allowWebviewPermission(null, permission)).toBe(false)
  })

  it('always blocks a download', () => {
    expect(decideWebviewDownload()).toBe('block')
  })
})
