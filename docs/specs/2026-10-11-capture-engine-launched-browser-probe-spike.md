# Capture engine stage-2 probe: launched Chromium browsers on Linux

**Date:** 2026-10-11

**Status:** Complete for Linux. A measurement, not a decision. Edge, Brave, and Chromium, and
every product on Windows and macOS, are not measured on this host. The clicked-Capture step
(stage-2 step 4) stays blocked until P7 has Windows and macOS answers.

Answers the P questions of the
[stage-2 design spec](2026-10-10-capture-engine-launched-browser-design.md) (Open questions, line
1422) by launching the browsers this host has, the way the design launches them, against fixture
pages on loopback. Issue #1828 asked for it as step 1 of the stage-2 split, and every line number
cited as "spec" points into that design spec.

## Method

A throwaway script, reproduced under [The probe](#the-probe), launched a browser on a new browser
profile, drove it over `--remote-debugging-pipe` with a CDP client of its own, and served every
page itself. Each configuration ran once per browser, in one batch on 2026-10-11, from a scratch
copy of the script outside the repository; P12's configurations ran a second time, and P12 says
why. Runs made while the script was written are not counted.

**Host.** Ubuntu 24.04.4 LTS under WSL2, kernel `6.18.33.2-microsoft-standard-WSL2`, x86-64, 4
CPUs. No desktop session ran: `DISPLAY`, `WAYLAND_DISPLAY`, `XDG_SESSION_TYPE`, and
`XDG_CURRENT_DESKTOP` were unset. A D-Bus session bus ran with `gnome-keyring-daemon`, whose login
keyring was locked.

**Display.** Every browser ran under `xvfb-run --auto-servernum`, which starts Xvfb 21.1.12 with a
1280 × 1024 × 24 screen and no window manager. The script read the whole screen with Pillow 12.3.0
(`ImageGrab`) and sent key presses and clicks through the X Test extension (`libXtst`, called from
Python 3.12 through `ctypes`).

**Script runtime.** Electron 44.5.1's Node 24.21.0 under `ELECTRON_RUN_AS_NODE=1`, as in the
spec's appendix. Five configurations need Electron's main process (Chromium 152.0.7977.130) and
ran there with Electron's `--no-sandbox` switch, as the stage-1 probe did: `bodies` (P12),
`safestorage` (P16), `shortcut` (P17), `electron-ws` (P23), and `electron-mhtml` (P24). That
switch applies to Electron, not to the launched browser.

**Browsers.**

| Product | `Browser.getVersion` product | Executable | Installed as |
| --- | --- | --- | --- |
| Google Chrome | `Chrome/150.0.7871.181` | `/usr/bin/google-chrome`, a link to the wrapper script `/opt/google/chrome/google-chrome`, which starts `/opt/google/chrome/chrome` | Distribution package `google-chrome-stable` `150.0.7871.181-1` |
| Chrome for Testing | `Chrome/149.0.7827.55` | `~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`, whose `--version` prints `Google Chrome for Testing 149.0.7827.55` | Vendor archive, downloaded before this work by Playwright 1.63.0 |
| Microsoft Edge | Not measured on this host | None found (P20) | Not installed |
| Brave | Not measured on this host | None found (P20) | Not installed |
| Chromium | Not measured on this host | None found (P20) | Not installed as a package, a Snap, or a Flatpak |

Chrome for Testing is not one of the four products. It is the kind of build that decision D23 pins
for the CI suite, so each entry gives it a row of its own.

**Rows not measured.** Edge, Brave, and Chromium are not installed on this host, and this run
installed nothing: no system package and no downloaded archive. The Windows and macOS rows are not
measured because the host runs Linux. The probe launched nothing on the Windows side of this WSL2
machine: from WSL2 a Windows browser starts through interop, so a reading would not show how the
pipe behaves when Birdbrain itself runs on Windows.

**Launch.** The design's argument list (spec, lines 310-318): `--user-data-dir=<new temporary
directory>`, `--remote-debugging-pipe`, `--no-first-run`, `--no-default-browser-check`,
`--disable-sync`, and `about:blank`. Outside the P13 runs, the script also passed
`--proxy-server=socks5://127.0.0.1:<port>`, pointing at its own SOCKS5 fixture, which logs each
destination and refuses any outside loopback. The browser's own traffic stopped there instead of
reaching the internet. Fixture pages on `127.0.0.1` and `127.0.0.2` bypassed the proxy under
Chromium's implicit loopback bypass (spec, lines 837-841). Across the batch, the fixture refused
connections to these hosts, on port 443 and, where named, port 80: `accounts.google.com`,
`android.clients.google.com`, `clients2.google.com` (80 too), `clientservices.googleapis.com`,
`content-autofill.googleapis.com`, `optimizationguide-pa.googleapis.com`,
`passwordsleakcheck-pa.googleapis.com`, `redirector.gvt1.com`, `safebrowsing.googleapis.com`,
`safebrowsingohttpgateway.googleapis.com`, `update.googleapis.com` (80 too), and `www.google.com`.

**Attach.** As steps 1 and 2 of the spec's
[Attach before request](2026-10-10-capture-engine-launched-browser-design.md#attach-before-request)
describe: `Target.setDiscoverTargets`, then `Target.setAutoAttach` with `autoAttach`,
`waitForDebuggerOnStart`, and `flatten` on the browser connection, with no explicit attach. For each
page, iframe, worker, shared worker, and service worker target whose URL does not start with
`devtools:`, `chrome:`, `chrome-extension:`, or `chrome-untrusted:`, the script sent
`Network.enable` with `maxTotalBufferSize` 50,000,000 and `maxResourceBufferSize` 10,000,000 (the
stage-1 probe's values; the first slice's budget is still open), `Network.setCacheDisabled`
(decision D6), `Target.setAutoAttach` on page and iframe sessions, and
`Runtime.runIfWaitingForDebugger`. It sends them in one of two orders. *Awaited* waits for each
answer before the next command and resumes last, which is the design's order. *Pipelined* sends all
of them at once and then waits for every answer. P4 found that the awaited order stalls some new
tabs, so every configuration except P4's `newtabs` used the pipelined order
(`--probe-resume=pipeline`). The pipelined path always disables the cache and never sends
`Network.configureDurableMessages`; the configurations that vary those two settings apply them to
the first tab, which is not paused and takes the awaited path.

**Fixtures.** The script runs two HTTP/1.1 servers, one on `127.0.0.1` (site A) and one on
`127.0.0.2` (site B), so a navigation from A to B crosses sites. It also runs a SOCKS5 and an HTTP
proxy fixture that forward to loopback only, and, for P13, a DNS listener. Every page, cookie, and
sign-in value is invented. The only host names outside loopback are the browser's own (above and in
P13) and the invented `*.egress-probe.test` names of P13's page.

**Other tools.** pypdf 6.17.0 parsed the PDFs. The `node:sqlite` module of Electron's Node read
copies of the cookie database.

## Results

Each entry gives the measured answer, then a row for each product on each platform. Chrome for
Testing 149 has a row of its own.

### P1: PDF in a windowed browser

**`Page.printToPDF` returned a PDF from a tab in a visible window on both browsers.** The fixture
page printed to 16,903 bytes that pypdf read as seven Letter-size pages, with the page's heading
and text on page 1 and one image object. As in the stage-1 probe, the page received `beforeprint`
and `afterprint`, its print media query changed, and the print-only image was requested during the
print.

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | `Page.printToPDF` returns data in a windowed tab |
| Chrome for Testing 149, Linux | Same as Chrome 150 |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

### P2: Screenshots

**`captureBeyondViewport` leaves the window where it is, and the page sees a resize.** On the tab
in front, `Page.getLayoutMetrics` and `Page.captureScreenshot` with `captureBeyondViewport` and a
clip of the whole content returned a 1,035 × 5,372 image, the content width without the 15-pixel
scrollbar. `Browser.getWindowForTarget` gave the same window bounds before and after, and the
page's `innerWidth` and `innerHeight` read the same before and after. During the capture the page
recorded two `resize` events, two `visualViewport` resize events, and two `ResizeObserver`
callbacks on the root element. It recorded no scroll, focus, visibility, or intersection change.

**A tab that is not in front can be captured.** With another tab in front, the first tab's
`visibilityState` was `hidden`. `Page.captureScreenshot` on it returned the page's content twice,
first without `captureBeyondViewport`, then with it. The script timed both from the start of the
first: the first ended after 18 ms on Chrome and 24 ms on Chrome for Testing, the second after 107
ms and 116 ms. The page stayed `hidden` and recorded no further `visibilitychange`. Between the
read after the front capture and the read after both background captures, the page recorded one
more `resize` and one more `visualViewport` resize; the other tab opened in that interval too, so
the script does not show which step caused them. On Chrome for Testing with
`--disable-field-trial-config` (the P24 run), the first background capture took 2,265 ms, in one
run.

Chrome for Testing shows an infobar (P19), so its viewport was 1,050 × 861 where Chrome's was 1,050
× 917.

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | Window does not move; the page sees `resize`, `visualViewport` resize, and `ResizeObserver` events; a tab behind another can be captured |
| Chrome for Testing 149, Linux | Same as Chrome 150, with a viewport 56 pixels shorter; with `--disable-field-trial-config`, the first background capture took 2,265 ms |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

### P3: `Page` and isolated-world reads

**Nothing the page recorded changed with `Page.enable` or an isolated-world read, but the check
that would show a debugger read nothing even with `Runtime.enable` on.** Each variant ran on a new
tab after a warm-up load. The page recorded `navigator.webdriver` (`true` in every variant, as the
pipe makes it), the keys of `window.chrome` (`loadTimes`, `csi`, `app`), `document.hasFocus()`
(`true`), `document.visibilityState` (`visible`), the resource timing list (`/img.png`), and the
`Error.stack` getter count of the stage-1 probe, which logs an `Error` with a counting getter to
`console.debug` at load and every 250 ms.

| Variant | What changed against the network-only tab |
| --- | --- |
| `Page.enable` before the load | Nothing recorded. The session received `Page.frameStartedNavigating`, `frameStartedLoading`, `frameNavigated`, `domContentEventFired`, `loadEventFired`, and `frameStoppedLoading` |
| `Page.createIsolatedWorld` and `Runtime.evaluate` there, reading `visibilityState`, `hasFocus()`, and `innerText` | Nothing recorded |
| Scroll-to-load scripts in an isolated world | Scroll events (6 on Chrome, 7 on Chrome for Testing), the `IntersectionObserver` on a sentinel at the foot of the page firing `true` then `false`, and the lazy image's request, which also joined the resource timing list. The reset left `scrollY` at 0 |
| The same scripts in the main world, as `scrollToLoadLazyContent` runs them (`src/main/services/backgroundRenderer.ts:215-262`) | The same, with one scroll event more |
| `SCROLL_UNLOCK_SCRIPT` first, on a page whose `html` and `body` carry inline `overflow: hidden`, then `overflow: clip` | The unlock script returned `null` and changed no style: programmatic scrolling still moved the page, so `pickRoot` found it scrollable. The page saw the same scrolling as above |
| `Runtime.enable` before the load, as a positive control | Nothing recorded. The `Error.stack` getter was read zero times |

In three of the eight runs with the scroll scripts (the `overflow: clip` run on Chrome, and the
main-world and `overflow: hidden` runs on Chrome for Testing), the page also recorded one `focus`
event. No run without the scroll scripts recorded one, and one run per variant does not show
whether the scripts or the new tab's activation caused it.

The positive control means the `Error.stack` count cannot show whether a domain is detectable on
these builds: it stayed at zero with the `Runtime` domain on. The comment above the scroll helpers
says "a viewport scroll-locked by overflow: hidden clamps even programmatic scrolling"
(`backgroundRenderer.ts:130-132`); in launched Chrome 150 and Chrome for Testing 149 it did not, for
either inline style.

**A commit signal without the `Page` domain.** On the browser connection,
`Target.targetInfoChanged` for the tab carried the new URL after the document's
`Network.responseReceived` and before its `Network.loadingFinished`. It also fired for a
`history.pushState`, which commits no document, and did not fire for a navigation answered with
`204 No Content`, which commits nothing.

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | No change in the listed facts from `Page` or isolated-world reads; the `Error.stack` check failed its positive control; scrolling is visible to the page through scroll and intersection events and lazy loads |
| Chrome for Testing 149, Linux | Same as Chrome 150 |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

### P4: Popups, new tabs, and cross-site navigation

**Awaiting `Network.enable` before resuming stalls a tab a page opens with no JavaScript opener,
and the document request of a tab the browser opens with a URL appears on no CDP session.** The
`newtabs` configuration opened a tab eight ways from a fixture page, with each order of setup. Its
`Network.enable` carried the buffer limits only, without `enableDurableMessages`, the parameter the
protocol's deadlock note names (spec, lines 1463-1469). The second column says whether the
target's `TargetInfo` carried an `openerId`.

| How the tab opened | `openerId` | Awaited order | Pipelined order |
| --- | --- | --- | --- |
| `target=_blank` link, clicked | Yes | `Network.enable` did not answer within 15 seconds and the tab stayed paused; after the timeout the script resumed it and the document request was recorded | All commands answered within 17 ms; document request recorded |
| `target=_blank rel=opener` link | Yes | Answered within 8 ms; document request recorded | Document request recorded |
| `window.open` | Yes | Answered within 8 ms; document request recorded | Document request recorded |
| `window.open` with `noopener` | Yes | `Network.enable` did not answer within 15 seconds, as for the `_blank` link | Document request recorded |
| Link clicked with Ctrl (`Input.dispatchMouseEvent`) | No | Attached paused, setup answered; the document request reached the fixture and appeared on no CDP session | Same as awaited |
| Link clicked with the middle button | No | Same as Ctrl-click | Same |
| `Target.createTarget` with the URL | No | Same as Ctrl-click | Same |
| `Target.createTarget` on `about:blank`, then `Page.navigate` | No | Document request recorded | Document request recorded |

Every new tab attached with `waitingForDebugger: true`. For the three tabs the browser opened with a
URL, the document request was missing from every session in every run; the first request the tab's
session reported, when there was one, was the page's image. The `popups` configuration, in the
pipelined order, recorded the `_blank` and `window.open` tabs' document requests on their own
sessions and missed the `Target.createTarget` tab's.

**A cross-site navigation keeps the tab's target and CDP session.** A link from site A to site B,
and `Page.navigate` back, produced no `Target.detachedFromTarget`. `Target.getTargetInfo` still
answered for the tab, and the new document request and its subresources appeared on the tab's
existing session. The fixture logged no request that no session reported.

**Bodies of the previous document.** After the tab loaded a page and then navigated, the script
asked for the previous page's document and a 200,000-byte text body:

| `Network.enable` setting | After a cross-site navigation | After a same-site navigation |
| --- | --- | --- |
| Buffer limits only | Both gone: `No resource with given identifier found` | Both gone, the same error |
| With `enableDurableMessages: true` | Both returned | Both returned |
| With `Network.configureDurableMessages` sent after `Network.enable` | Both returned | Both returned |

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | Awaited setup stalls tabs opened with no JavaScript opener; tabs the browser opens with a URL lose their document request; cross-site navigation keeps the session; durable messages keep the previous document's bodies |
| Chrome for Testing 149, Linux | Same as Chrome 150 |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

### P5: Out-of-process iframes and workers

**A frame's document request and a worker's script request appear on the parent's session, and
each frame's and worker's own requests on its own session.** A page on site A loaded a same-site iframe, a cross-site
iframe on site B with a dedicated worker of its own, a dedicated worker, and a shared worker, and
each fetched one text file.

| Request | Session that reported it |
| --- | --- |
| The page's fetch, the same-site iframe's document and fetch | The page's |
| The cross-site iframe's document | The page's |
| The cross-site iframe's fetch and its worker's script | The iframe's (type `iframe`, attached as a child of the page) |
| The dedicated worker's script | The page's |
| The dedicated worker's fetch | The worker's (type `worker`, child of the page) |
| The cross-site iframe's worker's fetch | That worker's (child of the iframe) |
| The shared worker's script | The page's |
| The shared worker's fetch | The shared worker's (type `shared_worker`, attached on the browser connection, not as a child of the page) |

Every request the fixture logged appeared on a session.

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | As in the table above |
| Chrome for Testing 149, Linux | Same as Chrome 150 |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

### P6: WebRTC

**`--webrtc-ip-handling-policy=disable_non_proxied_udp` holds on both browsers, and
`--force-webrtc-ip-handling-policy` has no effect on either.** With the SOCKS5 fixture as proxy,
the script gathered ICE candidates with no ICE servers three ways: from an isolated world on the
first tab's `about:blank` before any navigation, from the main world of a loaded `http` page (the
spec probe's method), and from an isolated world on that page.

| Switch | `about:blank`, isolated world | Loaded page, main world | Loaded page, isolated world |
| --- | --- | --- | --- |
| None | One UDP host candidate with an mDNS name | The same | The same |
| `--webrtc-ip-handling-policy=disable_non_proxied_udp` | None | None | None |
| `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` only | One UDP host candidate with an mDNS name | The same | The same |

The isolated world on `about:blank` gave the same result as the loaded page in every case, so the
check needs no page of its own.

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | The policy switch holds; the `force` switch does not; `about:blank` gives the page's result |
| Chrome for Testing 149, Linux | Same as Chrome 150 |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

### P7: The pipe on each platform

**The pipe works on Linux for both browsers, with no TCP listener and no `DevToolsActivePort`
file.** `Browser.getVersion` answered over the pipe 176 ms after spawn on Chrome and 138 ms on Chrome
for Testing. Auto-attach attached the existing `about:blank` tab without an explicit attach. The
browser and its child processes held no listening TCP socket. They held one listening Unix socket,
`SingletonSocket` in a `/tmp` directory, which the browser profile links to as `SingletonSocket`
beside `SingletonLock` and `SingletonCookie`; the names match the process singleton the spec cites
(lines 746-749), and a second launch on the same browser profile exits at once (P14).
`navigator.webdriver` read `true`.

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux (distribution package) | Works: no TCP listener, no `DevToolsActivePort`, one Unix singleton socket |
| Chrome for Testing 149, Linux (vendor archive) | Same as Chrome 150 |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Snap or Flatpak build of any product, Linux | Not measured on this host: none installed, and `flatpak` is not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

A maintainer run on Windows and macOS, or a follow-up issue, fills the Windows and macOS rows. The
clicked-Capture step (stage-2 step 4) waits for them, as the ruling on decision D1 requires (spec,
lines 405-409 and 1291-1294).

### P8: When the pipe closes

**The browser exits when the pipe closes, and a restart from inside the browser ends it without
bringing it back.** A helper process launched the browser and then went away three ways:

| What the helper did | Browser exited after |
| --- | --- |
| Killed with `SIGKILL`, as if Birdbrain crashed | 100 ms on Chrome, 101 ms on Chrome for Testing (the polling interval) |
| Exited normally without `Browser.close` | About 600 ms |
| Closed both pipe streams and kept running | About 600 ms |

No process naming the browser profile was left in any case. For a restart, the script typed
`chrome://restart` into the address bar through the X Test extension. The browser exited with code 0,
and the pipe closed within the 400 ms the script waits after the last key. No process naming the
browser profile appeared in the six seconds after, by a 25 ms poll, none ran 12 seconds later, and
the screen was empty. Whether "Relaunch to update" takes the same path as `chrome://restart` was not
checked.

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | Exits within about 0.6 s of the pipe closing; a restart exits and does not return |
| Chrome for Testing 149, Linux | Same as Chrome 150 |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

### P9: Service workers

**A response a service worker served stays in the page's record, with no remote endpoint, and the
worker's own fetches appear twice.** A fixture page registered a worker that answers one URL with a
response it builds, one from Cache Storage, and passes the navigation and one URL through to the
network. On the controlled second load, the page's session reported the document and each fetch
with `fromServiceWorker` true and `serviceWorkerResponseSource` `network`, `fallback-code`, or
`cache-storage`. The document response carried an empty `remoteIPAddress` and port 0, and the
fetch responses carried no remote address at all.
`Network.getResponseBody` on the page's session returned every body, including the one the worker
built.

The worker attached twice with the same `targetId`: once on the browser connection and once as a
child of the page's session. Its own fetches of the navigation and of the passed-through URL, with
the fixture's address and port, appeared on both sessions under the same request ids. The
worker's install-time fetch for Cache Storage and its script appeared on its sessions only. Every
request the fixture logged appeared on some session.

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | Worker-served responses on the page's session with their source and no endpoint; the worker's own requests on two sessions of one target |
| Chrome for Testing 149, Linux | Same as Chrome 150 |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

### P10: Back-forward cache and speculative loads

**A restore from the back-forward cache leaves no network event on the tab, and the engine's setup
turns prerendering off.** In four runs per browser (same-site and cross-site, cache disabled and
not), `history.back()` restored the page from the back-forward cache: the page recorded `pageshow`
with `persisted` true. The tab's session received no event at all, the fixture received no request,
and the only trace was `Target.targetInfoChanged` on the browser connection with the restored URL.

A page with speculation rules for one prerender and one prefetch produced no prerender target. The
fixture received both URLs with `Sec-Purpose` `prefetch` and `prefetch;prerender`, and the tab's
own session reported both as requests of type `Prefetch`. A diagnostic run with `Preload.enable`
reported the prerender's final status as `PrerenderingDisabledByDevTools`. Following each link then
gave a `Document` request on the tab's session whose response had `fromPrefetchCache` true and the
fixture's address, with no new request at the fixture; the prerendered page's own fetch went to the
fixture after the click.

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | Back-forward restore: no network event, only `Target.targetInfoChanged`; prerender disabled under CDP; prefetches on the tab's session |
| Chrome for Testing 149, Linux | Same as Chrome 150 |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

### P11: Message order

**The stream kept causal order across a tab's sessions in 150 steps.** A page, a cross-site iframe
on its own session, and a dedicated worker on its own session fetched in a strict chain: each fetch
began only after the previous one, in another context, had finished. The fixture saw the 150
requests in chain order. On the browser connection, every step's `Network.requestWillBeSent`
arrived after the previous step's `requestWillBeSent`, `responseReceived`, and `loadingFinished`,
on both browsers. One run per browser does not show the order is guaranteed.

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | No inversion in 150 cross-session steps |
| Chrome for Testing 149, Linux | Same as Chrome 150 |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

### P12: Body fetching cost

**Fetching every body as it finishes cost Electron's main process 3.4 to 3.8 seconds of CPU for
about 230 MB of bodies, and with durable messages Chrome for Testing returned a wrong body without
an error.** The `bodies` configuration ran in Electron's main process, as decision D4 places
the client. It loaded fifteen pages in one tab, alternating sites A and B so every navigation
crossed sites, or staying on site A (`--probe-sites=same`). Pages 0 to 13 each fetched 40 text
bodies of 2,000, 20,000, 200,000, and 1,000,000 bytes, about 12 MB a page. Page 14 fetched eight
bodies of 9,000,000 bytes, 72 MB, which is more than the 50 MB buffer. Each body is a known payload,
so the script compared every fetched body with what the fixture served. The process's CPU time
(`process.cpuUsage`) and event-loop delay (`monitorEventLoopDelay`, 10 ms resolution) cover the
browsing only. The table reports the second batch run of these configurations, made after the
script began recording the details of a mismatched body; every other configuration ran once.

| Mode (Chrome 150 / Chrome for Testing 149) | Browsing | Main-process CPU | Event-loop delay, 99th percentile and maximum | Bodies returned | Not returned |
| --- | --- | --- | --- | --- | --- |
| `Network` events only, no body fetched | 12.3 s / 12.2 s | 0.65 s / 0.66 s | 11 and 24 ms / 11 and 31 ms | none asked | none asked |
| Every body at `loadingFinished` | 15.8 s / 13.5 s | 4.45 s / 4.08 s | 82 and 140 ms / 64 and 93 ms | 599 / 598 | 1 / 2: `Request content was evicted from inspector cache` |
| Each page's bodies after it loads, as a Capture would, cross-site | 19.5 s / 17.7 s | 3.85 s / 3.84 s | 32 and 110 ms / 45 and 97 ms | 596 / 596 | 4 / 4 on page 14, evicted |
| The same, same-site | 17.9 s / 17.5 s | 3.74 s / 3.77 s | 32 and 112 ms / 32 and 109 ms | 595 / 595 | 4 / 4 on page 14, evicted |
| The same, cross-site, `enableDurableMessages` | 17.3 s / 19.7 s | 4.00 s / 4.73 s | 33 and 134 ms / 46 and 187 ms | 596 / 598 | 4 / 2 on page 14, evicted |
| The same, cross-site, `Network.configureDurableMessages` | 18.8 s / 17.1 s | 3.93 s / 3.90 s | 40 and 111 ms / 41 and 145 ms | 596 / 596 | 4 / 4 on page 14: `No data found for resource with given identifier` |

The pipe carried about 2.8 MB without bodies and 219 to 240 MB with them. Against the events-only
run, fetching every body added about 3.4 to 3.8 seconds of CPU for 225 to 234 MB, 15 to 16 ms of
CPU per MB or about 6 ms per body. In the Capture-time modes, pages 0 to 13 lost no body; only the
page larger than the buffer did. After the fifteenth page, the script asked again for every body
of the run: only the last page's were returned (6 to 8 of 600), in every Capture-time mode.

Every body Chrome 150 returned equalled its payload. Chrome for Testing returned one wrong body in
each durable-message mode: a 9,000,000-byte payload came back as 5,877,053 bytes
(`configureDurableMessages`) and as 7,951,424 bytes (`enableDurableMessages`), equal to the payload
up to byte 2,097,152 and different after it, with no error. The first batch run of the same
configurations, before the script recorded details, counted three wrong bodies in Chrome for
Testing's `enableDurableMessages` mode and none elsewhere; the second run wrote to the same file
names, so no output of the first survives to show it. No wrong body appeared without durable
messages.

An hour of browsing was not measured; the per-megabyte figure is what this run supports.

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | About 16 ms of main-process CPU per MB fetched; event-loop delay up to 140 ms; only a page larger than the buffer lost bodies at Capture time; no wrong body |
| Chrome for Testing 149, Linux | The same costs; with either durable-message setting, one body of 9,000,000 bytes returned short and wrong without an error |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

### P13: Traffic around the proxy

**In a loopback-only network namespace, behind a SOCKS5 or an HTTP proxy, every TCP connection
the browser attempted went to the proxy, and no DNS query left. The IPv6 reachability check of
Chrome's host resolver tried UDP connects to a public address; every one failed, and none sent a
byte.**

The spec's Egress wrapper ran first, with the probe in place of `pnpm test <file>`:

```shell
unshare -rn sh -c 'ip link set lo up && ELECTRON_RUN_AS_NODE=1 xvfb-run --auto-servernum node_modules/.bin/electron <S>/probe.mjs egress --probe-variant=socks --probe-tag=spec-wrapper'
```

It exited with code 1. `unshare -r` maps the caller to root inside the namespace, and Chrome refused
to start: `Running as root without --no-sandbox is not supported. See https://crbug.com/638180.`
The runs reported here add a mount namespace, so that `/etc/resolv.conf` can point at the probe's
DNS listener on `127.0.0.1:53`, and a nested user namespace that maps the caller's own uid and gid
back. Under it the browser started with its sandbox on: each renderer's `Seccomp` field in
`/proc/<pid>/status` read 2. The commands are under [The probe](#the-probe).

Each run passed `--log-net-log`, left the browser idle for 120 seconds, then loaded a page that
names invented hosts in a `dns-prefetch` link, a `preconnect` link, an `http` image, an `https`
image, an anchor, and a `fetch`. The SOCKS5 and HTTP runs also passed
`--proxy-bypass-list=<-loopback>`, so the fixture page went through the proxy, and
`--webrtc-ip-handling-policy=disable_non_proxied_udp`. The namespace had only `lo`, and the page
read `navigator.onLine` as `false`.

| Run, both browsers | TCP connections attempted (net log) | DNS queries at the listener | UDP connects attempted (net log) | Asked of the proxy |
| --- | --- | --- | --- | --- |
| Direct | The fixture page only | A and HTTPS records for every host the browser or the page named except the anchor's, the `dns-prefetch` and `preconnect` hosts included | `127.0.0.1:53`, which sent the queries; `[2001:4860:4860::8888]:443`, 18 times on Chrome and 26 on Chrome for Testing, each failing with `net_error` -109 and sending nothing | No proxy |
| SOCKS5 | The proxy only | None | `[2001:4860:4860::8888]:443` only: 14 times on Chrome and 6 on Chrome for Testing, each failing with -109 and sending nothing | Every host the browser and the page named, by name, except the `dns-prefetch` host and the anchor's |
| HTTP | The proxy only | None | The same: 13 times on Chrome and 6 on Chrome for Testing | The same hosts except the `preconnect` one, as `CONNECT` for `https` and absolute URLs for `http` |

Each UDP socket to `2001:4860:4860::8888` belongs to a net log source that logged
`HOST_RESOLVER_MANAGER_IPV6_REACHABILITY_CHECK` with `cached: false` and `ipv6_available: false`,
one socket per check the browser did not answer from its cache. In the SOCKS5 and HTTP runs every
such check ran inside the connect job that connected to the proxy. No `UDP_BYTES_SENT` event names
that address. No QUIC session appears in any net log; no fixture served QUIC, so this does not show
QUIC under a proxy.

Through the HTTP proxy, CDP reported the proxy's own address and port as `remoteIPAddress` and
`remotePort` for the fixture page and for the `403` the proxy returned for the refused image. Through
SOCKS5 it reported the proxy's endpoint for the fixture page, as the spec's probe found.

Every host outside loopback the P13 runs saw, in the net logs, the DNS listener, or the proxy logs:
`android.clients.google.com`, `clients2.google.com`, `update.googleapis.com`, and `www.google.com`
from both browsers; `optimizationguide-pa.googleapis.com`,
`safebrowsingohttpgateway.googleapis.com`, and, in the Direct run only, `safebrowsing.googleapis.com`
from Chrome; the address `2001:4860:4860::8888`; and the page's invented `dns-prefetch`,
`preconnect`, `img`, `tls`, and `fetch` hosts under `egress-probe.test`. The anchor's host was never
looked up or requested. Method lists the hosts the other configurations' proxy refused.

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | Behind SOCKS5 or HTTP, no TCP connection and no DNS query went around the proxy; the IPv6 reachability check's UDP connects to `2001:4860:4860::8888` failed and sent nothing; the HTTP proxy's endpoint is the reported remote address |
| Chrome for Testing 149, Linux | Same as Chrome 150, with fewer hosts of its own |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

### P14: Seeding mechanics

**A launch with `--no-startup-window` answers on the pipe without a window, and `Browser.close`
writes cookies from `Storage.setCookies` to disk.** The seeding launch answered `Browser.getVersion`
in 122 ms on Chrome and 215 ms on Chrome for Testing, had no page target, drew nothing on the screen,
and was still running three seconds later. `Storage.setCookies` set a persistent cookie, a session
cookie, and a `SameSite=Lax` cookie for `127.0.0.1`. `Browser.close` ended the process with code 0
in 165 ms and 73 ms, and the profile's `Default/Cookies` database then held all three rows,
including the session cookie with `is_persistent` 0.

**A session cookie did not survive a restart on Chrome, and did on Chrome for Testing.** A windowed
launch on the same browser profile sent the fixture `fixture_persist` and `fixture_lax` on Chrome,
and those two plus `fixture_session` on Chrome for Testing.

**A second launch on a browser profile in use exits with code 0 and never answers.** While the
windowed browser ran, another `--no-startup-window` launch on the same browser profile exited with
code 0 after 36 ms on Chrome and 47 ms on Chrome for Testing. Its pipe never answered
`Browser.getVersion`, and the running browser opened no tab.

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | Seeding launch works without a window; cookies reach disk; the session cookie is gone after a restart; a launch on a busy profile exits 0 at once |
| Chrome for Testing 149, Linux | Same, except that the session cookie was still sent after the restart |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

### P15: Preferences written before first launch

**The browser kept `credentials_enable_service: false` written into a new browser profile, and did
not offer to save a password.** The script wrote `{"credentials_enable_service": false}` as
`Default/Preferences` before the first launch. `chrome://prefs-internals` then showed the value
`false` with the metadata `user_controlled`, `user_modifiable`, and `extension_modifiable`, and the
file still held `false` after `Browser.close`. After a sign-in on a fixture form, typed with
`Input.insertText`, the screen showed no "Save password?" bubble. In a control run without the
written file, the value was `true` (`default`), and the bubble appeared with the fixture username
and password filled in.

In both runs, and on both browsers, the browser then tried to reach
`passwordsleakcheck-pa.googleapis.com` and `content-autofill.googleapis.com` through the proxy,
which refused them. The written preference did not stop either.

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | Kept; no save-password offer; the leak-check host was still contacted |
| Chrome for Testing 149, Linux | Same as Chrome 150 |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

### P16: Cookies at rest

**On this host neither browser stored its cookies under a key from the operating system, and
Electron's `getSelectedStorageBackend()` did not predict what the browser did.** A fixture set one
persistent cookie. After `Browser.close`, the script read the first three bytes of its
`encrypted_value` in the copied `Cookies` database, and the browser's own histograms from
`--enable-logging=stderr --v=1`. Electron's main process, on the same session, reported
`safeStorage.getSelectedStorageBackend()`, `isEncryptionAvailable()`, and the first three bytes of
`encryptString`. The app reaches `safeStorage` at `src/main/services/signingKey.ts:27`, never calls
`getSelectedStorageBackend()`, and decides whether a key protects its data with
`isEncryptionAvailable()` (`signingKey.ts:58-60`, :64, :76;
`src/main/services/persona/personaSessions.ts:196-198`).

| Session | Chrome 150 and Chrome for Testing 149 | Electron 44.5.1 `safeStorage` | Match |
| --- | --- | --- | --- |
| This host as it is: no desktop, the session bus's keyring locked | The Secret Service key provider failed to unlock (`OSCrypt.FreedesktopSecretKeyProvider.InitStatus` 10, `UnlockFailed`); cookie prefix `v10` | `basic_text`; encryption not available | No key from the operating system on either side; the backend name does not say the browser tried the Secret Service |
| `XDG_CURRENT_DESKTOP=GNOME`, a private bus, a new unlocked `gnome-keyring` | Key provider ready (`InitStatus` 0); cookie prefix `v11` | `gnome_libsecret`; available; prefix `v11` | Yes |
| `XDG_CURRENT_DESKTOP=GNOME`, a private bus with no Secret Service | Key provider found no service (`InitStatus` 6, `NoService`); cookie prefix `v10` | `gnome_libsecret`; encryption not available | No: Electron names `gnome_libsecret` while the browser used no Secret Service key |

In every session, the `v11` prefix came with a working Secret Service key and `v10` without one,
and `isEncryptionAvailable()` was true exactly when the browser wrote `v11`. The private bus had no
service activation (its configuration is under [The probe](#the-probe)), so the GNOME runs never
reached the host's own keyring. The runs on the host as it is did: the browser asked the host's
Secret Service to unlock the locked login keyring and got a failure. Whether a prompt was shown is
not known.

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | As in the table: `v10` on this host and with no Secret Service, `v11` with an unlocked keyring |
| Chrome for Testing 149, Linux | Same as Chrome 150 |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

### P17: The shortcut

**Under X11 with no window manager, `globalShortcut` fired while the launched browser had the
keyboard.** Electron's main process registered `CommandOrControl+Shift+F9`;
`globalShortcut.register` returned `true`. With a launched Chrome window clicked into focus, the X
Test extension pressed `a`, the shortcut, and `b`. The callback ran once. The page saw `a`, the
Control and Shift key presses, and `b`, but not the F9 press. P17 concerns Electron, not the
launched browser, so its rows are per platform and Linux desktop session.

| Platform and session | Answer |
| --- | --- |
| Linux, X11 under Xvfb, no window manager or desktop | Registered and fired once; the page did not receive the shortcut's key |
| Linux, GNOME on Wayland | Not measured on this host: no desktop session |
| Linux, GNOME on X11 | Not measured on this host: no desktop session |
| Linux, KDE Plasma on Wayland or X11 | Not measured on this host: no desktop session |
| Windows | Not measured on this host: the host runs Linux |
| macOS | Not measured on this host: the host runs Linux |

### P18: DevTools

**Opening DevTools on a recorded tab left the engine's session attached and recording.** The script
opened DevTools on the tab twice, with `Target.openDevTools` and with F12 through the X Test
extension. Each time DevTools opened docked in the window, and its front end appeared as a target
of type `other` with a `devtools://` URL, auto-attached on the browser connection. The engine's
session on the tab received no `Target.detachedFromTarget`, the next navigation's document request
appeared on it, and `Runtime.evaluate` still answered there.

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | The engine's session survives DevTools opening |
| Chrome for Testing 149, Linux | Same as Chrome 150 |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

### P19: Banners

**No "controlled by automated test software" infobar appeared in the engine's launch
configuration.** Screenshots of the whole display after the first navigation showed:

- Chrome 150: a "Can't update Chrome" bubble with a **Reinstall Chrome** button, which this
  outdated build shows on its own. It takes the keyboard: while the script was written, a Return
  meant for the address bar pressed **Reinstall Chrome**, which opened a tab for
  `google.com/chrome` that the proxy fixture refused. P8 and P18 press Escape first.
- Chrome for Testing 149: the infobar "Chrome for Testing v149.0.7827.55 is only for automated
  testing. For regular browsing, use a standard version of Chrome", with **Download Chrome**. It
  sits above the page and shortened the viewport by 56 pixels (P2).

The P13 runs, which pass `--log-net-log`, showed Chrome's unsupported-flag infobar on both
browsers: "You are using an unsupported command-line flag: --log-net-log=… Stability and security
will suffer." On Chrome for Testing it appeared in place of the Chrome for Testing infobar.

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | No automation infobar; an outdated-build bubble that takes the keyboard |
| Chrome for Testing 149, Linux | No automation infobar; the Chrome for Testing infobar |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

### P20: Discovery

**Only Google Chrome is installed at a known path, and Chrome for Testing reports itself as
`Chrome`.** The `discover` configuration launched nothing. Of the Linux paths that `playwright-core`
1.63.0 lists for Chrome and Edge channels (`lib/coreBundle.js:33222-33276`), only
`/opt/google/chrome/chrome` exists. On `PATH`, `google-chrome` and `google-chrome-stable` resolve to
`/opt/google/chrome/google-chrome`; `microsoft-edge`, `microsoft-edge-stable`, `brave-browser`,
`brave`, `chromium`, and `chromium-browser` are absent. `snap list` shows no browser, and `flatpak`
is not installed. The Chrome for Testing builds sit in Playwright's cache, which no install-location
table names.

`Browser.getVersion` gave Chrome for Testing 149 the product `Chrome/149.0.7827.55` and a user agent
ending `Chrome/149.0.0.0 Safari/537.36`, the same form as branded Chrome. Neither field tells the
two apart; the `--version` output and the infobar do.

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | `/opt/google/chrome/chrome`, reached through `/usr/bin/google-chrome` |
| Chrome for Testing 149, Linux | Playwright's cache only; product string `Chrome/149.0.7827.55` |
| Edge, Linux | Not found at `/opt/microsoft/msedge/msedge` or on `PATH`; not measured on this host beyond that |
| Brave, Linux | Not found on `PATH`; no installed package lists its location; product string not measured on this host |
| Chromium, Linux | Not found on `PATH`, as a Snap, or as a Flatpak |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux. `playwright-core` lists Windows paths ending `\Google\Chrome\Application\chrome.exe` and `\Microsoft\Edge\Application\msedge.exe` (`lib/coreBundle.js:33225`, :33253), read and not checked |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux. `playwright-core` lists Chrome and Edge under `/Applications` (`lib/coreBundle.js:33224`, :33252), read and not checked |

### P23: Global `WebSocket` in the main process

**Electron's main process has a global `WebSocket`, and it drove a launched browser in port mode.**
In Electron 44.5.1's main process, `typeof WebSocket` was `function`. The `electron-ws`
configuration launched each browser with `--remote-debugging-port=9335`, read
`/json/version`, connected with that global `WebSocket`, and received `Browser.getVersion`. The same
configuration under `ELECTRON_RUN_AS_NODE` gave the same answers. P23 concerns Electron, so its
rows are per platform.

| Platform | Answer |
| --- | --- |
| Linux | Global `WebSocket` present in the main process; it connected to Chrome 150 and Chrome for Testing 149 in port mode |
| Windows | Not measured on this host: the host runs Linux |
| macOS | Not measured on this host: the host runs Linux |

### P24: MHTML equivalence

**`Page.captureSnapshot` in launched Chrome 150 matched `wc.savePage` part for part on the
fixture, and Chrome for Testing did not, because of its field-trial testing configuration.** The
`electron-mhtml` configuration loaded the fixture page in a window configured like
`renderPageInHiddenWindow` (`backgroundRenderer.ts:385-397`, without the consent filter) and saved
it with `wc.savePage(path, 'MHTML')`, as the renderer does at `backgroundRenderer.ts:519`, and with
`Page.captureSnapshot` over `wc.debugger`. The page had a stylesheet with a background image, an
image, a same-site and a cross-site iframe, and text written by a script. The fixture ports were
fixed so every capture saw the same URLs. The comparison parsed each file into parts and compared
the header names, each part's `Content-Location`, type, transfer encoding, and the SHA-256 of its
decoded body, with the per-load frame token in `cid:frame-…@mhtml.blink` references masked.

| Compared with Electron's `wc.savePage` | Result |
| --- | --- |
| Electron's `Page.captureSnapshot` | Same header names, the same seven parts, every digest equal |
| Chrome 150 `Page.captureSnapshot` | The same |
| Chrome for Testing 149 `Page.captureSnapshot` | Three extra `text/javascript` parts (`cid:js-…`), a `<script>` added to each HTML part, and a re-serialized stylesheet |
| Chrome for Testing 149 with `--disable-field-trial-config` | The same as `wc.savePage` |

| Product and platform | Answer |
| --- | --- |
| Chrome 150, Linux | Equal to `wc.savePage` in Electron 44.5.1 on this fixture |
| Chrome for Testing 149, Linux | Differs by default; equal with `--disable-field-trial-config` |
| Edge, Brave, Chromium, Linux | Not measured on this host: not installed |
| Chrome, Edge, Brave, Chromium, Windows | Not measured on this host: the host runs Linux |
| Chrome, Edge, Brave, Chromium, macOS | Not measured on this host: the host runs Linux |

## What this does not show

- Edge, Brave, Chromium, Windows, macOS, Snap and Flatpak builds, or any other Chrome version. The
  Chrome 150 here is a build old enough to show its own update bubble.
- Anything beyond one run per configuration per browser (two for P12), on one 4-CPU WSL2 host.
  Timings and costs are from those runs.
- The browser's own traffic while it considers itself online. Inside P13's namespace the page read
  `navigator.onLine` as `false`, and an offline browser may send less of its own traffic.
- A desktop session. The GNOME rows of P16 set `XDG_CURRENT_DESKTOP` on a private bus; they are not
  a GNOME session, and no KWallet ran. P17 ran on Xvfb with no window manager.
- A launch with the Egress Direct outside a namespace. Every configuration except P13 ran with the
  proxy fixture as the browser's proxy, so the browser's own traffic would not reach the internet.
- TLS, HTTP/2, HTTP/3, or QUIC. The fixtures speak plain HTTP/1.1 on loopback.
- A pending browser update. P8's restart typed `chrome://restart`.
- An hour of browsing. P12 loaded fifteen pages in under 20 seconds.
- That no detector can tell the engine is attached. P3 covers the listed facts only, and its
  `Error.stack` check failed its positive control.
- Navigations the Operator starts from the browser itself: a typed address, a bookmark, session
  restore, or a link dragged to the tab strip. P4's Ctrl-click and middle-click were sent with
  `Input.dispatchMouseEvent`, not through the X server.
- Whether a screenshot of a background tab is current. The script checked that it held the page's
  content, not that it matched a capture in front.
- MHTML beyond one fixture page: no web fonts, canvas, shadow DOM, or form state.
- The cookie values at rest. P16 read the three-byte prefix of one encrypted value and decrypted
  nothing.
- Why durable messages kept the previous page's bodies in P4 and few bodies across fifteen pages in
  P12.

## Effect on the spec

Each item names the part of the design an answer settles or contradicts. "Settled" means
settled for Linux on the builds measured.

- **Attach before request, step 2** (spec, lines 452-456): contradicted. Waiting for every setup
  command to answer before `Runtime.runIfWaitingForDebugger` stalls a tab a page opens with no
  JavaScript opener: a plain `target=_blank` link or `window.open` with `noopener` (P4). Sending the setup commands and the resume
  together recorded the document request of every page-opened tab. Step 3's "the paused popup did"
  answer holds only for a popup that keeps its opener.
- **Attach before request, "A new tab or popup waits, before its first request"** (spec, lines
  455-456): contradicted for tabs the browser opens with a URL: Ctrl-click, middle-click, and
  `Target.createTarget` with a URL (P4). Their document request is not on any session, so their
  "seen from the first request" flag (spec, line 479) must be false, and a Capture of such a page
  carries no Transaction Record (step 7, line 573). The Validation item "Attach before request"
  (lines 1162-1164) needs a Ctrl-click and a middle-click case. This bears on stage-2 step 4.
- **Attach before request, step 1** (lines 446-451): settled. Auto-attach attached the existing
  first tab without an explicit attach (P7). A service worker attached twice under one `targetId`
  (P9), so "one CDP session per target, keyed by `targetId`" needs the engine to drop the second
  attach, or each of the worker's exchanges is recorded twice.
- **The closed set of domains, `Page` only if P3 clears it** (lines 471-477): the listed facts did
  not change with `Page.enable` or an isolated-world read (P3). The `Error.stack` check could not
  tell, because it read zero with `Runtime.enable` on. Whether that clears `Page` is for the
  maintainer; the Validation item "Page-visible effects" (lines 1198-1200) needs a check that
  detects `Runtime.enable` before it can clear a domain.
- **Rollover's commit signal** (step 2, lines 528-534): settled. `Target.targetInfoChanged` on the
  browser connection marks a commit without the `Page` domain; it also fires for a same-document
  URL change, which the document request's absence tells apart (P3).
- **The cut** (step 5, lines 563-569): no inversion across a tab's sessions in 150 causal steps
  (P11). It does not prove the order is kept.
- **Bodies** (step 3, lines 535-540) and the rejected alternative of fetching at Capture time
  (lines 1222-1226): measured, not settled. Fetching every body at `loadingFinished` cost about 16
  ms of main-process CPU per MB and raised the 99th-percentile event-loop delay from 11 ms to 64-82
  ms (P12). Without durable messages, any navigation, same-site too, drops the previous document's
  bodies (P4), so a fetch at Capture time reaches only the current navigation, which is what a
  Capture holds; only a page larger than the buffer lost bodies that way. Durable messages kept one
  navigation's bodies in P4 and none across fifteen pages in P12, and on Chrome for Testing they
  returned a wrong body without an error. The probe caught that only because each payload was
  known; a running engine has no payload to compare with, which weighs against turning durable
  messages on.
- **Capture sequence, Scroll-to-load** (step 2, lines 593-601): settled. The scroll scripts run over
  `Runtime.evaluate` in an isolated world and behave as in the main world; the page sees scroll
  events, intersection callbacks, and lazy loads (P3). The overflow unlock the step drops did
  nothing on either lock fixture.
- **Capture sequence, screenshot** (step 5, lines 606-611): settled, with an observable cost.
  `captureBeyondViewport` does not move the window, and the page receives `resize`,
  `visualViewport` resize, and `ResizeObserver` callbacks (P2). Passive capture of a tab that is not
  in front (lines 971-972) can take a screenshot (P2).
- **Capture sequence, MHTML** (step 6, lines 612-613): settled for Chrome 150. `Page.captureSnapshot`
  equals `wc.savePage` part for part on the fixture (P24).
- **Capture sequence, PDF** (step 9, lines 617-620): settled. `Page.printToPDF` works in a windowed
  tab (P1).
- **Tabs, windows, and browser contexts** (lines 499-516): a cross-site navigation keeps the tab's
  target and session (P4). A shared worker's requests arrive on a session attached at the browser
  level, not under any tab (P5); the spec does not say who owns them. DevTools does not detach the
  engine, and its front end is a target of type `other` (P18).
- **What the guarantee does not cover** (lines 484-492): settled. A back-forward restore leaves no
  network event, and `Target.targetInfoChanged` is its only trace (P10). The engine's CDP setup
  disables prerendering, so a speculative load never ran on another target; a prefetch appears on
  the tab's own session, and the navigation it serves is a `Document` exchange with
  `fromPrefetchCache` true (P10). A service worker's response has no remote endpoint (P9).
- **Egress, switches and WebRTC check** (lines 829-852): settled.
  `--webrtc-ip-handling-policy` holds and `--force-webrtc-ip-handling-policy` does nothing in either
  browser, and an isolated world on `about:blank` gives the loaded page's result, so the check
  needs no page of its own (P6).
- **Egress, remote endpoint and the browser's own traffic** (lines 853-872): settled for SOCKS5 and
  HTTP proxies on Linux, inside a namespace. No TCP connection and no DNS query went around either
  proxy, and the browser sent host names, not addresses, to both (P13). The remote endpoint check
  also works for an HTTP proxy, whose endpoint CDP reports. A service worker's response carries no
  endpoint (P9), which the check's "is present" condition already skips.
- **Validation, Egress** (lines 1176-1181): contradicted. The wrapper as written does not start the
  browser: inside `unshare -rn` the process runs as root, and Chrome exits with "Running as root
  without --no-sandbox is not supported" (P13). The runs that worked added a nested `unshare -U
  --map-user=<uid> --map-group=<gid>` around the command, and a mount namespace for the DNS
  listener; with both the browser started with the renderer sandbox on. The nested user namespace
  alone was not tried. The item's "no socket to any address but the proxy" would fail on the IPv6
  reachability check's UDP sockets to `2001:4860:4860::8888`, which failed to connect and sent
  nothing; the item needs to say whether it counts sockets or bytes sent.
- **Validation, Connection** (lines 1182-1184): contradicted as worded. With the pipe the browser
  opens no TCP listener and writes no `DevToolsActivePort`, but it listens on its Unix singleton
  socket (P7). The item needs to say which sockets it means.
- **Chrome features that carry a Persona out** (decision D15, lines 689-695): settled for password
  saving. A `credentials_enable_service` value written before the first launch is kept and stops
  the save-password offer (P15). The browser still contacted
  `passwordsleakcheck-pa.googleapis.com` after the fixture sign-in, which D15 does not cover.
- **The key store** (decision D17, lines 696-707): measured for Linux (P16). On this WSL2 host the
  launched browser asks the Secret Service for a key, fails on the locked keyring, and stores cookies
  under the `v10` prefix that comes without an operating-system key. Electron's
  `getSelectedStorageBackend()` does not predict the browser's choice; `isEncryptionAvailable()`
  agreed with it in all three sessions.
- **Cookie seeding** (decision D7, lines 727-734 and 745-749): settled. `--no-startup-window` opens
  the pipe without a window, and `Browser.close` writes `Storage.setCookies` cookies, session
  cookies included, to disk (P14). A seeding launch on a browser profile in use exits with code 0
  within 50 ms and never answers, so the engine has to check the profile's lock before launch or
  read a pipe that closes without answering as a browser profile in use. The session-cookie limit
  the Persona screen
  states (line 807) held on Chrome and not on Chrome for Testing.
- **Ending the Capture Session and the failure table** (lines 281-286, 1090-1091): settled. The
  browser exits within about 0.6 s when the pipe closes, in each of the three ways the probe closed
  it, so "a browser left running after Birdbrain exits" did not occur. A restart from inside the browser
  ends it without a relaunch, which is the "browser exits" row (P8).
- **Identification** (lines 302-306) and **decision D23**: Chrome for Testing reports
  `Chrome/149.0.7827.55`, so the product string cannot tell it from branded Chrome (P20). By default
  it applies its field-trial testing configuration, which changed its MHTML (P24), and it shows an
  infobar that shortens the viewport (P2, P19). A CI suite on Chrome for Testing measures a browser
  that differs from branded Chrome in those ways unless it passes `--disable-field-trial-config`,
  and whether that switch is on Chrome's unsupported-flag list was not checked. With that switch, a
  background-tab screenshot took 2,265 ms where branded Chrome took 18 ms, in one run (P2).
- **What a page can tell, banners** (lines 895-897): settled. No automation infobar appears (P19).
- **The pipe on Windows and macOS** (decision D1, P7): not settled. Stage-2 step 4 stays blocked.
- **The keyboard shortcut** (lines 907-911): works under X11 with no desktop (P17); Wayland and
  desktop sessions are not measured.
- **Where the CDP client runs** (decision D4): measured, not settled. Fetching every body moved the
  main process's 99th-percentile event-loop delay to 64-82 ms and its maximum to 93-140 ms (P12).
  Whether that counts as a stall is the threshold D4 leaves open.
- **The port fallback** (decision D1, option B of the CDP client): the global `WebSocket` exists in
  Electron's main process and drives a browser in port mode (P23).
- **Discovery** (lines 294-300): settled for this host only (P20).

## The probe

Throwaway; not part of the build. Save the script as `probe.mjs` in a scratch directory outside the
repository, written `<S>` here (`/tmp/p1828` in the batch), beside the two files below, and run the
commands from the repository root after `scripts/setup-worktree.sh`. Each configuration writes
`result-<configuration>-<browser>[-<options>].json`, and its screenshots, PDFs, MHTML files, and net
logs, to `<S>/out`, or to `PROBE_OUT`. The script runs Python 3 with Pillow and pypdf for
screenshots, key presses, and PDF parsing, and needs `libX11` and `libXtst`.

```js
// Throwaway probe for the stage-2 launched-browser probe spike (#1828).
// Launches an installed Chromium browser over --remote-debugging-pipe with a
// Birdbrain-style owned profile, attaches before request as the design spec
// does, and measures its P questions against fixture pages on 127.0.0.1 and
// 127.0.0.2. Runs under Electron's Node (ELECTRON_RUN_AS_NODE=1); the
// electron-* configurations and `bodies` run in Electron's main process.
import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { monitorEventLoopDelay } from 'node:perf_hooks'

const SCRIPT = fileURLToPath(import.meta.url)
const ARGS = process.argv.slice(process.argv.findIndex((a) => path.resolve(a) === SCRIPT) + 1)
const CONFIG = ARGS.find((a) => !a.startsWith('-'))
const opt = (n, d) => {
  const a = ARGS.find((x) => x.startsWith(`--probe-${n}=`))
  return a ? a.slice(`--probe-${n}=`.length) : d
}
const has = (n) => ARGS.includes(`--probe-${n}`)
const EXES = {
  chrome: '/usr/bin/google-chrome',
  cft: path.join(os.homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome')
}
const BROWSER = opt('browser', 'chrome')
const BTAG = BROWSER + (opt('tag', '') ? '-' + opt('tag', '') : '') // file name stem for screenshots, PDFs, and MHTML
const EXE = EXES[BROWSER] || BROWSER
const VARIANT = opt('variant', '')
const OUT = process.env.PROBE_OUT || '/tmp/p1828/out'
const ELECTRON_MAIN = Boolean(process.versions.electron) && !process.env.ELECTRON_RUN_AS_NODE
const T0 = Date.now()
const now = () => Date.now() - T0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16)
const short = (e) => String((e && e.message) || e).slice(0, 160)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const TEXT = (n, seed = 'invented fixture text ') => Buffer.from(seed.repeat(Math.ceil(n / seed.length)).slice(0, n))
const BUFFERS = { maxTotalBufferSize: 50e6, maxResourceBufferSize: 10e6 } // the stage-1 probe's limits

// ---------- fixture servers: 127.0.0.1 (site A) and 127.0.0.2 (site B) ----------
const serverLog = []
let A, B
const LOAD_SIZES = [2e3, 20e3, 200e3, 1e6]
const loadBody = (url, size) => {
  const line = crypto.createHash('sha256').update(url).digest('hex') + '\n'
  return Buffer.from(line.repeat(Math.ceil(size / line.length)).slice(0, size))
}
const PAGES = {
  '/facts.html': () => `<!doctype html><html><head><title>facts</title>
<style>@media print { body { background-image: url(/print-only.png) } } #lazy { margin-top: 4000px }</style></head>
<body><h1>facts</h1><p>Invented fixture text for the probe.</p><img src="/img.png">
<div><img id="lazy" loading="lazy" src="/lazy.png" width="10" height="10"><div id="sentinel">end</div><div style="height:1200px"></div></div>
<script>
const lock = new URLSearchParams(location.search).get('lock'); if (lock) { document.documentElement.style.overflow = lock; document.body.style.overflow = lock }
const L = (window.__log = { stackRead: 0, scroll: 0, resize: 0, vvResize: 0, ro: 0, io: [], vis: [], focus: [], mutations: [], print: [], mq: [], pageshow: [], keys: [] })
const probeErr = () => { const e = new Error('x'); Object.defineProperty(e, 'stack', { get() { L.stackRead++; return '' } }); console.debug(e) }
probeErr(); setInterval(probeErr, 250)
addEventListener('scroll', () => L.scroll++, { passive: true })
addEventListener('resize', () => L.resize++)
if (window.visualViewport) visualViewport.addEventListener('resize', () => L.vvResize++)
new ResizeObserver(() => L.ro++).observe(document.documentElement)
document.addEventListener('visibilitychange', () => L.vis.push(document.visibilityState))
addEventListener('focus', () => L.focus.push('focus')); addEventListener('blur', () => L.focus.push('blur'))
new MutationObserver((ms) => { for (const m of ms) L.mutations.push(m.target.nodeName + ' ' + m.attributeName + '=' + m.target.getAttribute(m.attributeName)) }).observe(document.documentElement, { attributes: true, subtree: true })
new IntersectionObserver((es) => { for (const e of es) L.io.push(e.isIntersecting) }).observe(document.getElementById('sentinel'))
addEventListener('beforeprint', () => L.print.push('beforeprint')); addEventListener('afterprint', () => L.print.push('afterprint'))
matchMedia('print').addEventListener('change', (e) => L.mq.push('print:' + e.matches))
addEventListener('pageshow', (e) => L.pageshow.push(e.persisted))
addEventListener('keydown', (e) => L.keys.push(e.key))
window.__facts = () => ({ webdriver: navigator.webdriver, chromeKeys: Object.keys(window.chrome || {}), hasFocus: document.hasFocus(), visibility: document.visibilityState,
  resources: performance.getEntriesByType('resource').map((r) => r.name.replace(location.origin, '')).sort(), scrollY: Math.round(scrollY), inner: [innerWidth, innerHeight], log: L })
</script></body></html>`,
  '/links.html': () => `<!doctype html><title>links</title>
<a id="blank" target="_blank" href="/popup.html?via=blank">new tab</a> <a id="xs" href="${B}/xs-end.html?via=link">cross-site</a>`,
  '/newtabs.html': () => `<!doctype html><title>newtabs</title>
<p><a id="blank" target="_blank" href="/popup.html?via=blank">target=_blank</a></p>
<p><a id="blank-opener" target="_blank" rel="opener" href="/popup.html?via=blank-opener">target=_blank rel=opener</a></p>
<p><a id="ctrl" href="/popup.html?via=ctrl-click">ctrl-click</a></p>
<p><a id="middle" href="/popup.html?via=middle-click">middle-click</a></p>`,
  '/popup.html': () => `<!doctype html><title>popup</title><p>popup</p><img src="/img.png?popup">`,
  '/xs-start.html': () => `<!doctype html><title>xs-start</title><script>fetch('/big.txt?' + location.search.slice(1))</script>
<a id="xs" href="${B}/xs-end.html?via=link">cross-site</a> <a id="same" href="/xs-same.html">same-site</a>`,
  '/xs-end.html': () => `<!doctype html><title>xs-end</title><img src="/img.png?xs-end">`,
  '/xs-same.html': () => `<!doctype html><title>xs-same</title><img src="/img.png?xs-same">`,
  '/frames.html': () => `<!doctype html><title>frames</title>
<iframe src="/frame-same.html"></iframe><iframe src="${B}/frame-xs.html"></iframe>
<script>new Worker('/worker.js'); new SharedWorker('/shared-worker.js'); fetch('/from-page.txt')</script>`,
  '/frame-same.html': () => `<!doctype html><script>fetch('/from-same-frame.txt')</script>`,
  '/frame-xs.html': () => `<!doctype html><script>fetch('/from-xs-frame.txt'); new Worker('/xs-worker.js')</script>`,
  '/sw/page.html': () => `<!doctype html><title>sw</title><script>
window.__sw = (async () => {
  await navigator.serviceWorker.register('/sw/sw.js', { scope: '/sw/' })
  await navigator.serviceWorker.ready
  if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }))
  const out = {}
  for (const p of ['/sw/synth', '/sw/pass.txt', '/sw/cached.txt']) { const r = await fetch(p + '?' + location.search.slice(1)); out[p] = (await r.text()).length }
  return out
})()
</script>`,
  '/bf/a.html': () => `<!doctype html><title>bf-a</title><script>window.__ps = []; addEventListener('pageshow', (e) => __ps.push('show:' + e.persisted)); addEventListener('pagehide', (e) => __ps.push('hide:' + e.persisted))</script>
<img src="/img.png?bf-a"><a id="same" href="/bf/b.html">same-site</a> <a id="xs" href="${B}/bf/b.html">cross-site</a>`,
  '/bf/b.html': () => `<!doctype html><title>bf-b</title><img src="/img.png?bf-b">`,
  '/spec/start.html': () => `<!doctype html><title>spec-start</title>
<script type="speculationrules">{"prerender":[{"source":"list","urls":["/spec/next.html"]}],"prefetch":[{"source":"list","urls":["/spec/pf.html"]}]}</script>
<a id="next" href="/spec/next.html">next</a> <a id="pf" href="/spec/pf.html">pf</a>`,
  '/spec/next.html': () => `<!doctype html><title>spec-next</title><script>fetch('/spec/next-sub.txt'); window.__act = () => ({ prerendering: document.prerendering, activationStart: performance.getEntriesByType('navigation')[0].activationStart })</script>`,
  '/spec/pf.html': () => `<!doctype html><title>spec-pf</title>`,
  '/order/page.html': () => `<!doctype html><title>order</title><iframe src="${B}/order/frame.html"></iframe><script>
const w = new Worker('/order/worker.js')
const ready = new Promise((r) => addEventListener('message', function h(e) { if (e.data === 'ready') { removeEventListener('message', h); r() } }))
const viaFrame = (i) => new Promise((r) => { const h = (e) => { if (e.data === 'f' + i) { removeEventListener('message', h); r() } }; addEventListener('message', h); frames[0].postMessage(i, '*') })
const viaWorker = (i) => new Promise((r) => { const h = (e) => { if (e.data === 'w' + i) { w.removeEventListener('message', h); r() } }; w.addEventListener('message', h); w.postMessage(i) })
window.__run = async (n) => { await ready; for (let i = 0; i < n; i++) { await (await fetch('/order/p?i=' + i)).text(); await viaFrame(i); await viaWorker(i) } return n }
</script>`,
  '/order/frame.html': () => `<!doctype html><script>addEventListener('message', async (e) => { await (await fetch('/order/f?i=' + e.data)).text(); parent.postMessage('f' + e.data, '*') }); parent.postMessage('ready', '*')</script>`,
  '/mhtml.html': () => `<!doctype html><html><head><title>mhtml</title><link rel="stylesheet" href="/mhtml.css"></head>
<body><h1>mhtml fixture</h1><p>Invented text for the equivalence check.</p><img src="/img.png?mhtml">
<iframe src="/frame-same.html?mhtml"></iframe><iframe src="${B}/mhtml-frame.html"></iframe><div id="dyn"></div>
<script>document.getElementById('dyn').textContent = 'added by script'</script></body></html>`,
  '/mhtml-frame.html': () => `<!doctype html><p>cross-site frame</p><img src="/img.png?xsframe">`,
  '/webrtc.html': () => `<!doctype html><title>webrtc</title><p>webrtc</p>`,
  '/login.html': () => `<!doctype html><title>login</title><form method="post" action="/login">
<input id="u" name="username" autocomplete="username"> <input id="p" name="password" type="password" autocomplete="current-password"> <button>Sign in</button></form>`,
  '/signed-in.html': () => `<!doctype html><title>signed in</title><p>Signed in to the fixture.</p>`,
  '/keys.html': () => `<!doctype html><title>keys</title><script>window.__keys = []; addEventListener('keydown', (e) => __keys.push((e.ctrlKey ? 'Ctrl+' : '') + (e.shiftKey ? 'Shift+' : '') + e.key))</script><p>keys</p>`,
  '/egress.html': () => `<!doctype html><title>egress</title>
<link rel="dns-prefetch" href="//dns-prefetch.egress-probe.test"><link rel="preconnect" href="http://preconnect.egress-probe.test">
<img src="http://img.egress-probe.test/x.png"><img src="https://tls.egress-probe.test/x.png"><a href="http://anchor.egress-probe.test/">anchor</a>
<script>fetch('http://fetch.egress-probe.test/x').catch(() => {})</script>`
}
const SCRIPTS = {
  '/worker.js': `fetch('/from-worker.txt')`,
  '/xs-worker.js': `fetch('/from-xs-worker.txt')`,
  '/shared-worker.js': `fetch('/from-shared-worker.txt')`,
  '/order/worker.js': `onmessage = async (e) => { await (await fetch('/order/w?i=' + e.data)).text(); postMessage('w' + e.data) }`,
  '/sw/sw.js': `self.addEventListener('install', (e) => e.waitUntil(caches.open('c').then((c) => c.add('/sw/cached.txt?install')).then(() => self.skipWaiting())))
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url)
  if (u.pathname === '/sw/synth') return e.respondWith(new Response('synthetic body from the worker', { headers: { 'content-type': 'text/plain' } }))
  if (u.pathname === '/sw/cached.txt') return e.respondWith(caches.match('/sw/cached.txt?install'))
  if (u.pathname === '/sw/pass.txt' || e.request.mode === 'navigate') return e.respondWith(fetch(e.request))
})`
}

function route(req, res, host) {
  const u = new URL(req.url, 'http://x')
  const p = u.pathname
  const cookieNames = (req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => c.split('=')[0])
  serverLog.push({ i: serverLog.length, t: now(), host, method: req.method, url: req.url, cookieNames, purpose: req.headers['sec-purpose'] })
  const send = (status, type, body, extra = {}) => res.writeHead(status, { 'content-type': type, ...extra }).end(body)
  if (PAGES[p]) return send(200, 'text/html', PAGES[p]())
  if (SCRIPTS[p]) return send(200, 'text/javascript', SCRIPTS[p])
  if (p.endsWith('.png')) return send(200, 'image/png', PNG)
  if (p === '/mhtml.css') return send(200, 'text/css', 'body { background: url(/bg.png) } h1 { color: rgb(1, 2, 3) }')
  if (p === '/big.txt') return send(200, 'text/plain', TEXT(200e3))
  if (p === '/no-content') return res.writeHead(204).end()
  if (p === '/login' && req.method === 'POST') { req.resume(); return res.writeHead(302, { location: '/signed-in.html' }).end() }
  if (p === '/cookies') return send(200, 'text/plain', cookieNames.join(','))
  if (p === '/setcookie') return send(200, 'text/html', '<title>set</title>', { 'set-cookie': 'fixture_at_rest=invented-value; Max-Age=86400; Path=/' })
  if (p.startsWith('/load/r/')) { const size = Number(u.searchParams.get('size')); return send(200, 'text/plain', loadBody(req.url, size)) }
  if (p.startsWith('/load/')) {
    const n = Number(p.slice(6).split('.')[0])
    const urls = n === 14 ? Array.from({ length: 8 }, (_, i) => `/load/r/${n}/${i}?size=9000000`) : Array.from({ length: 40 }, (_, i) => `/load/r/${n}/${i}?size=${LOAD_SIZES[i % 4]}`)
    return send(200, 'text/html', `<!doctype html><title>load ${n}</title><img src="/img.png?load${n}"><script>window.__done = Promise.all(${JSON.stringify(urls)}.map((u) => fetch(u).then((r) => r.arrayBuffer())))</script>`)
  }
  if (p.endsWith('.txt') || p.startsWith('/order/') || p === '/sw/synth') return send(200, 'text/plain', 'fixture ' + req.url)
  send(404, 'text/plain', 'not found')
}
async function startServers() {
  const mk = (host, port) => new Promise((r) => { const s = http.createServer((q, s2) => route(q, s2, host)); s.listen(port, host, () => r(s)) })
  const sa = await mk('127.0.0.1', Number(process.env.PROBE_PORT_A || 0))
  const sb = await mk('127.0.0.2', Number(process.env.PROBE_PORT_B || 0))
  A = 'http://127.0.0.1:' + sa.address().port
  B = 'http://127.0.0.2:' + sb.address().port
}

// ---------- proxy fixtures: they log every destination and forward only to loopback ----------
const isLoopback = (h) => /^127\./.test(h) || h === 'localhost' || h === '::1'
const proxyLog = []
let SOCKS_PORT, HTTP_PROXY_PORT
function startSocks() {
  const s = net.createServer((c) => {
    c.on('error', () => {})
    c.once('data', () => {
      c.write(Buffer.from([5, 0]))
      c.once('data', (req) => {
        const atyp = req[3]
        let host, off
        if (atyp === 1) { host = [...req.subarray(4, 8)].join('.'); off = 8 }
        else if (atyp === 3) { const n = req[4]; host = req.subarray(5, 5 + n).toString(); off = 5 + n }
        else if (atyp === 4) { host = 'ipv6:' + req.subarray(4, 20).toString('hex'); off = 20 }
        else return c.end()
        const port = req.readUInt16BE(off)
        const allowed = isLoopback(host)
        proxyLog.push({ t: now(), kind: 'socks5', host, port, atyp, allowed })
        if (!allowed) return c.end(Buffer.from([5, 2, 0, 1, 0, 0, 0, 0, 0, 0]))
        const up = net.connect(port, host, () => { c.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0])); c.pipe(up); up.pipe(c) })
        up.on('error', () => c.end())
      })
    })
  })
  return new Promise((r) => s.listen(0, '127.0.0.1', () => { SOCKS_PORT = s.address().port; r() }))
}
function startHttpProxy() {
  const s = http.createServer((req, res) => {
    let u
    try { u = new URL(req.url) } catch { return res.writeHead(400).end() }
    const allowed = isLoopback(u.hostname)
    proxyLog.push({ t: now(), kind: 'http', host: u.hostname, port: Number(u.port || 80), allowed })
    if (!allowed) return res.writeHead(403).end()
    const up = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
    up.on('error', () => res.writeHead(502).end())
    req.pipe(up)
  })
  s.on('connect', (req, c) => {
    const [host, port] = req.url.split(':')
    const allowed = isLoopback(host)
    proxyLog.push({ t: now(), kind: 'http-connect', host, port: Number(port), allowed })
    if (!allowed) return c.end('HTTP/1.1 403 Forbidden\r\n\r\n')
    const up = net.connect(Number(port), host, () => { c.write('HTTP/1.1 200 OK\r\n\r\n'); c.pipe(up); up.pipe(c) })
    up.on('error', () => c.end())
  })
  return new Promise((r) => s.listen(0, '127.0.0.1', () => { HTTP_PROXY_PORT = s.address().port; r() }))
}

// ---------- CDP client over the pipe (NUL-framed JSON) or a WebSocket ----------
class Cdp {
  constructor(sendRaw) { Object.assign(this, { sendRaw, id: 0, pending: new Map(), handlers: [], sent: [], bytesIn: 0, msgsIn: 0, closedAt: null }) }
  onMessage(text) {
    this.bytesIn += text.length; this.msgsIn++
    const m = JSON.parse(text)
    if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.timer); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result) }
    else for (const h of this.handlers) h(m)
  }
  send(method, params = {}, sessionId, timeoutMs = 20000) {
    const id = ++this.id
    const msg = { id, method, params }
    if (sessionId) msg.sessionId = sessionId
    this.sent.push(method)
    this.sendRaw(JSON.stringify(msg))
    return new Promise((res, rej) => { const timer = setTimeout(() => { this.pending.delete(id); rej(new Error('timeout ' + method)) }, timeoutMs); this.pending.set(id, { res, rej, timer }) })
  }
  waitEvent(pred, timeoutMs = 10000) {
    return new Promise((res) => {
      const h = (m) => { if (pred(m)) { this.handlers.splice(this.handlers.indexOf(h), 1); clearTimeout(timer); res(m) } }
      const timer = setTimeout(() => { this.handlers.splice(this.handlers.indexOf(h), 1); res(null) }, timeoutMs)
      this.handlers.push(h)
    })
  }
}
function pipeClient(toBrowser, fromBrowser) {
  const cdp = new Cdp((t) => toBrowser.write(t + '\0'))
  let buf = Buffer.alloc(0)
  fromBrowser.on('data', (d) => {
    buf = Buffer.concat([buf, d])
    let i
    while ((i = buf.indexOf(0)) >= 0) { const msg = buf.subarray(0, i).toString('utf8'); buf = buf.subarray(i + 1); cdp.onMessage(msg) }
  })
  fromBrowser.on('close', () => { cdp.closedAt = now() })
  toBrowser.on('error', () => {})
  return cdp
}

// ---------- launch: the design's argument list, with the probe's proxy guard ----------
const launched = []
async function launch({ args = [], profile, pipe = true, port = 9334, env = {}, startUrl = 'about:blank', guard = has('guard'), exe = EXE } = {}) {
  profile = profile || fs.mkdtempSync(path.join(os.tmpdir(), 'p1828-profile-'))
  const a = ['--user-data-dir=' + profile, pipe ? '--remote-debugging-pipe' : '--remote-debugging-port=' + port, '--no-first-run', '--no-default-browser-check', '--disable-sync']
  if (guard) a.push('--proxy-server=socks5://127.0.0.1:' + SOCKS_PORT)
  a.push(...args, ...(opt('extra', '') ? opt('extra', '').split(',') : []))
  if (startUrl) a.push(startUrl)
  const startedAt = now()
  const child = spawn(exe, a, { stdio: ['ignore', 'ignore', 'pipe', pipe ? 'pipe' : 'ignore', pipe ? 'pipe' : 'ignore'], env: { ...process.env, ...env } })
  launched.push({ child, profile })
  let stderr = ''
  child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 4e6) stderr = stderr.slice(-2e6) })
  const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal, t: now() })))
  let cdp
  if (pipe) cdp = pipeClient(child.stdio[3], child.stdio[4])
  else {
    let ver
    for (let i = 0; i < 100 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() } catch { await sleep(100) } }
    const ws = new WebSocket(ver.webSocketDebuggerUrl)
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
    cdp = new Cdp((t) => ws.send(t))
    ws.onmessage = (e) => cdp.onMessage(e.data)
  }
  const version = await Promise.race([cdp.send('Browser.getVersion', {}, undefined, 30000), exited.then((e) => { throw new Error('browser exited before answering: ' + JSON.stringify(e) + ' ' + stderr.trim().split('\n').slice(-2).join(' | ')) })])
  return { child, cdp, version, profile, args: a, exited, startedAt, readyAt: now(), stderr: () => stderr, exe }
}
async function closeBrowser(b, ms = 10000) {
  await b.cdp.send('Browser.close', {}, undefined, 5000).catch(() => {})
  const r = await Promise.race([b.exited, sleep(ms).then(() => null)])
  if (!r) b.child.kill('SIGKILL')
  return r
}

// ---------- the engine: attach before request (design spec, "Attach before request") ----------
const pickResp = (r) => ({ status: r.status, ip: r.remoteIPAddress, port: r.remotePort, fromSW: r.fromServiceWorker || undefined, swSource: r.serviceWorkerResponseSource, fromDisk: r.fromDiskCache || undefined, fromPrefetch: r.fromPrefetchCache || undefined, protocol: r.protocol })
async function engine(cdp, o = {}) {
  const E = { sessions: new Map(), events: [], seq: 0, inflight: new Map() }
  const enableParams = { ...BUFFERS, ...(o.durable === 'enable' ? { enableDurableMessages: true } : {}) }
  E.bySession = (n) => E.events.filter((e) => e.s === n)
  cdp.handlers.push((m) => {
    if (!m.method) return
    const s = m.sessionId ? E.sessions.get(m.sessionId) : null
    const p = m.params || {}
    const rec = { i: E.seq++, t: now(), s: s ? s.n : 'browser', m: m.method }
    if (m.method.startsWith('Network.')) {
      rec.id = p.requestId
      if (p.request) { rec.url = p.request.url; rec.method = p.request.method }
      if (p.type) rec.type = p.type
      if (p.response) rec.resp = pickResp(p.response)
      if (p.redirectResponse) rec.redirect = pickResp(p.redirectResponse)
      if (p.errorText) rec.err = p.errorText
      if (p.loaderId) rec.loader = p.loaderId
      const key = (s ? s.n : 'b') + ':' + p.requestId
      if (m.method === 'Network.requestWillBeSent') E.inflight.set(key, now())
      if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') E.inflight.delete(key)
      if (m.method === 'Network.loadingFinished' && o.onFinished) o.onFinished(s, p)
    }
    if (m.method.startsWith('Target.')) {
      const ti = p.targetInfo || {}
      Object.assign(rec, { target: ti.targetId || p.targetId, type: ti.type, subtype: ti.subtype, url: ti.url, opener: ti.openerId, ctx: ti.browserContextId, waiting: p.waitingForDebugger })
    }
    if (m.method.startsWith('Page.')) { rec.url = (p.frame && p.frame.url) || p.url; rec.reasons = p.notRestoredExplanations && p.notRestoredExplanations.map((x) => x.reason) }
    if (m.method.startsWith('Inspector.')) rec.reason = p.reason
    if (m.method.startsWith('Preload.')) rec.preload = { status: p.status, final: p.prerenderStatus || p.prefetchStatus, url: (p.key && p.key.url) || p.prefetchUrl || p.url, action: p.key && p.key.action, mojo: p.disallowedMojoInterface }
    E.events.push(rec)
    if (m.method === 'Target.attachedToTarget') onAttach(m)
    if (m.method === 'Target.detachedFromTarget') { const d = E.sessions.get(p.sessionId); if (d) d.detachedAt = now() }
  })
  async function onAttach(m) {
    const { sessionId, targetInfo, waitingForDebugger } = m.params
    const parent = m.sessionId ? E.sessions.get(m.sessionId) : null
    const s = { n: E.sessions.size, sessionId, targetId: targetInfo.targetId, type: targetInfo.type, subtype: targetInfo.subtype, url: targetInfo.url, ctx: targetInfo.browserContextId, opener: targetInfo.openerId, parent: parent ? parent.n : null, waiting: waitingForDebugger, attachedAt: now(), steps: [] }
    E.sessions.set(sessionId, s)
    s.recorded = ['page', 'iframe', 'worker', 'shared_worker', 'service_worker'].includes(s.type) && !/^(devtools|chrome|chrome-extension|chrome-untrusted):/.test(s.url)
    if (s.recorded && (o.resume || opt('resume', 'await')) === 'pipeline' && waitingForDebugger) {
      // Send every setup command and the resume back to back, then wait for all of them.
      const t = now()
      const sends = [['Network.enable', enableParams], ['Network.setCacheDisabled', { cacheDisabled: true }], ...(s.type === 'page' || s.type === 'iframe' ? [['Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }]] : []), ['Runtime.runIfWaitingForDebugger', {}]]
        .map(([method, params]) => cdp.send(method, params, sessionId, o.enableTimeout || 20000).then(() => s.steps.push(method + ' ' + (now() - t) + 'ms'), (e) => s.steps.push(method + ' ' + short(e))))
      await Promise.all(sends)
      s.resumedAt = now(); s.ready = true
      return
    }
    try {
      if (s.recorded) {
        const t = now()
        await cdp.send('Network.enable', enableParams, sessionId, o.enableTimeout || 20000).finally(() => { s.enableMs = now() - t }); s.steps.push('Network.enable')
        if (o.durable === 'configure') { await cdp.send('Network.configureDurableMessages', BUFFERS, sessionId); s.steps.push('Network.configureDurableMessages') }
        if (o.cacheDisabled !== false) { await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId); s.steps.push('Network.setCacheDisabled') }
        if (s.type === 'page' || s.type === 'iframe') { await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId); s.steps.push('Target.setAutoAttach') }
        if (o.onAttach) await o.onAttach(s)
      }
    } catch (e) { s.error = short(e) }
    if (waitingForDebugger) { await cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch((e) => { s.resumeError = short(e) }); s.resumedAt = now() }
    s.ready = true
  }
  await cdp.send('Target.setDiscoverTargets', { discover: true })
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
  E.session = async (pred, ms = 10000) => { for (let i = 0; i < ms / 50; i++) { const s = [...E.sessions.values()].find((x) => pred(x) && x.ready); if (s) return s; await sleep(50) } return null }
  E.tab = () => E.session((s) => s.type === 'page' && s.recorded)
  E.newTab = async (url = 'about:blank', extra = {}) => { const { targetId } = await cdp.send('Target.createTarget', { url, ...extra }); return E.session((s) => s.targetId === targetId) }
  E.idle = async (quietMs = 700, maxMs = 15000) => {
    const start = now(); let quietSince = now()
    // A request with no end event for 10 seconds (a long poll, a detached target) stops counting.
    const busy = () => [...E.inflight.values()].some((t) => now() - t < 10000)
    while (now() - start < maxMs) { if (busy()) quietSince = now(); else if (now() - quietSince >= quietMs) return true; await sleep(50) }
    return false
  }
  E.navigate = async (s, url) => { const r = await cdp.send('Page.navigate', { url }, s.sessionId); await E.idle(); return r }
  E.evalMain = async (s, expression, extra = {}) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...extra }, s.sessionId)
    if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 200))
    return r.result.value
  }
  E.evalIso = async (s, expression) => {
    const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: s.targetId, worldName: 'probe' }, s.sessionId)
    const r = await cdp.send('Runtime.evaluate', { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true }, s.sessionId)
    if (r.exceptionDetails) throw new Error('isolated exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 200))
    return r.result.value
  }
  E.click = (s, id) => E.evalMain(s, `document.getElementById(${JSON.stringify(id)}).click()`, { userGesture: true })
  E.sessionList = () => [...E.sessions.values()].map(({ sessionId, ...rest }) => rest)
  E.requests = (filter) => E.events.filter((e) => e.m === 'Network.requestWillBeSent' && filter(e.url || ''))
  return E
}
// Which CDP session reported each request the fixture server logged.
function coverage(E, filter) {
  const served = serverLog.filter((l) => filter(l.url))
  const seen = E.events.filter((e) => e.m === 'Network.requestWillBeSent' && e.url && filter(new URL(e.url).pathname + new URL(e.url).search))
  return {
    served: served.map((l) => l.host + l.url),
    reported: seen.map((e) => ({ url: e.url.replace(A, 'A').replace(B, 'B'), session: e.s, type: e.type })),
    servedNotReported: served.filter((l) => !seen.some((e) => e.url.endsWith(l.url) && e.url.includes(l.host))).map((l) => l.host + l.url)
  }
}

// ---------- helpers outside CDP: processes, sockets, X display, files ----------
function procs(profile) {
  const out = []
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    // Chrome rewrites its process title, so match the whole command line as text.
    let cmd
    try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ') } catch { continue }
    if (!cmd.includes('--user-data-dir=' + profile + ' ') && !cmd.endsWith('--user-data-dir=' + profile)) continue
    let state = '?'
    try { state = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0] } catch {}
    const type = (/--type=(\S+)/.exec(cmd) || [null, 'browser'])[1]
    out.push({ pid: Number(pid), type, state, pipe: cmd.includes('--remote-debugging-pipe') })
  }
  return out
}
function listeners(pids) {
  const inodes = new Set()
  for (const pid of pids) {
    let fds = []
    try { fds = fs.readdirSync(`/proc/${pid}/fd`) } catch {}
    for (const fd of fds) { try { const m = /^socket:\[(\d+)\]$/.exec(fs.readlinkSync(`/proc/${pid}/fd/${fd}`)); if (m) inodes.add(m[1]) } catch {} }
  }
  const tcp = []
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) for (const line of fs.readFileSync(f, 'utf8').split('\n').slice(1)) { const c = line.trim().split(/\s+/); if (c.length > 9 && c[3] === '0A' && inodes.has(c[9])) tcp.push(c[1]) }
  const unix = []
  for (const line of fs.readFileSync('/proc/net/unix', 'utf8').split('\n').slice(1)) { const c = line.trim().split(/\s+/); if (c.length >= 7 && c[3] === '00010000' && inodes.has(c[6])) unix.push(c[7] || '(unnamed)') }
  return { sockets: inodes.size, tcpListen: tcp, unixListen: unix }
}
const alive = (pid) => { try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0] !== 'Z' } catch { return false } }
const py = (code, args) => { const r = spawnSync('python3', ['-P', '-c', code, ...args], { encoding: 'utf8', timeout: 30000 }); return r.status === 0 ? r.stdout.trim() : 'python error: ' + (r.stderr || '').slice(-300) }
const XSHOT = `import sys\nfrom PIL import ImageGrab\nim = ImageGrab.grab(xdisplay=sys.argv[1])\nim.save(sys.argv[2])\nprint(im.size)`
const xshot = (name) => { const f = path.join(OUT, name + '.png'); return { file: f, size: py(XSHOT, [process.env.DISPLAY, f]) } }
const XKEYS = `import ctypes, sys, time
x = ctypes.cdll.LoadLibrary('libX11.so.6'); t = ctypes.cdll.LoadLibrary('libXtst.so.6')
x.XOpenDisplay.restype = ctypes.c_void_p; x.XOpenDisplay.argtypes = [ctypes.c_char_p]
x.XStringToKeysym.restype = ctypes.c_ulong; x.XStringToKeysym.argtypes = [ctypes.c_char_p]
x.XKeysymToKeycode.restype = ctypes.c_ubyte; x.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
t.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
t.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
t.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
x.XFlush.argtypes = [ctypes.c_void_p]
d = x.XOpenDisplay(sys.argv[1].encode())
for combo in sys.argv[2:]:
    if combo.startswith('click:'):
        a, b = map(int, combo[6:].split(',')); t.XTestFakeMotionEvent(d, -1, a, b, 0); t.XTestFakeButtonEvent(d, 1, 1, 0); t.XTestFakeButtonEvent(d, 1, 0, 0)
    else:
        codes = [x.XKeysymToKeycode(d, x.XStringToKeysym(k.encode())) for k in combo.split('+')]
        for c in codes: t.XTestFakeKeyEvent(d, c, 1, 0)
        for c in reversed(codes): t.XTestFakeKeyEvent(d, c, 0, 0)
    x.XFlush(d); time.sleep(0.4)
print('sent', len(sys.argv) - 2)`
const xkeys = (...combos) => py(XKEYS, [process.env.DISPLAY, ...combos])
const IMG = `import sys, json
from PIL import Image
out = {}
for f in sys.argv[1:]:
    im = Image.open(f).convert('RGB'); c = im.getcolors(1 << 22)
    out[f.split('/')[-1]] = {'size': im.size, 'distinctColors': len(c) if c else 'many', 'extrema': im.getextrema()}
print(json.dumps(out))`
const PDF = `import sys, json
from pypdf import PdfReader
r = PdfReader(sys.argv[1])
print(json.dumps({'pages': len(r.pages), 'text': r.pages[0].extract_text()[:80], 'mediabox': [float(v) for v in r.pages[0].mediabox], 'images': len(r.pages[0].images)}))`
function cookieRows(profile) {
  for (const rel of ['Default/Cookies', 'Default/Network/Cookies']) {
    const f = path.join(profile, rel)
    if (!fs.existsSync(f)) continue
    const copy = path.join(os.tmpdir(), 'p1828-cookies-' + process.pid + '.db')
    fs.copyFileSync(f, copy)
    return import('node:sqlite').then(({ DatabaseSync }) => {
      const db = new DatabaseSync(copy, { readOnly: true })
      const rows = db.prepare('SELECT host_key, name, is_persistent, has_expires, substr(encrypted_value, 1, 3) AS prefix, length(encrypted_value) AS len, length(value) AS plainLen FROM cookies').all()
      db.close(); fs.rmSync(copy)
      return { file: rel, rows: rows.map((r) => ({ ...r, prefix: Buffer.from(r.prefix).toString('latin1') })) }
    })
  }
  return Promise.resolve({ file: null, rows: [] })
}
const ICE = `(async () => { const cands = []; try { const pc = new RTCPeerConnection({ iceServers: [] }); pc.createDataChannel('x')
  await new Promise(async (resolve) => { pc.onicecandidate = (e) => { if (e.candidate) cands.push(e.candidate.candidate); else resolve() }; await pc.setLocalDescription(await pc.createOffer()); setTimeout(resolve, 3000) }); pc.close() } catch (e) { cands.push('error:' + e) } return cands })()`
// Candidate strings carry the host's addresses; keep only their shape.
const iceShape = (cands) => cands.map((c) => { if (c.startsWith('error:')) return c; const f = c.split(' '); return `${f[2]} ${f[7]} ${/\.local$/.test(f[4]) ? 'mdns-name' : f[4].includes(':') ? 'ipv6' : 'ipv4'}` })

// ---------- the scroll scripts, copied from src/main/services/backgroundRenderer.ts:134-209 ----------
const SCROLL_HELPERS = `
  const setScrollTop = (el, y) => {
    if (el.scrollTo) el.scrollTo({ top: y, behavior: 'instant' })
    else el.scrollTop = y
  }
  const canScroll = (el) => {
    if (!el || el.scrollHeight <= el.clientHeight + 2) return false
    const prev = el.scrollTop
    setScrollTop(el, prev + 1)
    const moved = el.scrollTop !== prev
    setScrollTop(el, prev)
    return moved
  }
  const doc = document.scrollingElement || document.documentElement || document.body
  const pickRoot = () => {
    if (canScroll(doc)) return doc
    let best = null
    let bestGain = 0
    const minHeight = Math.max((window.innerHeight || 0) / 2, 150)
    for (const el of document.querySelectorAll('body *')) {
      const gain = el.scrollHeight - el.clientHeight
      if (gain > bestGain && el.clientHeight >= minHeight && canScroll(el)) {
        best = el
        bestGain = gain
      }
    }
    return best
  }
`
const SCROLL_UNLOCK_SCRIPT = `(() => {
${SCROLL_HELPERS}
if (pickRoot()) return null
if (!doc || doc.scrollHeight <= doc.clientHeight + 2) return null
const prior = []
for (const el of [document.documentElement, document.body]) {
prior.push(el ? el.style.overflow : '')
if (el) el.style.overflow = 'visible'
}
return prior
})()`
const SCROLL_STEP_SCRIPT = `(() => {
${SCROLL_HELPERS}
const root = pickRoot()
if (!root) return null
const viewportHeight = Math.max(root.clientHeight || 0, window.innerHeight || 0, 1)
const maxY = Math.max(0, root.scrollHeight - viewportHeight)
setScrollTop(root, Math.min(maxY, root.scrollTop + viewportHeight))
return { y: root.scrollTop, height: root.scrollHeight, viewportHeight }
})()`
function scrollResetScript(priorOverflow) {
  return `(() => {
${SCROLL_HELPERS}
const root = pickRoot()
if (root) setScrollTop(root, 0)
window.scrollTo(0, 0)
const prior = ${JSON.stringify(priorOverflow)}
if (prior) {
const els = [document.documentElement, document.body]
for (let i = 0; i < els.length; i++) {
if (els[i]) els[i].style.overflow = prior[i] ?? ''
}
}
})()`
}
// The loop of scrollToLoadLazyContent (backgroundRenderer.ts:215-262), driven over CDP.
async function scrollOverCdp(run, withUnlock) {
  const prior = withUnlock ? await run(SCROLL_UNLOCK_SCRIPT) : null
  const steps = []
  let stalls = 0, lastHeight = 0, lastY = -1
  const deadline = now() + 20000
  while (now() < deadline) {
    const st = await run(SCROLL_STEP_SCRIPT)
    steps.push(st)
    if (!st) break
    await sleep(500)
    const atBottom = st.y + st.viewportHeight >= st.height - 2
    const noGrowth = st.height <= lastHeight
    if ((atBottom && noGrowth) || (noGrowth && st.y <= lastY + 1)) { if (++stalls >= 3) break } else stalls = 0
    lastHeight = st.height; lastY = st.y
  }
  await run(scrollResetScript(prior))
  await sleep(500)
  return { prior, steps: steps.length, last: steps[steps.length - 1] }
}

// ---------- configurations ----------
const CONFIGS = {}

// P7, P19: the pipe itself, listening sockets, files in the profile, banners.
CONFIGS.pipe = async () => {
  const b = await launch()
  const E = await engine(b.cdp)
  const first = await E.tab()
  const out = { version: b.version, exe: b.exe, realExe: fs.realpathSync(b.exe), args: b.args, readyMs: b.readyAt - b.startedAt }
  out.firstTab = first && { attachedBy: 'auto-attach', waiting: first.waiting, url: first.url }
  await E.navigate(first, A + '/facts.html')
  out.webdriver = await E.evalMain(first, 'navigator.webdriver')
  await sleep(3000)
  out.screenshot = xshot(`banners-${BTAG}`)
  const ps = procs(b.profile)
  out.processes = ps.map((p) => p.type)
  out.sockets = listeners(ps.map((p) => p.pid))
  out.profileFiles = ['DevToolsActivePort', 'SingletonLock', 'SingletonSocket', 'SingletonCookie'].map((f) => [f, fs.existsSync(path.join(b.profile, f)) || (() => { try { fs.lstatSync(path.join(b.profile, f)); return 'symlink' } catch { return false } })()])
  out.sessions = E.sessionList()
  out.exit = await closeBrowser(b)
  out.proxyLog = proxyLog
  return out
}

// P3: page-observable facts per engine variant, each on a fresh tab.
CONFIGS['page-reads'] = async () => {
  const b = await launch()
  const E = await engine(b.cdp)
  const warm = await E.tab()
  await E.navigate(warm, A + '/facts.html?warm-up=1') // the first load of an origin also fetches /favicon.ico
  await sleep(3000)
  const out = { version: b.version, variants: {} }
  const variants = ['network-only', 'page-enable', 'isolated-read', 'scroll-isolated', 'scroll-main', 'unlock-hidden-isolated', 'unlock-clip-isolated', 'runtime-enable']
  for (const v of variants) {
    const s = await E.newTab()
    const r = { setup: [] }
    if (v === 'page-enable') { await b.cdp.send('Page.enable', {}, s.sessionId); r.setup.push('Page.enable') }
    if (v === 'runtime-enable') { await b.cdp.send('Runtime.enable', {}, s.sessionId); r.setup.push('Runtime.enable') }
    const fromEvent = E.events.length
    const logMark = serverLog.length
    await E.navigate(s, A + '/facts.html' + (v.startsWith('unlock-') ? '?lock=' + v.split('-')[1] : ''))
    await sleep(1500)
    const before = await E.evalMain(s, 'JSON.parse(JSON.stringify(window.__facts()))')
    if (v === 'isolated-read') r.isolated = await E.evalIso(s, '({ visibility: document.visibilityState, hasFocus: document.hasFocus(), textLength: document.body.innerText.length })')
    if (v === 'scroll-isolated' || v.startsWith('unlock-')) r.scroll = await scrollOverCdp((x) => E.evalIso(s, x), v.startsWith('unlock-'))
    if (v === 'scroll-main') r.scroll = await scrollOverCdp((x) => E.evalMain(s, x), true)
    await sleep(1000)
    const after = await E.evalMain(s, 'JSON.parse(JSON.stringify(window.__facts()))')
    r.before = before
    r.after = after
    r.pageEvents = E.events.slice(fromEvent).filter((e) => e.s === s.n && e.m.startsWith('Page.')).map((e) => e.m)
    r.lazyRequests = serverLog.slice(logMark).filter((l) => l.url === '/lazy.png').length
    out.variants[v] = r
    await b.cdp.send('Target.closeTarget', { targetId: s.targetId })
    await sleep(300)
  }
  // A commit signal without the Page domain: Target.targetInfoChanged against the network events.
  const s = await E.newTab()
  const mark = E.events.length
  await E.navigate(s, A + '/facts.html?commit=1')
  await E.evalMain(s, "history.pushState({}, '', '/facts.html?pushed=1')")
  await sleep(500)
  await b.cdp.send('Page.navigate', { url: A + '/no-content' }, s.sessionId)
  await sleep(1500)
  out.commitSignal = E.events.slice(mark).filter((e) => (e.s === s.n && (e.type === 'Document' || e.m === 'Network.loadingFinished')) || (e.m === 'Target.targetInfoChanged' && e.target === s.targetId))
    .map((e) => ({ i: e.i, m: e.m, url: e.url && e.url.replace(A, 'A'), type: e.type, status: e.resp && e.resp.status }))
  out.exit = await closeBrowser(b)
  return out
}

// P1, P2, P24 (launched side): screenshot in front and behind, MHTML, then PDF last.
CONFIGS.artifacts = async () => {
  const b = await launch()
  const E = await engine(b.cdp)
  const s = await E.tab()
  const out = { version: b.version }
  await E.navigate(s, A + '/facts.html')
  await sleep(1000)
  const win = async () => (await b.cdp.send('Browser.getWindowForTarget', { targetId: s.targetId })).bounds
  out.windowBefore = await win()
  const f0 = await E.evalMain(s, 'JSON.parse(JSON.stringify(window.__facts()))')
  const metrics = await b.cdp.send('Page.getLayoutMetrics', {}, s.sessionId)
  const { width, height } = metrics.cssContentSize
  const shot = await b.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } }, s.sessionId)
  fs.writeFileSync(path.join(OUT, `shot-front-${BTAG}.png`), Buffer.from(shot.data, 'base64'))
  await sleep(500)
  const f1 = await E.evalMain(s, 'JSON.parse(JSON.stringify(window.__facts()))')
  out.windowAfter = await win()
  out.frontCapture = { contentSize: [width, height], logBefore: f0.log, logAfter: f1.log, innerBefore: f0.inner, innerAfter: f1.inner }
  // A tab that is not in front.
  const front = await E.newTab(A + '/popup.html?front=1')
  await E.idle()
  await sleep(1000)
  const vis = await E.evalMain(s, 'document.visibilityState')
  const t = now()
  for (const beyond of [false, true]) {
    try {
      const r = await b.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: beyond }, s.sessionId, 15000)
      fs.writeFileSync(path.join(OUT, `shot-back-${beyond}-${BTAG}.png`), Buffer.from(r.data, 'base64'))
      out['back' + beyond] = { ok: true, ms: now() - t, bytes: r.data.length }
    } catch (e) { out['back' + beyond] = { ok: false, ms: now() - t, error: short(e) } }
  }
  out.backTab = { visibilityBefore: vis, log: (await E.evalMain(s, 'JSON.parse(JSON.stringify(window.__log))')) }
  await b.cdp.send('Target.closeTarget', { targetId: front.targetId })
  await sleep(1000)
  out.images = py(IMG, fs.readdirSync(OUT).filter((f) => f.startsWith('shot-') && f.endsWith(`-${BTAG}.png`)).map((f) => path.join(OUT, f)))
  // MHTML of the equivalence page, with fixed ports so the Electron run can be compared.
  const m = await E.newTab()
  await E.navigate(m, A + '/mhtml.html')
  await sleep(1000)
  try { const r = await b.cdp.send('Page.captureSnapshot', { format: 'mhtml' }, m.sessionId); fs.writeFileSync(path.join(OUT, `mhtml-${BTAG}.mhtml`), r.data); out.mhtml = { ok: true, chars: r.data.length } } catch (e) { out.mhtml = { ok: false, error: short(e) } }
  // PDF last, on the facts tab, after bringing it to the front.
  await b.cdp.send('Target.activateTarget', { targetId: s.targetId })
  await sleep(500)
  const beforePdf = serverLog.length
  try {
    const r = await b.cdp.send('Page.printToPDF', { printBackground: true }, s.sessionId, 30000)
    const f = path.join(OUT, `pdf-${BTAG}.pdf`)
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'))
    out.pdf = { ok: true, bytes: Buffer.from(r.data, 'base64').length, parsed: py(PDF, [f]) }
  } catch (e) { out.pdf = { ok: false, error: short(e) } }
  await sleep(500)
  out.pdfPage = { print: (await E.evalMain(s, 'JSON.parse(JSON.stringify(window.__log))')).print, mq: (await E.evalMain(s, 'window.__log.mq')), requestsDuringPdf: serverLog.slice(beforePdf).map((l) => l.url) }
  out.exit = await closeBrowser(b)
  return out
}

// P4: new tabs, popups, cross-site navigation, and bodies across it with and without durable messages.
CONFIGS.popups = async () => {
  const durable = VARIANT || 'none'
  const b = await launch()
  const E = await engine(b.cdp, { durable })
  const s = await E.tab()
  const out = { version: b.version, durable }
  await E.navigate(s, A + '/links.html')
  const opened = async (label, act, urlPart) => {
    const before = E.sessions.size
    await act()
    const t = await E.session((x) => x.n >= before && x.type === 'page', 8000)
    await E.idle()
    const doc = t && E.events.find((e) => e.s === t.n && e.m === 'Network.requestWillBeSent' && (e.url || '').includes(urlPart))
    return { label, attached: Boolean(t), waiting: t && t.waiting, opener: t && t.opener === s.targetId, documentOnOwnSession: Boolean(doc), firstRequestOnSession: t && (E.events.find((e) => e.s === t.n && e.m === 'Network.requestWillBeSent') || {}).url, onOpenerSession: E.events.some((e) => e.s === s.n && (e.url || '').includes(urlPart)), coverage: coverage(E, (u) => u.includes(urlPart)) }
  }
  out.newTabs = [
    await opened('target=_blank link', () => E.click(s, 'blank'), 'via=blank'),
    await opened('window.open', () => E.evalMain(s, "void window.open('/popup.html?via=open')", { userGesture: true }), 'via=open'),
    await opened('Target.createTarget', () => b.cdp.send('Target.createTarget', { url: A + '/popup.html?via=create' }), 'via=create')
  ]
  // Cross-site, renderer-initiated (link) and browser-initiated (Page.navigate).
  const xs = async (label, act, urlPart) => {
    const mark = E.events.length
    await act()
    await E.idle()
    await sleep(500)
    const ev = E.events.slice(mark)
    return { label, detached: ev.filter((e) => e.m === 'Target.detachedFromTarget').length, sameTarget: (await b.cdp.send('Target.getTargetInfo', { targetId: s.targetId }).catch(() => null)) !== null, sessionStillAttached: !s.detachedAt, documentOnSession: ev.some((e) => e.s === s.n && e.m === 'Network.requestWillBeSent' && (e.url || '').includes(urlPart)), subresourcesOnSession: ev.filter((e) => e.s === s.n && e.m === 'Network.requestWillBeSent').map((e) => e.url.replace(A, 'A').replace(B, 'B')), coverage: coverage(E, (u) => u.includes(urlPart) || u.includes('xs-end')) }
  }
  out.crossSite = [
    await xs('link click A to B', () => E.click(s, 'xs'), 'xs-end.html?via=link'),
    await xs('Page.navigate B to A', () => b.cdp.send('Page.navigate', { url: A + '/xs-same.html?via=navigate' }, s.sessionId), 'via=navigate')
  ]
  // Bodies after a navigation: fetch the previous document's bodies once the next one has loaded.
  out.bodies = []
  for (const [label, to] of [['cross-site', 'xs'], ['same-site', 'same']]) {
    const tag = label + '-' + durable
    await E.navigate(s, A + '/xs-start.html?' + tag)
    await sleep(500)
    const ids = E.events.filter((e) => e.s === s.n && e.m === 'Network.loadingFinished' && E.events.some((r) => r.id === e.id && r.m === 'Network.requestWillBeSent' && (r.url || '').includes(tag))).map((e) => e.id)
    const atLoad = []
    for (const id of ids) atLoad.push(await b.cdp.send('Network.getResponseBody', { requestId: id }, s.sessionId).then((r) => r.body.length, (e) => short(e)))
    await E.click(s, to)
    await E.idle()
    await sleep(1000)
    const afterNav = []
    for (const id of ids) afterNav.push(await b.cdp.send('Network.getResponseBody', { requestId: id }, s.sessionId).then((r) => r.body.length, (e) => short(e)))
    out.bodies.push({ label, requests: ids.length, atLoad, afterNav })
  }
  out.sessions = E.sessionList()
  out.exit = await closeBrowser(b)
  return out
}

// P4 follow-up: every way a page or the Operator opens a tab, with the setup awaited or pipelined.
CONFIGS.newtabs = async () => {
  const resume = VARIANT || 'await'
  const b = await launch()
  const E = await engine(b.cdp, { resume, enableTimeout: 15000 })
  const s = await E.tab()
  await E.navigate(s, A + '/newtabs.html')
  const out = { version: b.version, resume, runs: [] }
  const mouse = async (id, button, modifiers) => {
    const r = await E.evalMain(s, `(() => { const b = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: b.x + 5, y: b.y + 5 } })()`)
    for (const type of ['mousePressed', 'mouseReleased']) await b.cdp.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button, buttons: button === 'middle' ? 4 : 1, clickCount: 1, modifiers }, s.sessionId)
  }
  const actions = [
    ['target=_blank link', () => E.click(s, 'blank'), 'via=blank'],
    ['target=_blank rel=opener link', () => E.click(s, 'blank-opener'), 'via=blank-opener'],
    ['ctrl-click (Input domain)', () => mouse('ctrl', 'left', 2), 'via=ctrl-click'],
    ['middle-click (Input domain)', () => mouse('middle', 'middle', 0), 'via=middle-click'],
    ['window.open', () => E.evalMain(s, "void window.open('/popup.html?via=open')", { userGesture: true }), 'via=open'],
    ['window.open noopener', () => E.evalMain(s, "void window.open('/popup.html?via=open-noopener', '_blank', 'noopener')", { userGesture: true }), 'via=open-noopener'],
    ['Target.createTarget with URL', () => b.cdp.send('Target.createTarget', { url: A + '/popup.html?via=create' }), 'via=create'],
    ['Target.createTarget then Page.navigate', async () => { const t = await E.newTab(); await b.cdp.send('Page.navigate', { url: A + '/popup.html?via=create-navigate' }, t.sessionId) }, 'via=create-navigate']
  ]
  for (const [label, act, part] of actions) {
    const before = E.sessions.size
    await b.cdp.send('Target.activateTarget', { targetId: s.targetId })
    await sleep(300)
    await act()
    await sleep(17000 * (resume === 'await' ? 1 : 0) + 3000)
    await E.idle()
    const t = [...E.sessions.values()].find((x) => x.n >= before && x.type === 'page')
    const served = serverLog.filter((l) => l.url.includes(part)).length
    const reported = t ? E.events.filter((e) => e.s === t.n && e.m === 'Network.requestWillBeSent' && (e.url || '').includes(part)).length : 0
    const anywhere = E.events.filter((e) => (e.url || '').includes(part) && e.m.startsWith('Network.')).map((e) => e.s + ' ' + e.m)
    const firstOnTab = t && E.events.find((e) => e.s === t.n && e.m === 'Network.requestWillBeSent')
    out.runs.push({ label, attached: Boolean(t), waiting: t && t.waiting, opener: t && Boolean(t.opener), urlAtAttach: t && t.url.replace(A, 'A'), enableMs: t && t.enableMs, steps: t && t.steps, error: t && t.error, resumedAfterMs: t && t.resumedAt && t.resumedAt - t.attachedAt, served, reportedOnOwnSession: reported, reportedAnywhere: anywhere, firstRequestOnTab: firstOnTab && firstOnTab.url.replace(A, 'A') })
  }
  out.exit = await closeBrowser(b)
  return out
}

// P5: out-of-process iframes and workers.
CONFIGS.frames = async () => {
  const b = await launch()
  const E = await engine(b.cdp)
  const s = await E.tab()
  await E.navigate(s, A + '/frames.html')
  await sleep(2000)
  await E.idle()
  return { version: b.version, sessions: E.sessionList(), coverage: coverage(E, (u) => /from-|frame-|worker/.test(u)), exit: await closeBrowser(b) }
}

// P9: a page under a service worker.
CONFIGS.sw = async () => {
  const b = await launch()
  const E = await engine(b.cdp)
  const s = await E.tab()
  await E.navigate(s, A + '/sw/page.html?first')
  const first = await E.evalMain(s, 'window.__sw')
  await E.idle()
  const mark = E.events.length
  const logMark = serverLog.length
  await E.navigate(s, A + '/sw/page.html?second')
  const second = await E.evalMain(s, 'window.__sw')
  await E.idle()
  await sleep(500)
  const ev = E.events.slice(mark).filter((e) => e.m === 'Network.requestWillBeSent' || e.m === 'Network.responseReceived')
  const bodies = {}
  for (const e of ev.filter((x) => x.m === 'Network.responseReceived' && x.s === s.n)) bodies[e.id] = await b.cdp.send('Network.getResponseBody', { requestId: e.id }, s.sessionId).then((r) => r.body.length, (er) => short(er))
  return { version: b.version, first, second, coverage: coverage(E, (u) => u.startsWith('/sw/')), sessions: E.sessionList(), secondLoadEvents: ev.map((e) => ({ s: e.s, m: e.m, id: e.id, url: e.url && e.url.replace(A, 'A'), type: e.type, resp: e.resp })), bodies, serverDuringSecond: serverLog.slice(logMark).map((l) => l.url), exit: await closeBrowser(b) }
}

// P10: back-forward cache with and without the cache disabled, and speculative loads.
CONFIGS.bfcache = async () => {
  const out = { runs: [] }
  for (const cacheDisabled of [true, false]) {
    for (const to of ['same', 'xs']) {
      const b = await launch()
      const E = await engine(b.cdp, { cacheDisabled })
      const s = await E.tab()
      out.version = b.version
      await E.navigate(s, A + '/bf/a.html')
      await E.click(s, to)
      await E.idle()
      await sleep(500)
      const mark = E.events.length
      const logMark = serverLog.length
      await E.evalMain(s, 'history.back()')
      await sleep(2000)
      await E.idle()
      const page = await E.evalMain(s, '({ ps: window.__ps, type: performance.getEntriesByType("navigation")[0].type, nrr: JSON.stringify(performance.getEntriesByType("navigation")[0].notRestoredReasons || null).slice(0, 400) })')
      out.runs.push({ cacheDisabled, to, page, targetEventsAfterBack: E.events.slice(mark).filter((e) => e.target === s.targetId).map((e) => e.m + ' ' + (e.url || '').replace(A, 'A')), requestsOnTabAfterBack: E.events.slice(mark).filter((e) => e.s === s.n && e.m === 'Network.requestWillBeSent').map((e) => e.url.replace(A, 'A')), otherEvents: E.events.slice(mark).filter((e) => e.s === s.n).map((e) => e.m), serverAfterBack: serverLog.slice(logMark).map((l) => l.host + l.url) })
      await closeBrowser(b)
    }
  }
  return out
}
CONFIGS.speculation = async () => {
  const b = await launch()
  const E = await engine(b.cdp, { cacheDisabled: !VARIANT.includes('cache-on') })
  const s = await E.tab()
  if (VARIANT.includes('diag')) await b.cdp.send('Preload.enable', {}, s.sessionId)
  await E.navigate(s, A + '/spec/start.html')
  await sleep(4000)
  await E.idle()
  const out = { version: b.version }
  out.targetsAfterRules = (await b.cdp.send('Target.getTargets')).targetInfos.map((t) => ({ type: t.type, subtype: t.subtype, url: t.url.replace(A, 'A'), attached: t.attached }))
  out.sessionsAfterRules = E.sessionList()
  out.serverBeforeClick = serverLog.filter((l) => l.url.startsWith('/spec/')).map((l) => ({ url: l.url, purpose: l.purpose }))
  out.eventsBeforeClick = E.events.filter((e) => (e.url || '').includes('/spec/')).map((e) => ({ s: e.s, m: e.m, url: e.url.replace(A, 'A'), type: e.type, subtype: e.subtype, resp: e.resp }))
  for (const id of ['next']) {
    const mark = E.events.length
    const logMark = serverLog.length
    await E.click(s, id)
    await sleep(2000)
    await E.idle()
    out['after_' + id] = { events: E.events.slice(mark).map((e) => ({ s: e.s, m: e.m, url: e.url && e.url.replace(A, 'A'), type: e.type, subtype: e.subtype, target: e.target === s.targetId ? 'tab' : e.target ? 'other' : undefined, resp: e.resp })), server: serverLog.slice(logMark).map((l) => l.url) }
    out.activation = await E.evalMain(s, 'window.__act ? window.__act() : null').catch((e) => short(e))
  }
  out.tabSessionAfter = E.sessionList().filter((x) => x.type === 'page')
  out.preload = E.events.filter((e) => e.preload).map((e) => ({ m: e.m, ...e.preload, url: e.preload.url && e.preload.url.replace(A, 'A') }))
  // Prefetch: navigate the tab back to the start page, wait for the prefetch, then follow it.
  await E.navigate(s, A + '/spec/start.html?again=1')
  await sleep(3000)
  const mark = E.events.length
  const logMark = serverLog.length
  await E.click(s, 'pf')
  await sleep(2000)
  out.after_pf = { events: E.events.slice(mark).filter((e) => e.m.startsWith('Network.')).map((e) => ({ s: e.s, m: e.m, url: e.url && e.url.replace(A, 'A'), resp: e.resp })), server: serverLog.slice(logMark).map((l) => ({ url: l.url, purpose: l.purpose })) }
  out.exit = await closeBrowser(b)
  return out
}

// P11: order of events across a tab's CDP sessions for a causal chain page -> frame -> worker.
CONFIGS.order = async () => {
  const b = await launch()
  const E = await engine(b.cdp)
  const s = await E.tab()
  await E.navigate(s, A + '/order/page.html')
  await sleep(1000)
  const N = 50
  await E.evalMain(s, `window.__run(${N})`)
  await sleep(1000)
  const chain = []
  for (let i = 0; i < N; i++) for (const k of ['p', 'f', 'w']) chain.push(`/order/${k}?i=${i}`)
  const at = (m, u) => { const r = E.events.find((e) => e.m === 'Network.requestWillBeSent' && (e.url || '').endsWith(u)); if (!r) return null; if (m === 'Network.requestWillBeSent') return r; return E.events.find((e) => e.m === m && e.id === r.id && e.s === r.s) }
  const res = { version: b.version, steps: chain.length, sessionsBy: {}, serverOrderMatches: true, inversions: { rwsBeforePrevRws: 0, rwsBeforePrevResponse: 0, rwsBeforePrevFinished: 0 }, missing: 0 }
  const so = serverLog.filter((l) => l.url.startsWith('/order/') && l.url.includes('?i=')).map((l) => l.url)
  res.serverOrderMatches = JSON.stringify(so) === JSON.stringify(chain)
  for (let k = 0; k < chain.length; k++) {
    const rws = at('Network.requestWillBeSent', chain[k])
    if (!rws) { res.missing++; continue }
    res.sessionsBy[chain[k].split('?')[0]] = rws.s
    if (k === 0) continue
    const prev = at('Network.requestWillBeSent', chain[k - 1])
    const prevResp = at('Network.responseReceived', chain[k - 1])
    const prevFin = at('Network.loadingFinished', chain[k - 1])
    if (prev && rws.i < prev.i) res.inversions.rwsBeforePrevRws++
    if (prevResp && rws.i < prevResp.i) res.inversions.rwsBeforePrevResponse++
    if (prevFin && rws.i < prevFin.i) res.inversions.rwsBeforePrevFinished++
  }
  res.sessions = E.sessionList()
  res.exit = await closeBrowser(b)
  return res
}

// P12: what fetching every body costs the client process, and what survives to Capture time.
CONFIGS.bodies = async () => {
  const mode = opt('mode', 'eager') // none | eager | capture
  const durable = opt('durable', 'none') // none | enable | configure
  const sites = opt('sites', 'cross') // cross | same
  const fetched = { ok: 0, failed: 0, bytes: 0, ms: 0, errors: {}, mismatch: 0, mismatches: [] }
  let b
  const fetchBody = async (s, id, url) => {
    const t = performance.now()
    try {
      const r = await b.cdp.send('Network.getResponseBody', { requestId: id }, s.sessionId, 60000)
      const buf = Buffer.from(r.body, r.base64Encoded ? 'base64' : 'utf8')
      fetched.ok++; fetched.bytes += buf.length
      const want = url.includes('/load/r/') ? loadBody(url.replace(/^http:\/\/[^/]+/, ''), Number(new URL(url).searchParams.get('size'))) : null
      if (want && !buf.equals(want)) {
        fetched.mismatch++
        let at = 0
        while (at < Math.min(buf.length, want.length) && buf[at] === want[at]) at++
        // Is the body returned the payload of another request this run fetched?
        const other = [...urlOf.values()].find((u) => u.includes('/load/r/') && u !== url && loadBody(u.replace(/^http:\/\/[^/]+/, ''), Number(new URL(u).searchParams.get('size'))).equals(buf))
        fetched.mismatches.push({ url: url.replace(/^http:\/\/[^/]+/, ''), expectedBytes: want.length, gotBytes: buf.length, firstDifferenceAt: at, bodyOfAnotherRequest: other ? other.replace(/^http:\/\/[^/]+/, '') : null })
      }
      return true
    } catch (e) { fetched.failed++; const k = short(e).slice(0, 80); fetched.errors[k] = (fetched.errors[k] || 0) + 1; return false } finally { fetched.ms += performance.now() - t }
  }
  const urlOf = new Map()
  b = await launch()
  const E = await engine(b.cdp, { durable, onFinished: mode === 'eager' ? (s, p) => { if (s) fetchBody(s, p.requestId, urlOf.get(p.requestId) || '') } : null })
  b.cdp.handlers.unshift((m) => { if (m.method === 'Network.requestWillBeSent') urlOf.set(m.params.requestId, m.params.request.url) })
  const s = await E.tab()
  const eld = monitorEventLoopDelay({ resolution: 10 }); eld.enable()
  const cpu0 = process.cpuUsage(); const t0 = now(); const bytes0 = b.cdp.bytesIn; const msgs0 = b.cdp.msgsIn
  const perPage = []
  for (let n = 0; n < 15; n++) {
    const origin = sites === 'cross' && n % 2 ? B : A
    const mark = E.events.length
    await b.cdp.send('Page.navigate', { url: `${origin}/load/${n}.html` }, s.sessionId)
    await sleep(300)
    await E.evalMain(s, 'window.__done.then(() => true)').catch(() => false)
    await E.idle(500, 60000)
    if (mode === 'capture') {
      const ids = E.events.slice(mark).filter((e) => e.s === s.n && e.m === 'Network.loadingFinished').map((e) => e.id)
      const before = fetched.ok
      for (const id of ids) await fetchBody(s, id, urlOf.get(id) || '')
      perPage.push({ n, finished: ids.length, fetched: fetched.ok - before })
    }
  }
  while (b.cdp.pending.size) await sleep(50)
  const cpu = process.cpuUsage(cpu0); eld.disable()
  const out = { version: b.version, mode, durable, sites, electronMain: ELECTRON_MAIN, browsingMs: now() - t0, cpuMs: { user: Math.round(cpu.user / 1000), system: Math.round(cpu.system / 1000) }, eventLoopDelayMs: { p50: eld.percentile(50) / 1e6, p99: eld.percentile(99) / 1e6, max: eld.max / 1e6 }, pipe: { bytes: b.cdp.bytesIn - bytes0, messages: b.cdp.msgsIn - msgs0 }, served: serverLog.filter((l) => l.url.startsWith('/load/r/')).length, fetched, perPage }
  if (mode === 'capture') {
    // Retention: try every body of every page again at the end.
    const all = E.events.filter((e) => e.s === s.n && e.m === 'Network.loadingFinished').map((e) => e.id)
    const keep = { ok: 0, failed: 0 }
    for (const id of all) (await b.cdp.send('Network.getResponseBody', { requestId: id }, s.sessionId, 60000).then(() => true, () => false)) ? keep.ok++ : keep.failed++
    out.retainedAtEnd = keep
  }
  out.exit = await closeBrowser(b)
  return out
}

// P8: what happens to the browser when the pipe's other end goes away.
CONFIGS['p8-holder'] = async () => {
  const b = await launch()
  fs.writeFileSync(path.join(OUT, 'p8-holder.json'), JSON.stringify({ pid: b.child.pid, profile: b.profile }))
  if (VARIANT === 'exit') { await sleep(1500); process.exit(0) }
  if (VARIANT === 'close-pipe') { await sleep(1500); b.child.stdio[3].destroy(); b.child.stdio[4].destroy(); await sleep(20000); return { stillHere: true } }
  await sleep(60000)
  return {}
}
CONFIGS.p8 = async () => {
  const out = { runs: [] }
  for (const v of ['kill', 'exit', 'close-pipe']) {
    try { fs.rmSync(path.join(OUT, 'p8-holder.json')) } catch {}
    const holder = spawn(process.execPath, [SCRIPT, 'p8-holder', `--probe-variant=${v}`, `--probe-browser=${BROWSER}`, ...(has('guard') ? ['--probe-guard'] : [])], { stdio: 'ignore', env: process.env })
    let info
    for (let i = 0; i < 200 && !info; i++) { try { info = JSON.parse(fs.readFileSync(path.join(OUT, 'p8-holder.json'), 'utf8')) } catch { await sleep(100) } }
    await sleep(1000)
    if (v === 'kill') holder.kill('SIGKILL')
    const t = now()
    const holderGone = new Promise((r) => holder.on('exit', () => r(now() - t)))
    let goneAfter = null
    for (let i = 0; i < 200; i++) { if (!alive(info.pid)) { goneAfter = now() - t; break } await sleep(100) }
    const left = procs(info.profile).filter((p) => p.state !== 'Z')
    out.runs.push({ variant: v, browserExitedAfterMs: goneAfter, holderExitedAfterMs: await Promise.race([holderGone, sleep(100).then(() => 'still running')]), processesLeft: left.length })
    for (const p of left) try { process.kill(p.pid, 'SIGKILL') } catch {}
    holder.kill('SIGKILL')
  }
  // A restart from inside the browser: chrome://restart typed into the address bar.
  const b = await launch()
  const E = await engine(b.cdp)
  const s = await E.tab()
  await E.navigate(s, A + '/popup.html?before-restart=1')
  const pid0 = b.child.pid
  const t = now()
  await sleep(4000) // Chrome 150 here shows a "Can't update Chrome" bubble that takes the keyboard; Escape closes it
  const keys = ['Escape', 'click:500,500', 'Control_L+l', ...'chrome'.split(''), 'Shift_L+semicolon', 'slash', 'slash', ...'restart'.split(''), 'Return']
  const navP = Promise.resolve(xkeys(...keys))
  const typedAt = now()
  const seen = new Map()
  while (now() - typedAt < 6000) {
    for (const d of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
      let c; try { c = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').replace(/\0/g, ' ') } catch { continue }
      if (c.includes(b.profile) && !seen.has(d)) seen.set(d, { firstSeenMs: now() - typedAt, type: (/--type=(\S+)/.exec(c) || [null, 'browser'])[1], pipe: c.includes('--remote-debugging-pipe') })
    }
    await sleep(25)
  }
  out.processesSeenAfterTyping = [...seen.entries()].filter(([pid]) => Number(pid) !== pid0).map(([, v]) => v)
  const snap = []
  for (const at of [2000, 6000, 12000]) {
    await sleep(Math.max(0, at - (now() - typedAt)))
    const all = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).filter((d) => { try { return fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').includes(b.profile) } catch { return false } })
    snap.push({ afterTypingMs: at, originalAlive: alive(pid0), pipeClosedAfterTypingMs: b.cdp.closedAt === null ? null : b.cdp.closedAt - typedAt, browsers: procs(b.profile).filter((p) => p.type === 'browser' && p.state !== 'Z'), anyProcessNamingProfile: all.length })
  }
  out.restartScreenshot = xshot(`restart-${BTAG}`)
  out.restart = { typed: await navP, snapshots: snap, exit: await Promise.race([b.exited, sleep(100).then(() => null)]) }
  for (const p of procs(b.profile)) try { process.kill(p.pid, 'SIGKILL') } catch {}
  return out
}

// P14: seeding launch with --no-startup-window, Storage.setCookies, Browser.close, restart, singleton.
CONFIGS.seed = async () => {
  const out = {}
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'p1828-seed-'))
  const t = now()
  const s1 = await launch({ profile, args: ['--no-startup-window'], startUrl: null })
  out.seedLaunch = { readyMs: s1.readyAt - t, version: s1.version.product, targets: (await s1.cdp.send('Target.getTargets')).targetInfos.map((x) => x.type + ' ' + x.url) }
  out.screenshot = xshot(`seed-no-window-${BTAG}`)
  await sleep(3000)
  out.seedAliveAfter3s = alive(s1.child.pid)
  const url = A + '/'
  const exp = Math.floor(Date.now() / 1000) + 86400
  out.setCookies = await s1.cdp.send('Storage.setCookies', { cookies: [
    { name: 'fixture_persist', value: 'invented-1', url, expires: exp },
    { name: 'fixture_session', value: 'invented-2', url },
    { name: 'fixture_lax', value: 'invented-3', url, expires: exp, sameSite: 'Lax' }
  ] }).then(() => 'ok', (e) => short(e))
  const tc = now()
  out.closeResult = await closeBrowser(s1)
  out.closeMs = now() - tc
  out.cookiesOnDisk = await cookieRows(profile)
  // Restart on the same profile: which cookies does a fixture see?
  const s2 = await launch({ profile })
  const E = await engine(s2.cdp)
  const tab = await E.tab()
  await E.navigate(tab, A + '/cookies')
  out.afterRestartCookieNames = serverLog.filter((l) => l.url === '/cookies').map((l) => l.cookieNames)
  // A second seeding launch while the first browser still holds the profile.
  const mark = E.events.length
  const t3 = now()
  const third = spawn(EXE, ['--user-data-dir=' + profile, '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-sync', '--no-startup-window', '--enable-logging=stderr', ...(has('guard') ? ['--proxy-server=socks5://127.0.0.1:' + SOCKS_PORT] : [])], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
  let err3 = ''
  third.stderr.on('data', (d) => { err3 += d })
  const thirdExit = new Promise((r) => third.on('exit', (code, signal) => r({ code, signal, ms: now() - t3 })))
  const c3 = pipeClient(third.stdio[3], third.stdio[4])
  const ans = await c3.send('Browser.getVersion', {}, undefined, 8000).then((r) => r.product, (e) => short(e))
  const ex3 = await Promise.race([thirdExit, sleep(30000).then(() => 'still running after 38 s')])
  await sleep(1500)
  const thirdProc = (() => { try { return { cmd: fs.readFileSync(`/proc/${third.pid}/cmdline`, 'utf8').replace(/\0/g, ' ').replace(profile, '<profile>').slice(0, 160), state: fs.readFileSync(`/proc/${third.pid}/stat`, 'utf8').split(') ')[1][0], wchan: fs.readFileSync(`/proc/${third.pid}/wchan`, 'utf8'), children: fs.readFileSync(`/proc/${third.pid}/task/${third.pid}/children`, 'utf8').trim() } } catch (e) { return short(e) } })()
  out.singleton = { secondLaunchAnswered: ans, secondLaunchExit: ex3, thirdProc, secondProcesses: procs(profile).filter((p) => p.pid !== s2.child.pid && p.type === 'browser').length, stderrTail: err3.trim().split('\n').slice(-6).map((l) => l.slice(0, 200)), firstBrowserEvents: E.events.slice(mark).filter((e) => e.m.startsWith('Target.')).map((e) => e.m + ' ' + (e.type || '') + ' ' + (e.url || '')) }
  if (typeof ex3 === 'string') third.kill('SIGKILL')
  out.exit = await closeBrowser(s2)
  return out
}

// P15: a password-saving preference written before the first launch.
CONFIGS.prefs = async () => {
  const pre = VARIANT !== 'control'
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'p1828-prefs-'))
  if (pre) { fs.mkdirSync(path.join(profile, 'Default')); fs.writeFileSync(path.join(profile, 'Default/Preferences'), JSON.stringify({ credentials_enable_service: false })) }
  const b = await launch({ profile })
  const E = await engine(b.cdp)
  const s = await E.tab()
  const out = { version: b.version, preWritten: pre }
  const p = await E.newTab()
  await E.navigate(p, 'chrome://prefs-internals').catch(() => {})
  await sleep(1000)
  const txt = await E.evalMain(p, 'document.body ? document.body.innerText : ""').catch((e) => 'error ' + short(e))
  const at = txt.indexOf('"credentials_enable_service"')
  const block = at >= 0 ? txt.slice(at, at + 300).replace(/\s+/g, ' ') : ''
  out.liveValue = at >= 0 ? { value: (/"value": (true|false)/.exec(block) || [null, 'not shown'])[1], metadata: (/"metadata": \[([^\]]*)\]/.exec(block) || [null, ''])[1].trim() } : 'absent from prefs-internals'
  await b.cdp.send('Target.closeTarget', { targetId: p.targetId })
  await b.cdp.send('Target.activateTarget', { targetId: s.targetId })
  await E.navigate(s, A + '/login.html')
  await E.evalMain(s, "document.getElementById('u').focus()")
  await b.cdp.send('Input.insertText', { text: 'fixture-user' }, s.sessionId)
  await E.evalMain(s, "document.getElementById('p').focus()")
  await b.cdp.send('Input.insertText', { text: 'invented-password' }, s.sessionId)
  for (const type of ['keyDown', 'keyUp']) await b.cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined }, s.sessionId)
  await sleep(3000)
  out.afterSubmitUrl = (await b.cdp.send('Target.getTargetInfo', { targetId: s.targetId })).targetInfo.url.replace(A, 'A')
  out.screenshot = xshot(`prefs-${pre ? 'prewritten' : 'control'}-${BTAG}`)
  out.exit = await closeBrowser(b)
  const prefs = JSON.parse(fs.readFileSync(path.join(profile, 'Default/Preferences'), 'utf8'))
  out.fileValue = prefs.credentials_enable_service
  out.resetMarkers = Object.keys(prefs.prefs || {}).concat(Object.keys(prefs.profile || {})).filter((k) => /reset/i.test(k))
  return out
}

// P16 (browser side): which key store protects the cookie a fixture sets.
CONFIGS.keystore = async () => {
  const b = await launch({ args: ['--enable-logging=stderr', '--v=1'] })
  const E = await engine(b.cdp)
  const s = await E.tab()
  await E.navigate(s, A + '/setcookie')
  await sleep(1000)
  const out = { version: b.version, env: { XDG_CURRENT_DESKTOP: process.env.XDG_CURRENT_DESKTOP || null, DESKTOP_SESSION: process.env.DESKTOP_SESSION || null, bus: process.env.DBUS_SESSION_BUS_ADDRESS ? 'set' : 'unset' } }
  out.exit = await closeBrowser(b, 20000)
  out.cookies = await cookieRows(b.profile)
  out.log = b.stderr().split('\n').filter((l) => /os_crypt|OSCrypt|key_storage|password.?stor|libsecret|kwallet|keyring|Safe Storage|basic/i.test(l)).map((l) => l.replace(/^\[[^\]]*\]/, '').slice(0, 220)).slice(0, 25)
  out.localStateOsCrypt = (() => { try { return Object.keys(JSON.parse(fs.readFileSync(path.join(b.profile, 'Local State'), 'utf8')).os_crypt || {}) } catch { return null } })()
  return out
}

// P6: WebRTC candidates per switch, from a loaded page and from an isolated world on about:blank.
CONFIGS.webrtc = async () => {
  const args = { none: [], policy: ['--webrtc-ip-handling-policy=disable_non_proxied_udp'], force: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] }[VARIANT || 'none']
  const b = await launch({ args })
  const E = await engine(b.cdp)
  const s = await E.tab()
  const out = { version: b.version, variant: VARIANT || 'none', args }
  out.isolatedOnBlank = iceShape(await E.evalIso(s, ICE))
  await E.navigate(s, A + '/webrtc.html')
  out.mainOnPage = iceShape(await E.evalMain(s, ICE))
  out.isolatedOnPage = iceShape(await E.evalIso(s, ICE))
  out.exit = await closeBrowser(b)
  out.proxyLog = proxyLog.filter((l) => !l.allowed).map((l) => l.host + ':' + l.port)
  return out
}

// P13: a net log of the browser's own traffic and of a page that names outside hosts.
CONFIGS.egress = async () => {
  const v = VARIANT || 'socks'
  const netlog = path.join(OUT, `netlog-${v}-${BTAG}.json`)
  const args = ['--log-net-log=' + netlog]
  if (v === 'socks') args.push('--proxy-server=socks5://127.0.0.1:' + SOCKS_PORT, '--proxy-bypass-list=<-loopback>', '--webrtc-ip-handling-policy=disable_non_proxied_udp')
  if (v === 'http') args.push('--proxy-server=http://127.0.0.1:' + HTTP_PROXY_PORT, '--proxy-bypass-list=<-loopback>', '--webrtc-ip-handling-policy=disable_non_proxied_udp')
  const b = await launch({ args, guard: false })
  const E = await engine(b.cdp)
  const s = await E.tab()
  const idleMs = Number(opt('idle', '120000'))
  await sleep(idleMs)
  await E.navigate(s, A + '/egress.html')
  await sleep(5000)
  const out = { version: b.version, variant: v, idleMs, netns: fs.readlinkSync('/proc/self/ns/net'), interfaces: Object.keys(os.networkInterfaces()), onLine: await E.evalMain(s, 'navigator.onLine') }
  const urlOf = new Map(E.events.filter((e) => e.m === 'Network.requestWillBeSent').map((e) => [e.s + ':' + e.id, e.url]))
  out.remoteEndpoints = [...new Set(E.events.filter((e) => e.m === 'Network.responseReceived' && e.resp).map((e) => `${e.resp.ip}:${e.resp.port} for ${new URL(urlOf.get(e.s + ':' + e.id) || 'http://unknown/').host}`))]
  out.screenshot = xshot(`egress-${v}-${BTAG}`)
  out.rendererSeccomp = procs(b.profile).filter((p) => p.type === 'renderer').map((p) => { try { return /Seccomp:\s*(\d)/.exec(fs.readFileSync(`/proc/${p.pid}/status`, 'utf8'))[1] } catch { return '?' } })
  out.exit = await closeBrowser(b, 20000)
  out.proxyLog = proxyLog.map((l) => `${l.kind} ${l.host}:${l.port} ${l.allowed ? 'forwarded' : 'refused'}`)
  out.netlog = summarizeNetLog(netlog)
  return out
}
function summarizeNetLog(file) {
  let text = fs.readFileSync(file, 'utf8').trim()
  let log
  try { log = JSON.parse(text) } catch { text = text.replace(/,\s*$/, ''); log = JSON.parse(text + ']}') }
  const names = Object.fromEntries(Object.entries(log.constants.logEventTypes).map(([k, v]) => [v, k]))
  const pick = {}
  const add = (k, v) => { (pick[k] = pick[k] || new Set()).add(v) }
  const udpBySource = new Map()
  for (const e of log.events) {
    const n = names[e.type]
    const p = e.params || {}
    if (n === 'UDP_CONNECT' && p.address) udpBySource.set(e.source.id, p.address)
    if (n === 'UDP_BYTES_SENT' && udpBySource.has(e.source.id)) add('udpBytesSentTo', udpBySource.get(e.source.id))
    if (/CONNECT/.test(n) && p.address) add('connect:' + n, p.address)
    if (/HOST_RESOLVER/.test(n) && p.host) add('resolve:' + n, p.host)
    if (n === 'URL_REQUEST_START_JOB' && p.url) add('urlRequests', p.url.replace(/^(\w+:\/\/[^/]+).*/, '$1'))
    if (/QUIC_SESSION$/.test(n) && p.host) add('quicSessions', p.host)
    if (n === 'SOCKS5_CONNECT' || n === 'SOCKS_CONNECT') add('socksConnects', JSON.stringify(p))
  }
  return { events: log.events.length, ...Object.fromEntries(Object.entries(pick).map(([k, v]) => [k, [...v].sort()])) }
}

// P13 helper: a DNS listener on 127.0.0.1:53 inside the namespace, which answers every query
// with NXDOMAIN and logs the name. Run as the namespace's root, beside the egress run.
CONFIGS.dnslog = async () => {
  const dgram = await import('node:dgram')
  const queries = []
  const sock = dgram.createSocket('udp4')
  sock.on('message', (msg, rinfo) => {
    let off = 12
    const labels = []
    while (msg[off]) { labels.push(msg.subarray(off + 1, off + 1 + msg[off]).toString()); off += msg[off] + 1 }
    queries.push({ t: now(), name: labels.join('.'), qtype: msg.readUInt16BE(off + 1) })
    const r = Buffer.from(msg.subarray(0, off + 5))
    r[2] = 0x80 | (msg[2] & 0x01); r[3] = 0x83; r.writeUInt16BE(0, 6); r.writeUInt16BE(0, 8); r.writeUInt16BE(0, 10)
    sock.send(r, rinfo.port, rinfo.address)
  })
  await new Promise((r) => sock.bind(53, '127.0.0.1', r))
  await sleep(Number(opt('duration', '200000')))
  sock.close()
  return { queries }
}

// P20: install locations on this host. Launches nothing.
CONFIGS.discover = async () => {
  // Linux paths from playwright-core 1.63.0 lib/coreBundle.js:33222-33256, then PATH names.
  const table = ['/opt/google/chrome/chrome', '/opt/google/chrome-beta/chrome', '/opt/google/chrome-unstable/chrome', '/opt/google/chrome-canary/chrome', '/opt/microsoft/msedge/msedge', '/opt/microsoft/msedge-beta/msedge', '/opt/microsoft/msedge-dev/msedge']
  const names = ['google-chrome', 'google-chrome-stable', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser', 'brave', 'chromium', 'chromium-browser']
  const dirs = (process.env.PATH || '').split(':')
  const onPath = Object.fromEntries(names.map((n) => [n, (dirs.map((d) => path.join(d, n)).find((f) => fs.existsSync(f)) || null)]))
  const snap = spawnSync('snap', ['list'], { encoding: 'utf8' })
  const flatpak = spawnSync('flatpak', ['list', '--app'], { encoding: 'utf8' })
  return {
    table: Object.fromEntries(table.map((f) => [f, fs.existsSync(f)])),
    onPath: Object.fromEntries(Object.entries(onPath).map(([k, v]) => [k, v && { path: v, real: fs.realpathSync(v) }])),
    snapBrowsers: snap.status === 0 ? snap.stdout.split('\n').filter((l) => /chrom|brave|edge/i.test(l)) : 'snap failed: ' + (snap.error ? snap.error.code : snap.status),
    flatpak: flatpak.error ? 'flatpak not installed: ' + flatpak.error.code : flatpak.stdout.split('\n').filter((l) => /chrom|brave|edge/i.test(l)),
    playwrightCache: fs.readdirSync(path.join(os.homedir(), '.cache/ms-playwright')).filter((d) => d.startsWith('chromium'))
  }
}

// P18: the Operator opens DevTools on a recorded tab.
CONFIGS.devtools = async () => {
  const b = await launch()
  const E = await engine(b.cdp)
  const s = await E.tab()
  await E.navigate(s, A + '/facts.html?devtools=1')
  const mark = E.events.length
  const out = { version: b.version }
  if (VARIANT === 'keyboard') { await sleep(4000); out.open = 'F12 through XTest: ' + xkeys('Escape', 'click:300,500', 'F12') }
  else out.open = await b.cdp.send('Target.openDevTools', { targetId: s.targetId }).then((r) => r && 'Target.openDevTools answered', (e) => short(e))
  await sleep(4000)
  out.screenshot = xshot(`devtools-${BTAG}-${VARIANT || 'cdp'}`)
  out.eventsOnOpen = E.events.slice(mark).filter((e) => e.m.startsWith('Target.') || e.m.startsWith('Inspector.')).map((e) => ({ m: e.m, type: e.type, url: e.url && e.url.slice(0, 60), s: e.s }))
  const m2 = E.events.length
  await E.navigate(s, A + '/facts.html?after-devtools=1')
  out.afterNavigate = { sessionDetached: Boolean(s.detachedAt), documentOnSession: E.events.slice(m2).some((e) => e.s === s.n && e.m === 'Network.requestWillBeSent' && (e.url || '').includes('after-devtools')), eventsOnSession: E.events.slice(m2).filter((e) => e.s === s.n).length }
  out.evaluateStillWorks = await E.evalMain(s, 'location.search').catch((e) => short(e))
  out.sessions = E.sessionList()
  out.exit = await closeBrowser(b)
  return out
}

// ---------- Electron main-process configurations ----------
CONFIGS.safestorage = async ({ electron }) => {
  const { app, safeStorage } = electron
  await app.whenReady()
  const out = { electron: process.versions.electron, env: { XDG_CURRENT_DESKTOP: process.env.XDG_CURRENT_DESKTOP || null, bus: process.env.DBUS_SESSION_BUS_ADDRESS ? 'set' : 'unset' } }
  out.isEncryptionAvailable = safeStorage.isEncryptionAvailable()
  out.backend = safeStorage.getSelectedStorageBackend()
  try { out.prefix = safeStorage.encryptString('invented fixture').subarray(0, 3).toString('latin1') } catch (e) { out.prefix = 'error ' + short(e) }
  return out
}
CONFIGS.shortcut = async ({ electron }) => {
  const { app, globalShortcut } = electron
  await app.whenReady()
  const fired = []
  const accel = 'CommandOrControl+Shift+F9'
  const out = { electron: process.versions.electron, display: process.env.DISPLAY, session: process.env.XDG_SESSION_TYPE || null, desktop: process.env.XDG_CURRENT_DESKTOP || null }
  out.registered = globalShortcut.register(accel, () => fired.push(now()))
  out.isRegistered = globalShortcut.isRegistered(accel)
  const b = await launch()
  const E = await engine(b.cdp)
  const s = await E.tab()
  await E.navigate(s, A + '/keys.html')
  await sleep(1500)
  out.xtest = xkeys('click:640,400', 'a', 'Control_L+Shift_L+F9', 'b')
  await sleep(1000)
  out.firedCount = fired.length
  out.pageKeys = await E.evalMain(s, 'window.__keys')
  out.chrome = b.version.product
  out.exit = await closeBrowser(b)
  globalShortcut.unregisterAll()
  return out
}
CONFIGS['electron-ws'] = async ({ electron }) => {
  if (electron) await electron.app.whenReady()
  const out = { electron: process.versions.electron, electronMain: ELECTRON_MAIN, typeofWebSocket: typeof WebSocket }
  const b = await launch({ pipe: false, port: 9335 })
  out.portModeProduct = b.version.product
  out.exit = await closeBrowser(b)
  return out
}
CONFIGS['electron-mhtml'] = async ({ electron }) => {
  const { app, BrowserWindow } = electron
  await app.whenReady()
  // Configured like renderPageInHiddenWindow (backgroundRenderer.ts:385-397), without the consent filter.
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'recapture-probe-' + Date.now(), backgroundThrottling: false, offscreen: true } })
  const wc = win.webContents
  await wc.loadURL(A + '/mhtml.html')
  await sleep(1500)
  const f1 = path.join(OUT, 'mhtml-electron-savePage.mhtml')
  await wc.savePage(f1, 'MHTML')
  const out = { electron: process.versions.electron, chrome: process.versions.chrome, savePageBytes: fs.statSync(f1).size }
  wc.debugger.attach('1.3')
  try { const r = await wc.debugger.sendCommand('Page.captureSnapshot', { format: 'mhtml' }); fs.writeFileSync(path.join(OUT, 'mhtml-electron-cdp.mhtml'), r.data); out.cdpSnapshot = { ok: true, chars: r.data.length } } catch (e) { out.cdpSnapshot = { ok: false, error: short(e) } }
  win.destroy()
  return out
}
// P24: compare MHTML parts by Content-Location, type, encoding, and decoded digest.
CONFIGS['mhtml-compare'] = async () => {
  const parse = (f) => {
    const text = fs.readFileSync(f, 'latin1')
    const boundary = /boundary="?([^";\r\n]+)"?/i.exec(text)[1]
    const head = text.split(/\r?\n\r?\n/)[0]
    const parts = text.split('--' + boundary).slice(1, -1).map((p) => {
      const [h, ...rest] = p.replace(/^\r?\n/, '').split(/\r?\n\r?\n/)
      const hdr = Object.fromEntries(h.split(/\r?\n(?=\S)/).map((l) => [l.split(':')[0].toLowerCase(), l.slice(l.indexOf(':') + 1).replace(/\r?\n\s+/g, ' ').trim()]))
      let body = rest.join('\r\n\r\n')
      const enc = (hdr['content-transfer-encoding'] || '').toLowerCase()
      let buf = enc === 'base64' ? Buffer.from(body.replace(/\s+/g, ''), 'base64') : enc === 'quoted-printable' ? Buffer.from(body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, x) => String.fromCharCode(parseInt(x, 16))).replace(/\r?\n$/, ''), 'latin1') : Buffer.from(body, 'latin1')
      // Frame parts are named by a per-load frame token; compare with the token masked.
      const masked = Buffer.from(buf.toString('latin1').replace(/cid:frame-[0-9A-F]+@mhtml\.blink/g, 'cid:frame-X'), 'latin1')
      return { location: (hdr['content-location'] || '').replace(A, 'A').replace(B, 'B'), type: (hdr['content-type'] || '').split(';')[0], encoding: enc, id: hdr['content-id'] ? 'yes' : 'no', digest: sha(masked), rawDigest: sha(buf), bytes: buf.length }
    })
    return { headerNames: head.split(/\r?\n/).map((l) => l.split(':')[0]).filter((x) => /^[A-Za-z-]+$/.test(x)), parts }
  }
  const files = ['mhtml-electron-savePage.mhtml', 'mhtml-electron-cdp.mhtml', 'mhtml-chrome.mhtml', 'mhtml-cft.mhtml', 'mhtml-cft-nofieldtrial.mhtml'].filter((f) => fs.existsSync(path.join(OUT, f)))
  const parsed = Object.fromEntries(files.map((f) => [f, parse(path.join(OUT, f))]))
  const ref = parsed[files[0]]
  const cmp = {}
  for (const f of files.slice(1)) {
    const o = parsed[f]
    cmp[f + ' vs ' + files[0]] = {
      sameHeaderNames: JSON.stringify(o.headerNames) === JSON.stringify(ref.headerNames),
      sameLocations: JSON.stringify(o.parts.map((p) => p.location)) === JSON.stringify(ref.parts.map((p) => p.location)),
      differingParts: ref.parts.map((p) => { const q = o.parts.find((x) => x.location === p.location); return !q ? { location: p.location, missing: true } : q.digest !== p.digest || q.type !== p.type || q.encoding !== p.encoding ? { location: p.location, type: [p.type, q.type], encoding: [p.encoding, q.encoding], bytes: [p.bytes, q.bytes] } : null }).filter(Boolean),
      extraParts: o.parts.filter((q) => !ref.parts.some((p) => p.location === q.location)).map((q) => q.location)
    }
  }
  return { files, parsed, cmp }
}

// ---------- entry ----------
async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  let electron = null
  if (ELECTRON_MAIN) {
    electron = await import('electron')
    if (CONFIG === 'electron-mhtml') { electron.app.commandLine.appendSwitch('no-sandbox'); electron.app.commandLine.appendSwitch('disable-dev-shm-usage') }
    electron.app.on('window-all-closed', () => {})
  }
  const exit = (code) => { for (const l of launched) { try { l.child.kill('SIGKILL') } catch {} for (const p of procs(l.profile)) { try { process.kill(p.pid, 'SIGKILL') } catch {} } } electron ? electron.app.exit(code) : process.exit(code) }
  setTimeout(() => { console.error('probe timeout'); exit(2) }, Number(opt('timeout', '300000')))
  await startServers()
  await startSocks()
  await startHttpProxy()
  if (!CONFIGS[CONFIG]) { console.error('unknown config', CONFIG, Object.keys(CONFIGS).join(' ')); exit(1); return }
  const result = await CONFIGS[CONFIG]({ electron })
  const browserless = ['safestorage', 'electron-mhtml', 'mhtml-compare', 'discover'].includes(CONFIG)
  const name = [CONFIG, ELECTRON_MAIN && ['bodies', 'electron-ws'].includes(CONFIG) ? 'main' : null, browserless ? null : BROWSER, VARIANT || null, opt('mode', null), opt('durable', null), opt('sites', null), opt('resume', null), opt('tag', null)].filter(Boolean).join('-')
  fs.writeFileSync(path.join(OUT, `result-${name}.json`), JSON.stringify({ config: CONFIG, argv: ARGS, ...result, guardProxyLog: CONFIG === 'egress' ? undefined : proxyLog.map((l) => `${l.host}:${l.port} ${l.allowed ? 'forwarded' : 'refused'}`) }, null, 2))
  console.log('wrote', `result-${name}.json`)
  exit(0)
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1) })
```

`bus.conf`, a session bus with no service activation, for P16's GNOME sessions:

```xml
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:tmpdir=/tmp</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
```

`resolv.conf`, which points P13's namespace at the DNS listener:

```text
nameserver 127.0.0.1
```

The batch, as it ran. `batch.out` holds one `exit <code> <command>` line per run, for the pull
request body. The P12 `bodies` commands ran a second time, unchanged, after the script
began recording mismatch details (`fetched.mismatches`); P12 reports that second run. The script's
last edit landed during P13's Direct run on Chrome: the five P13 runs after that one ran on the
script below, and the earlier configurations on a copy without those lines, which only `bodies`
uses.

```shell
#!/usr/bin/env bash
# Every configuration the spike reports. Run from the repository root. S holds probe.mjs,
# bus.conf, and resolv.conf; results land in $S/out. Each line of $S/batch.out is
# "exit <code> <command>".
S=/tmp/p1828
E=node_modules/.bin/electron
P=$S/probe.mjs
U=$(id -u); G=$(id -g)
mkdir -p $S/out
: > $S/batch.out
run() { bash -c "$1" > "$S/logs/$(echo "$1" | md5sum | cut -c1-10).log" 2>&1; echo "exit $? $1" | tee -a $S/batch.out; }
mkdir -p $S/logs
N="ELECTRON_RUN_AS_NODE=1 xvfb-run --auto-servernum $E $P"
M="xvfb-run --auto-servernum $E --no-sandbox $P"
X="--probe-guard --probe-resume=pipeline"

# Launched-browser configurations, outside any namespace, browser traffic sent to the refusing proxy.
for b in chrome cft; do
  run "$N pipe $X --probe-browser=$b"
  run "$N page-reads $X --probe-browser=$b"
  run "PROBE_PORT_A=18281 PROBE_PORT_B=18282 $N artifacts $X --probe-browser=$b"
  for d in none enable configure; do run "$N popups $X --probe-browser=$b --probe-variant=$d"; done
  for r in await pipeline; do run "$N newtabs --probe-guard --probe-browser=$b --probe-variant=$r --probe-timeout=280000"; done
  run "$N frames $X --probe-browser=$b"
  run "$N sw $X --probe-browser=$b"
  run "$N bfcache $X --probe-browser=$b"
  run "$N speculation $X --probe-browser=$b"
  run "$N speculation $X --probe-browser=$b --probe-variant=diag"
  run "$N order $X --probe-browser=$b"
  run "$N p8 $X --probe-browser=$b"
  run "$N seed $X --probe-browser=$b"
  for v in prewritten control; do run "$N prefs $X --probe-browser=$b --probe-variant=$v"; done
  for v in none policy force; do run "$N webrtc $X --probe-browser=$b --probe-variant=$v"; done
  for v in cdp keyboard; do run "$N devtools $X --probe-browser=$b --probe-variant=$v"; done
  run "$M bodies $X --probe-browser=$b --probe-mode=none --probe-timeout=580000"
  run "$M bodies $X --probe-browser=$b --probe-mode=eager --probe-timeout=580000"
  run "$M bodies $X --probe-browser=$b --probe-mode=capture --probe-sites=same --probe-timeout=580000"
  run "$M bodies $X --probe-browser=$b --probe-mode=capture --probe-sites=cross --probe-timeout=580000"
  for d in enable configure; do run "$M bodies $X --probe-browser=$b --probe-mode=capture --probe-sites=cross --probe-durable=$d --probe-timeout=580000"; done
  run "$N electron-ws $X --probe-browser=$b"
  run "$M electron-ws $X --probe-browser=$b"
done
run "PROBE_PORT_A=18281 PROBE_PORT_B=18282 $N artifacts $X --probe-browser=cft --probe-tag=nofieldtrial --probe-extra=--disable-field-trial-config"
run "PROBE_PORT_A=18281 PROBE_PORT_B=18282 $M electron-mhtml"
run "ELECTRON_RUN_AS_NODE=1 $E $P mhtml-compare"
run "ELECTRON_RUN_AS_NODE=1 $E $P discover"
run "$M shortcut $X --probe-browser=chrome"

# P16: the host as it is, then two GNOME sessions on a private bus with no service activation.
ISO="export XDG_DATA_HOME=$S/kr/data XDG_RUNTIME_DIR=$S/kr/run XDG_CURRENT_DESKTOP=GNOME;"
KR="printf fixture-keyring-pass | gnome-keyring-daemon --unlock --components=secrets >/dev/null;"
FRESH="rm -rf $S/kr && mkdir -p $S/kr/data $S/kr/run && chmod 700 $S/kr/run"
BUS="dbus-run-session --config-file=$S/bus.conf --"
for b in chrome cft; do
  run "$N keystore $X --probe-browser=$b --probe-tag=host"
  run "$FRESH && $BUS sh -c '$ISO $KR $N keystore $X --probe-browser=$b --probe-tag=gnome-keyring'"
  run "$FRESH && $BUS sh -c '$ISO $N keystore $X --probe-browser=$b --probe-tag=gnome-no-secret-service'"
done
run "$M safestorage --probe-tag=host"
run "$FRESH && $BUS sh -c '$ISO $KR $M safestorage --probe-tag=gnome-keyring'"
run "$FRESH && $BUS sh -c '$ISO $M safestorage --probe-tag=gnome-no-secret-service'"

# P13: the spec's Egress wrapper as written, then the same run under a nested user namespace
# that maps the caller's own uid, with a DNS listener on loopback.
run "unshare -rn sh -c 'ip link set lo up && $N egress --probe-variant=socks --probe-tag=spec-wrapper'"
for b in chrome cft; do
  for v in direct socks http; do
    run "unshare -rnm sh -c 'ip link set lo up && mount --bind $S/resolv.conf /etc/resolv.conf && { ELECTRON_RUN_AS_NODE=1 $E $P dnslog --probe-browser=$b --probe-tag=$v --probe-duration=170000 & } && sleep 1 && unshare -U --map-user=$U --map-group=$G env $N egress --probe-browser=$b --probe-variant=$v && wait'"
  done
done
echo done >> $S/batch.out
```
