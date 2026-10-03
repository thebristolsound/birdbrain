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
 *
 * Every answer that varies by partition is read from `PARTITION_EXPECTATIONS` and
 * asserted for each entry in `WEBVIEW_PARTITIONS` (#949). The cases that used to
 * name a partition literally are the reason a partition could be added with no
 * remote-`file:` case and no host-denial case at all: a loop over the list finds a
 * new partition, and a table it has no row in fails rather than skips it.
 */
import { describe, it, expect } from 'vitest'
import {
  allowWebviewPermission,
  decideFrameNavigation,
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

/**
 * A `file:` URL is local only when its authority is empty (#904). Each of these
 * satisfied `url.startsWith('file://')` and so was allowed on `mhtml-sandbox`, whose
 * `allowedRequestHosts` is empty precisely so that nothing leaves the machine. On
 * Windows every one of them is a UNC path, which Chromium fetches over SMB and which
 * Windows authenticates to automatically — so the leak is the operator's account name
 * and a crackable NTLMv2 response, not only the fact that they are reading this page.
 *
 * The five entries are three syntaxes for one authority, not three defects: the plain
 * form (in a name, an address and an upper-cased variant), the four-slash one that
 * parses to an empty host with the target left in the path, and the credentialled one
 * that `URL` refuses to parse at all while Chromium's own parser reads a host out of it.
 */
const REMOTE_FILE_URLS: readonly string[] = [
  'file://evil.test/share/beacon.png',
  'file://192.0.2.5/s/x.css',
  'file://EVIL.TEST/share/x.png',
  'file:////evil.test/share/x.png',
  'file://user:pw@evil.test/share/x.png'
]

/**
 * The one `file:` authority `isRemoteFileUrl` does not refuse: `URL` normalises
 * `localhost` away to the empty host, so the string reaches the prefix test still
 * carrying the name while parsing as local. `file://` matches it and `file:///` does
 * not, which makes it the only shape the legacy partition's third slash decides on
 * its own — and therefore the case that fails if that narrowing is reverted (#939).
 * `pathToFileURL` never emits this form, so nothing in the app reaches either answer.
 */
const LOCALHOST_FILE_URLS: readonly string[] = [
  'file://localhost/tmp/cap.html',
  'file://LOCALHOST/tmp/cap.html',
  'file://localhost/C:/case/cap.html'
]

// #906. A pre-v11 `format: 'html'` capture is a bare HTML file that still points
// at the live origins it was taken from, so the subresource kinds below are the
// literal contents of a legacy capture rather than a generic denial list. No
// partition may reach any of them: the two evidence viewers allow no host at all,
// and on the replay pane a request the archive did not rewrite through its own host
// is by definition a live third party.
//
// None of them went out before the legacy partition existed, and the reason is
// worth writing down because it is not the one #906 assumed. The old mount was an
// `<iframe sandbox="" srcDoc>`, and `sandbox=""` governs scripts, forms and popups
// but no fetch at all — so the frame denied nothing. What denied them was
// src/renderer/index.html's CSP, under which a srcdoc document's opaque origin
// matches no source expression; measured 0 in both the dev `http://` and packaged
// `file://` shapes, and 9 for the same document with that CSP removed. That is one
// unreferenced line of HTML, maintained for the app's own assets, with no test and
// no comment recording that an evidence pane depended on it. These cases are the
// dependency replaced by something owned: the answers below are decided in
// webviewPolicy.ts and fail here if it is loosened.
const LIVE_SUBRESOURCES: readonly (readonly [string, string])[] = [
  ['https://cdn.example.test/logo.png', 'an <img> the archived page referenced'],
  ['https://cdn.example.test/site.css', 'a <link rel=stylesheet>'],
  ['https://fonts.example.test/inter.woff2', 'a web font'],
  ['https://ads.example.test/frame.html', 'a nested <iframe>'],
  ['https://media.example.test/clip.mp4', 'a <video> source'],
  ['https://cdn.example.test/app.js', 'a <script> the page would load'],
  ['https://tracker.example.test/p.gif?id=7', 'a tracking pixel, the disclosure itself'],
  ['http://cdn.example.test/logo.png', 'the same image over plaintext http'],
  ['not a url', 'something that does not parse'],
  ['', 'no url at all']
]

interface PartitionExpectation {
  /**
   * The hosts the partition may address. The list is the control (#886, #810): if
   * it is ever widened, it is widened here, in a diff, beside this answer — not
   * arrived at by a filter forgetting to deny.
   */
  allowedRequestHosts: readonly string[]
  /**
   * The loads the partition exists for, admitted on attach, first navigation and
   * request alike. The counterweight to every refusal below: a fix that denies one
   * of these has broken the viewer rather than hardened it.
   */
  ownArtefacts: readonly string[]
  /**
   * The answer for `LOCALHOST_FILE_URLS`. The two evidence partitions disagree, and
   * that is deliberate rather than a drift the table papers over: `mhtml-sandbox`
   * lists `file://` and relies on `isRemoteFileUrl` (#926 asserts the allow), while
   * `legacy-html-sandbox` lists `file:///` because its content is the one class an
   * investigated site chooses the bytes of (#939). The row records the divergence in
   * one place so a partition added later has to choose, not inherit.
   */
  localhostFileForm: 'allow' | 'block'
}

/**
 * One row per partition the app mounts (#949). `expectationFor` throws for a
 * partition with no row, so every per-partition case below fails — rather than
 * being skipped — the moment `WEBVIEW_PARTITIONS` grows without this table.
 */
const PARTITION_EXPECTATIONS: ReadonlyMap<string, PartitionExpectation> = new Map([
  [
    MHTML_PARTITION,
    {
      allowedRequestHosts: [],
      ownArtefacts: ['file:///c/a.mhtml', 'file:///local/path/artifact.mhtml'],
      localhostFileForm: 'allow'
    }
  ],
  [
    LEGACY_HTML_PARTITION,
    {
      allowedRequestHosts: [],
      ownArtefacts: ['file:///c/case/cap.html'],
      localhostFileForm: 'block'
    }
  ],
  [
    WAYBACK_PARTITION,
    {
      allowedRequestHosts: ['web.archive.org'],
      ownArtefacts: [REPLAY_URL],
      localhostFileForm: 'block'
    }
  ]
])

function expectationFor(partition: string): PartitionExpectation {
  const row = PARTITION_EXPECTATIONS.get(partition)
  if (!row) {
    throw new Error(
      `no expectation row for partition ${partition}: add it to PARTITION_EXPECTATIONS`
    )
  }
  return row
}

describe('webviewPolicyFor', () => {
  it('knows exactly the three partitions the app mounts', () => {
    expect(WEBVIEW_PARTITIONS).toEqual([MHTML_PARTITION, LEGACY_HTML_PARTITION, WAYBACK_PARTITION])
    expect(webviewPolicyFor(MHTML_PARTITION)?.partition).toBe(MHTML_PARTITION)
    expect(webviewPolicyFor(LEGACY_HTML_PARTITION)?.partition).toBe(LEGACY_HTML_PARTITION)
    expect(webviewPolicyFor(WAYBACK_PARTITION)?.partition).toBe(WAYBACK_PARTITION)
  })

  it('has an expectation row for every partition it mounts and for nothing else (#949)', () => {
    expect([...PARTITION_EXPECTATIONS.keys()].sort()).toEqual([...WEBVIEW_PARTITIONS].sort())
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

// The answers that vary by partition, each asserted for every entry in
// WEBVIEW_PARTITIONS against that partition's row (#949).
describe.each(WEBVIEW_PARTITIONS)('per-partition answers on %s', (partition) => {
  it('writes its allowed request hosts down rather than implying them', () => {
    expect(webviewPolicyFor(partition)?.allowedRequestHosts).toEqual(
      expectationFor(partition).allowedRequestHosts
    )
  })

  it('admits its own artefacts on attach, first navigation and request', () => {
    for (const url of expectationFor(partition).ownArtefacts) {
      expect(decideWebviewAttach({ partition, src: url })).toEqual({
        allowed: true,
        policy: webviewPolicyFor(partition)
      })
      expect(decideWebviewNavigation({ partition, url, initialLoadDone: false })).toBe('allow')
      expect(decideWebviewRequest({ partition, url })).toBe('allow')
    }
  })

  it.each(REMOTE_FILE_URLS)('refuses %s on attach, first navigation and request (#904)', (url) => {
    // "Denied on every partition" is the acceptance criterion, so it is asserted on
    // the partition that never listed `file://` as well as on the ones that did.
    // `initialLoadDone: false` is the one navigation an evidence viewer is allowed,
    // so that is the case the one-load rule would otherwise wave through.
    expectationFor(partition)
    expect(decideWebviewAttach({ partition, src: url })).toEqual({
      allowed: false,
      reason: 'src-not-allowed'
    })
    expect(decideWebviewNavigation({ partition, url, initialLoadDone: false })).toBe('block')
    expect(decideWebviewRequest({ partition, url })).toBe('block')
  })

  it.each(LOCALHOST_FILE_URLS)('answers %s as its row says, on every decision surface', (url) => {
    const { localhostFileForm } = expectationFor(partition)
    expect(decideWebviewAttach({ partition, src: url }).allowed).toBe(localhostFileForm === 'allow')
    expect(decideWebviewNavigation({ partition, url, initialLoadDone: false })).toBe(
      localhostFileForm
    )
    expect(decideWebviewRequest({ partition, url })).toBe(localhostFileForm)
  })

  it.each(LIVE_SUBRESOURCES)('blocks %s (%s)', (url) => {
    expectationFor(partition)
    expect(decideWebviewRequest({ partition, url })).toBe('block')
  })

  it('reaches the archive host only when its row lists it', () => {
    // The load-bearing case, in request form: the discriminator is the only thing
    // keeping the replay pane's allow-list off the partitions that render evidence.
    const expected = expectationFor(partition).allowedRequestHosts.includes('web.archive.org')
      ? 'allow'
      : 'block'
    expect(decideWebviewRequest({ partition, url: REPLAY_URL })).toBe(expected)
    expect(
      decideWebviewRequest({
        partition,
        url: 'https://web.archive.org/_static/js/bundle-playback.js'
      })
    ).toBe(expected)
  })
})

describe('decideWebviewAttach', () => {
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

  it('holds the legacy HTML guest on the one file it was handed', () => {
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

  it('blocks everything on an unknown partition or a missing url', () => {
    expect(
      decideWebviewNavigation({ partition: null, url: REPLAY_URL, initialLoadDone: false })
    ).toBe('block')
    expect(
      decideWebviewNavigation({ partition: WAYBACK_PARTITION, url: null, initialLoadDone: false })
    ).toBe('block')
  })
})

// The evidence viewers' per-frame guard (#1708). Removing the injected
// `pointer-events: none` CSS makes every link in the stored page clickable, so this
// decision, not the CSS, is what keeps a frame on the document it opened with.
describe('decideFrameNavigation', () => {
  const ONE_LOAD_PARTITIONS = [MHTML_PARTITION, LEGACY_HTML_PARTITION] as const
  const frame = (
    partition: string | null,
    url: string | null,
    isMainFrame: boolean,
    mainDocumentCommitted: boolean,
    isSameDocument = false
  ) => decideFrameNavigation({ partition, url, isMainFrame, isSameDocument, mainDocumentCommitted })

  it.each(ONE_LOAD_PARTITIONS)('allows the %s guest its own artefact before it commits', (p) => {
    for (const url of expectationFor(p).ownArtefacts) {
      expect(frame(p, url, true, false)).toBe('allow')
    }
  })

  it.each(ONE_LOAD_PARTITIONS)(
    'blocks every cross-document navigation on %s once the main frame commits',
    (p) => {
      for (const url of [
        'file:///c/a.mhtml',
        'file:///etc/passwd',
        'https://example.com/next',
        'http://127.0.0.1:9/beacon',
        'cid:frame-1@mhtml.blink',
        'data:text/html,x',
        'about:blank'
      ]) {
        expect(frame(p, url, true, true)).toBe('block')
        expect(frame(p, url, false, true)).toBe('block')
      }
    }
  )

  it.each(ONE_LOAD_PARTITIONS)(
    'blocks a subframe on %s before the main frame commits, whatever its url',
    (p) => {
      expect(frame(p, 'file:///c/a.mhtml', false, false)).toBe('block')
      expect(frame(p, 'https://example.com/', false, false)).toBe('block')
    }
  )

  it.each(ONE_LOAD_PARTITIONS)('blocks anything off the allow-list on %s at any point', (p) => {
    expect(frame(p, 'https://example.com/', true, false)).toBe('block')
    expect(frame(p, 'file://evil.test/share/x.html', true, false)).toBe('block')
    expect(frame(p, null, true, false)).toBe('block')
  })

  it.each(ONE_LOAD_PARTITIONS)('allows a same-document fragment jump on %s in any frame', (p) => {
    expect(frame(p, 'file:///c/a.mhtml#section', true, true, true)).toBe('allow')
    expect(frame(p, 'cid:frame-1@mhtml.blink#section', false, true, true)).toBe('allow')
  })

  it('gives the replay pane the answer decideWebviewNavigation gives it', () => {
    for (const [url, committed] of [
      [REPLAY_URL, true],
      [REPLAY_URL, false],
      ['https://example.com/', true],
      ['https://web.archive.org/account/login', false]
    ] as const) {
      expect(frame(WAYBACK_PARTITION, url, true, committed)).toBe(
        decideWebviewNavigation({ partition: WAYBACK_PARTITION, url, initialLoadDone: committed })
      )
    }
    expect(frame(WAYBACK_PARTITION, REPLAY_URL, false, true)).toBe('allow')
  })

  it('blocks everything on a partition it does not know', () => {
    expect(frame('guest', 'file:///c/a.mhtml', true, false)).toBe('block')
    expect(frame(null, 'file:///c/a.mhtml#x', true, true, true)).toBe('block')
  })
})

describe('decideWebviewRequest', () => {
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

// The legacy partition lists `file:///`, not `file://`, and this is what that third
// slash buys: `file://host/share/x` is a network fetch wearing a local scheme, on the
// one content class an investigated site chooses the bytes of.
//
// It is not free. `captures:getHtmlUrl` builds the guest's src with `pathToFileURL`,
// which emits the empty-authority form for a local storage root and an authority
// form for a Windows UNC one — so an operator whose `storagePath` is `\\nas\share`
// gets an artefact URL this prefix denies. That is the ruled-correct answer today
// (#923: no way to tell the operator's file server from a host written into a
// captured page, so both are refused), recorded in #953, with #929 covering the
// operator-facing message. The `file://nas/…` answer is stable across #926 and #953
// asks for it to be pinned there.
//
// Every remote-authority string in REMOTE_FILE_URLS is refused by `isRemoteFileUrl`
// before the prefix list is read, so the per-partition cases above stay green with
// `allowedPrefixes: ['file://']`. The falsifier for the narrowing itself is the
// `localhostFileForm: 'block'` row, asserted above on LOCALHOST_FILE_URLS. #939's
// round-four pass measured Chromium handing that form to the decision points
// unchanged, unlike `file:////…`, which it collapses first.
describe('the legacy HTML partition’s local-file narrowing', () => {
  it('lists the three-slash prefix, so the row above is deciding what it says it is', () => {
    expect(webviewPolicyFor(LEGACY_HTML_PARTITION)?.allowedPrefixes).toEqual(['file:///'])
    expect(webviewPolicyFor(MHTML_PARTITION)?.allowedPrefixes).toEqual(['file://'])
  })
})
