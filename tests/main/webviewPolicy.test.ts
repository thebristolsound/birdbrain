/**
 * Known-answer coverage of the <webview> policy (#401).
 *
 * The Wayback compare puts two live guests on screen at once under two
 * partitions with opposite policies, and the discriminator between them is the
 * only thing standing between "the replay pane loads archive.org" and "the MHTML
 * evidence viewer will follow a link out of the artefact it was handed". Each
 * case below is an answer that must not change silently.
 *
 * `decideWebviewRequest` (#886, #810) is the same discriminator applied to every
 * request a guest issues rather than only its navigations, so the same wrong answer
 * has a second, wider way to arrive: an evidence viewer that fetches, or a replay
 * pane that reaches a host the operator never asked it to contact.
 */
import { describe, it, expect } from 'vitest'
import {
  allowWebviewPermission,
  decideWebviewAttach,
  decideWebviewDownload,
  decideWebviewNavigation,
  decideWebviewRequest,
  LEGACY_HTML_PARTITION,
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
  it('knows exactly the three partitions the app mounts', () => {
    expect(WEBVIEW_PARTITIONS).toEqual([
      MHTML_PARTITION,
      LEGACY_HTML_PARTITION,
      WAYBACK_PARTITION
    ])
    expect(webviewPolicyFor(MHTML_PARTITION)?.partition).toBe(MHTML_PARTITION)
    expect(webviewPolicyFor(LEGACY_HTML_PARTITION)?.partition).toBe(LEGACY_HTML_PARTITION)
    expect(webviewPolicyFor(WAYBACK_PARTITION)?.partition).toBe(WAYBACK_PARTITION)
  })

  it('refuses any partition it was not given', () => {
    // A persisted lookalike, a case variant, and the three absent forms.
    for (const partition of ['persist:mhtml-sandbox', 'MHTML-SANDBOX', '', null, undefined]) {
      expect(webviewPolicyFor(partition)).toBeNull()
    }
  })

  it('keeps JavaScript off for both evidence viewers and on for the replay pane', () => {
    expect(webviewPolicyFor(MHTML_PARTITION)?.javascript).toBe(false)
    expect(webviewPolicyFor(LEGACY_HTML_PARTITION)?.javascript).toBe(false)
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

  it('admits a file:// artefact on the legacy HTML partition', () => {
    const decision = decideWebviewAttach({
      partition: LEGACY_HTML_PARTITION,
      src: 'file:///c/case/cap.html'
    })
    expect(decision.allowed).toBe(true)
  })

  it.each([MHTML_PARTITION, LEGACY_HTML_PARTITION])(
    'refuses a remote src on the %s evidence viewer partition',
    (partition) => {
      // The load-bearing case: a wrong discriminator here would let an evidence
      // viewer load the network.
      expect(decideWebviewAttach({ partition, src: REPLAY_URL })).toEqual({
        allowed: false,
        reason: 'src-not-allowed'
      })
      expect(decideWebviewAttach({ partition, src: 'https://example.com/page.html' })).toEqual({
        allowed: false,
        reason: 'src-not-allowed'
      })
    }
  )

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

describe('decideWebviewRequest', () => {
  it('writes each partition’s allowed request hosts down rather than implying them', () => {
    // The list is the control. If it is ever widened, it is widened here, in a
    // diff, beside this answer — not arrived at by a filter forgetting to deny.
    expect(webviewPolicyFor(WAYBACK_PARTITION)?.allowedRequestHosts).toEqual(['web.archive.org'])
    expect(webviewPolicyFor(MHTML_PARTITION)?.allowedRequestHosts).toEqual([])
    expect(webviewPolicyFor(LEGACY_HTML_PARTITION)?.allowedRequestHosts).toEqual([])
  })

  it.each([
    [REPLAY_URL, 'the replay document itself'],
    [
      `${WAYBACK_REPLAY_PREFIX}20200114000000im_/https://example.com/logo.png`,
      'an archived subresource, rewritten back through the archive'
    ],
    [
      'https://web.archive.org/_static/js/bundle-playback.js',
      'the replay’s own toolbar asset, on the host but outside the replay prefix'
    ],
    [
      'https://WEB.ARCHIVE.ORG/web/20200114000000/https://example.com/',
      'the host in a case the prefix test alone would miss'
    ]
  ])('allows %s on the replay partition (%s)', (url) => {
    expect(decideWebviewRequest({ partition: WAYBACK_PARTITION, url })).toBe('allow')
  })

  it.each([
    ['https://tracker.example.test/beacon.gif?id=7', 'the phone-home this exists to stop'],
    ['https://fonts.example.test/inter.woff2', 'a font the archived page reached for live'],
    ['https://web.archive.org.evil.test/web/1/x', 'a suffix lookalike, not the host'],
    ['https://evil.test/?to=https://web.archive.org/web/', 'the host name sitting in a query'],
    ['https://web.archive.org@evil.test/beacon.gif', 'the host name sitting in userinfo'],
    ['http://web.archive.org/web/1/https://example.com/', 'plaintext http to the allowed host'],
    ['wss://web.archive.org/socket', 'a WebSocket to the allowed host'],
    ['file:///etc/passwd', 'a local file from the remote partition'],
    ['not a url', 'something that does not parse'],
    ['', 'no url at all']
  ])('blocks %s on the replay partition (%s)', (url) => {
    expect(decideWebviewRequest({ partition: WAYBACK_PARTITION, url })).toBe('block')
  })

  it('lets the evidence viewer read its artefact and nothing off the machine', () => {
    expect(
      decideWebviewRequest({ partition: MHTML_PARTITION, url: 'file:///c/a.mhtml' })
    ).toBe('allow')
    expect(
      decideWebviewRequest({ partition: MHTML_PARTITION, url: 'https://cdn.example.test/s.css' })
    ).toBe('block')
    expect(
      decideWebviewRequest({ partition: MHTML_PARTITION, url: 'https://tracker.example.test/p.gif' })
    ).toBe('block')
  })

  it('blocks the archive host itself on the evidence viewer partition', () => {
    // The load-bearing case, in request form: the discriminator is the only thing
    // keeping the replay pane's allow-list off the partition that renders evidence.
    expect(decideWebviewRequest({ partition: MHTML_PARTITION, url: REPLAY_URL })).toBe('block')
    expect(
      decideWebviewRequest({
        partition: MHTML_PARTITION,
        url: 'https://web.archive.org/_static/js/bundle-playback.js'
      })
    ).toBe('block')
  })

  // #906. A pre-v11 `format: 'html'` capture is a bare HTML file that still points
  // at the live origins it was taken from, so the subresource kinds below are the
  // literal contents of a legacy capture rather than a generic denial list. Each
  // one went out before this partition existed: the mount was an
  // `<iframe sandbox="" srcDoc>`, and `sandbox=""` governs scripts, forms and
  // popups but no fetch at all.
  it.each([
    ['https://cdn.example.test/logo.png', 'an <img> the archived page referenced'],
    ['https://cdn.example.test/site.css', 'a <link rel=stylesheet>'],
    ['https://fonts.example.test/inter.woff2', 'a web font'],
    ['https://ads.example.test/frame.html', 'a nested <iframe>'],
    ['https://media.example.test/clip.mp4', 'a <video> source'],
    ['https://cdn.example.test/app.js', 'a <script> the page would load'],
    ['https://tracker.example.test/p.gif?id=7', 'a tracking pixel, the disclosure itself'],
    ['http://cdn.example.test/logo.png', 'the same image over plaintext http'],
    [REPLAY_URL, 'the archive host, allowed only on the replay partition'],
    ['not a url', 'something that does not parse'],
    ['', 'no url at all']
  ])('blocks %s on the legacy HTML partition (%s)', (url) => {
    expect(decideWebviewRequest({ partition: LEGACY_HTML_PARTITION, url })).toBe('block')
  })

  it('lets the legacy HTML viewer read its own artefact off disk', () => {
    expect(
      decideWebviewRequest({ partition: LEGACY_HTML_PARTITION, url: 'file:///c/case/cap.html' })
    ).toBe('allow')
  })

  it('holds the legacy HTML guest on the one file it was handed', () => {
    expect(
      decideWebviewNavigation({
        partition: LEGACY_HTML_PARTITION,
        url: 'file:///c/case/cap.html',
        initialLoadDone: false
      })
    ).toBe('allow')
    expect(
      decideWebviewNavigation({
        partition: LEGACY_HTML_PARTITION,
        url: 'file:///c/case/cap.html',
        initialLoadDone: true
      })
    ).toBe('block')
    expect(
      decideWebviewNavigation({
        partition: LEGACY_HTML_PARTITION,
        url: 'https://example.com/',
        initialLoadDone: false
      })
    ).toBe('block')
  })

  it.each(['data:image/gif;base64,R0lGODlhAQABAAAAACw=', 'blob:null/2b6c-9f0e', 'about:blank'])(
    'allows %s on both partitions, since it never leaves the machine',
    (url) => {
      for (const partition of WEBVIEW_PARTITIONS) {
        expect(decideWebviewRequest({ partition, url })).toBe('allow')
      }
    }
  )

  it('blocks everything on a partition it does not know, including a local scheme', () => {
    for (const url of [REPLAY_URL, 'file:///c/a.mhtml', 'about:blank']) {
      expect(decideWebviewRequest({ partition: 'guest', url })).toBe('block')
      expect(decideWebviewRequest({ partition: null, url })).toBe('block')
    }
  })

  it('blocks an absent url on a partition it does know', () => {
    expect(decideWebviewRequest({ partition: WAYBACK_PARTITION, url: null })).toBe('block')
    expect(decideWebviewRequest({ partition: MHTML_PARTITION, url: undefined })).toBe('block')
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
