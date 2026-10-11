# Capture engine renderer spike: Network events in the hidden window

**Date:** 2026-10-11

**Status:** Complete. A measurement, not a decision. Question 4 meets the plan's first stop
condition, so step 1 waits for a maintainer ruling (see "Rulings this asks for").

**Frame of reference:** the scratch branch was cut from
`2598173fd170604ca7ec0df571f1e08bade2a8b1` (`origin/main` on 2026-10-11), and every `path:line`
citation on this page points into that commit.

This spike answers the seven questions of step 0 in
[the first-slice plan](../plans/2026-10-10-capture-engine-first-slice.md) (Step 0, `:778`). A
scratch change made `renderPageInHiddenWindow` load `about:blank`, send `Network.enable` with the
probe's limits, load the target, and record every `Network` event that `wc.debugger` emitted. The
recorded streams are in
[the event file](2026-10-11-capture-engine-renderer-spike-events.json). The scratch change, the
fixture servers, and every command with its exit code are under "Reproduce", so a reader can
rerun the spike without the scratch branch.

## Verdicts

| Question | Verdict |
| --- | --- |
| 1. The two Recapture e2e specs with the domain on | Both pass; Playwright exit 0. |
| 2. Requests during `wc.savePage` | None, in all 16 fixture runs. |
| 3. A request the consent filter cancels | `Network.loadingFailed` with `canceled: false`, `blockedReason: "other"`, and `errorText: "net::ERR_BLOCKED_BY_CLIENT"`. |
| 4. Cross-site iframe and cross-port redirect | Stop condition: the iframe's subresource requests never reach `wc.debugger`. Both redirect hops do. The iframe runs in its own renderer process. |
| 5. Cache events in a fresh partition | Yes: three fixtures gave `fromDiskCache: true`, and one gave `Network.requestServedFromCache`. |
| 6. `securityDetails` over HTTPS | Present on every main document response, with every D7 field under its D7 name. `keyExchange` is `""` on TLS 1.3. |
| 7. `history.length` | 2 after `about:blank`, 1 without it. Of five methods, only `location.replace` made the target read 1, and it changed the request the server saw. |

## Rulings this asks for

1. **Child targets (question 4, a stop condition).** The plan's step 0 "Done when" reads: "If
   question 4 shows an iframe's requests missing, step 1 stops: the inventory needs a design for
   child targets, which goes to the maintainer." The cross-site iframe's stylesheet, image, and
   `fetch` reached the fixture server, and the MHTML holds the first two, but no event for any of
   them arrived on `wc.debugger`. Step 1 waits until the maintainer rules how the first slice
   accounts for requests made inside an out-of-process iframe.
2. **The `about:blank` entry (question 7, not a stop condition).** The plan's fallback, recording
   the difference as a known limitation, still applies, because no method removed the entry
   before the target's document committed. One method, navigating from `about:blank` with
   `location.replace`, made the target read 1, at the cost of sending
   `Sec-Fetch-Site: cross-site` instead of `none` on the main document request. Whether step 9
   takes that trade or keeps `wc.loadURL` and records the limitation is a choice no ruling covers
   yet.

Question 6 does not meet the second stop condition: `securityDetails` arrived on every HTTPS
main document.

## Environment

- **Commit.** `2598173f`, as above. Neither #1693 nor #1726 had merged at that commit: both were
  open on 2026-10-11 (`gh issue view 1693` and `gh issue view 1726`, state `OPEN`). The fixture
  runs therefore needed no loopback allowance: `validateUrl` in
  `src/main/services/recapture.ts:99` checks only the scheme, and all 16 fixture runs, on
  `127.0.0.1` and `localhost`, stored a Capture.
- **Runtime the app reported.** `process.versions`, written by the scratch renderer on every
  render: Electron 44.5.1, Chromium 152.0.7977.130, Node 24.21.0, V8 15.2.124.28-electron.0.
  These are the versions the plan's probe rerun read (plan, `:151`).
- **Operating system.** Ubuntu 24.04.4 LTS under WSL2, Linux 6.18.33.2-microsoft-standard-WSL2.
  Every app run used `xvfb-run` with the `env` prefix from `.claude/skills/run-birdbrain/SKILL.md`
  ("Test").
- **Tooling.** Node 20.20.2 and pnpm 10.28.2 for the scripts, Playwright 1.63.0, OpenSSL 3.0.13.
- **Port 19845.** Free before every app run: `ss -ltnp | grep 19845` matched nothing (exit 1).
- **Internet.** `e2e/recapture.spec.ts` sets no `BIRDBRAIN_CONSENT_LISTS`, so the app fetched the
  two public consent lists (`src/main/services/consentBlocker.ts:12-17`) through the main
  process's `fetch` (`:47`). That traffic never passes through the hidden window, so it is not in
  the event file.

## Method

### The scratch change

The diff under "Reproduce" changes only `src/main/services/backgroundRenderer.ts`. Inside
`renderPageInHiddenWindow` (`:376`) it:

- registers a `wc.debugger` `message` listener before `wc.debugger.attach('1.3')` (`:468`) and
  keeps every event whose method starts with `Network.` as a `{ method, params }` pair, in arrival
  order, plus any non-empty `sessionId`;
- before the target, loads `about:blank`, sends `Network.enable` with
  `maxTotalBufferSize: 50e6, maxResourceBufferSize: 10e6` (the probe's limits,
  [probe spike](2026-10-02-capture-engine-probe-spike.md) `:209`) under a 10 s bound, and only
  then calls `wc.loadURL(url)` (`:497`);
- reads a `spike-mode` query parameter on the target URL, which selects the question 7 variants;
- records a marker, holding the wall-clock time in milliseconds and the number of events so far,
  at each phase: `blank-loaded`, `network-enabled`, `target-load-start`, `target-loaded`,
  `screenshot-start`, `screenshot-end`, `savepage-start`, `savepage-end`, `text-end`;
- after the post-scroll idle wait and before the screenshot, reads every frame's
  `WebFrameMain.osProcessId` and the `http`/`https` entries of `Target.getTargets`;
- reads `history.length` in the page and `wc.navigationHistory` three times: before the target,
  after it loads, and before the screenshot;
- after `wc.savePage` (`:519`), lists the MHTML's `Content-Location` lines;
- when `BIRDBRAIN_SPIKE_TEST_CERT` names a PEM file, installs
  `session.setCertificateVerifyProc` on the render's session, which accepts that exact leaf
  certificate (`0`) and hands every other certificate back to Chromium's own check (`-3`);
- writes one JSON file per render to the directory `BIRDBRAIN_SPIKE_OUT` names.

The rest of the render runs as at `2598173f`: the fresh `recapture-<uuid>` partition (`:393`),
the consent blocker (`:479-492`), the `webRequest` idle tracker (`:494`), the scroll phase, the
screenshot, `savePage`, and the text read. The debugger stays attached until `cleanup()`
detaches it (`:445`), so events after the text read are not recorded.

### Fixtures and runs

`run.mjs` (under "Reproduce") generates a test certificate authority and a leaf for `localhost`
and `127.0.0.1` with `openssl` into the run's output directory, outside the repository. It starts
six servers, each bound to `127.0.0.1` on a free port, and each logging every request with a
wall-clock time and six request headers (`Sec-Fetch-Site`, `Sec-Fetch-Mode`, `Sec-Fetch-Dest`,
`Sec-Fetch-User`, `Referer`, `If-None-Match`):

| Server | Address the pages use | Serves |
| --- | --- | --- |
| `main` | `http://127.0.0.1:<A>` | every fixture page, and the consent list |
| `child` | `http://localhost:<B>` | the cross-site iframe and its three subresources |
| `hop` | `http://127.0.0.1:<C>` | the redirect's second hop and its image |
| `tls13` | `https://127.0.0.1:<D>` | the TLS page, Node's defaults (TLS 1.3) |
| `tls12gcm` | `https://127.0.0.1:<E>` | the TLS page, TLS 1.2 with `ECDHE-RSA-AES128-GCM-SHA256` only |
| `tls12cbc` | `https://127.0.0.1:<F>` | the TLS page, TLS 1.2 with `ECDHE-RSA-AES128-SHA` only |

It then launches the built app the way `e2e/fixtures/electronApp.ts:83-90` does, with a seeded
`settings.json` and signing key, and sets three variables for the app: `BIRDBRAIN_SPIKE_OUT`,
`BIRDBRAIN_SPIKE_TEST_CERT` (the leaf), and `BIRDBRAIN_CONSENT_LISTS` (`<A>/filters.txt`). That
list holds a cosmetic rule, `###spike-cmp-banner`, and a network rule, `/spike-cmp-blocked.js`,
because the list `e2e/recapture-consent.spec.ts:35` serves has a cosmetic rule only. The script
creates a Case through `window.birdbrain.cases.create` and queues one Recapture per run through
`window.birdbrain.recapture.enqueue` (`src/preload/index.ts:90-93`, payload
`src/shared/ipc.ts:723`). It waits for `recapture.queueStatus()` to report an empty queue before
the next run. All 16 runs stored a Capture.

| Run | Question | Target |
| --- | --- | --- |
| `q1-playwright-session` | 1 | `<A>/slow-idle`, a page whose `fetch` the server answers after 5 s |
| `q2-savepage` | 2 | `<A>/savepage` |
| `q3-consent-network-rule` | 3 | `<A>/consent` |
| `q4-cross-site-iframe` | 4 | `<A>/frame-parent`, framing `http://localhost:<B>/frame-child` |
| `q4-cross-port-redirect` | 4 | `<A>/redirect-start`, a `302` to `<C>/redirect-end` |
| `q5-cache` | 5 | `<A>/cache` |
| `q6-tls13`, `q6-tls12-gcm`, `q6-tls12-cbc` | 6 | `/tls` on `<D>`, `<E>`, and `<F>` |
| `q7-history-<mode>`, seven runs | 7 | `<A>/history?spike-mode=<mode>` |

The three `q1-e2e-*` runs come from the e2e suite, not from `run.mjs` (question 1).
`assemble.mjs` joins the per-render files, the run list, and the server log into the event file.

### How this differs from a production render

- Playwright is attached to the app in every run, as in the e2e suite, and it attaches to the
  hidden window as well (question 1). In normal use no second CDP client is attached.
- The certificate allowance, the fixture consent list, and the `Network` domain exist only in the
  scratch build.
- The scratch change records events in memory and writes them at the end of the render. It
  fetches no bodies: `Network.getResponseBody` was never called.

## Question 1: the e2e specs with the domain on

**Question.** "Do `e2e/recapture.spec.ts` and `e2e/recapture-consent.spec.ts` still pass with the
domain on? This tests the comment from #180." The comment sits above `createNetworkIdleTracker`
(`src/main/services/backgroundRenderer.ts:48-51`) and says that enabling a CDP event domain from
`webContents.debugger` "evicts any other CDP client attached to the same target", which "breaks
Playwright's own debugger session in E2E".

**Runs.** The issue's verification command on the scratch build, with `BIRDBRAIN_SPIKE_OUT` set
so the renders leave their event streams (runs `q1-e2e-recapture-consent`, `q1-e2e-recapture-1`,
and `q1-e2e-recapture-2`). As a control, the same command passed on an unmodified `pnpm build` of
`2598173f` first (exit 0, two passed). `playwright.config.ts:6` sets no retries outside CI, so each
pass is a first attempt. Run `q1-playwright-session` then checked the eviction claim directly:
while the hidden window held its target, after `Network.enable` had answered, `run.mjs` found that
window among `app.windows()` and called `page.evaluate` in it.

**Observed.**

```shell
BIRDBRAIN_SPIKE_OUT=/tmp/spike-1823/e2e/renders env -u ELECTRON_RUN_AS_NODE -u WAYLAND_DISPLAY \
  XDG_SESSION_TYPE=x11 xvfb-run --auto-servernum npx playwright test e2e/recapture.spec.ts \
  e2e/recapture-consent.spec.ts
```

```text
Running 2 tests using 1 worker

  ✓  1 e2e/recapture-consent.spec.ts:63:7 › Recapture through a consent wall › suppresses the wall, scrolls past the lock, and records provenance (10.1s)
  ✓  2 e2e/recapture.spec.ts:28:7 › Recapture (background capture) › captures a URL in the background with full provenance (7.1s)

  2 passed (17.7s)
```

Exit 0. Each render recorded its events, so `Network.enable` answered in every one:

```shell
J=docs/specs/2026-10-11-capture-engine-renderer-spike-events.json
jq -r '.runs[] | select(.question == 1) | [.name, (.events | length), (.enableError // "none")] | @tsv' $J
jq -c '.runs[] | select(.name == "q1-playwright-session") | .playwright' $J
```

```text
q1-e2e-recapture-consent	7	none
q1-e2e-recapture-1	7	none
q1-e2e-recapture-2	7	none
q1-playwright-session	13	none
{"found":true,"evaluated":{"title":"Slow idle fixture","href":"http://127.0.0.1:43902/slow-idle"}}
```

Both commands exit 0.

**Verdict.** Pass for both specs with the domain on: `e2e/recapture-consent.spec.ts` passed and
`e2e/recapture.spec.ts` passed, Playwright exit 0; Playwright's own session also evaluated a
script inside the hidden window after `Network.enable`, which the #180 comment says would break.

## Question 2: requests during `wc.savePage`

**Question.** "Which requests reach the fixture server during `wc.savePage`? The answer fixes
where collection stops."

**Run.** `q2-savepage` is the purpose-built page: a stylesheet carrying a font and a `no-store`
background image, a `max-age` image, a `no-store` image, a `srcset` image, a `<link rel="icon">`,
a same-origin iframe with a `no-store` image, a print-only background, and a `loading="lazy"`
image 3,000 px down. Every fixture run carries the same markers, so all 16 count.

**Observed.** For every run: `savePage` duration in milliseconds, `Network` events during it, and
server requests during it.

```shell
jq -r '.runs[] | (.markers | map({(.marker): .}) | add) as $m | [.name, ($m["savepage-end"].at - $m["savepage-start"].at), ($m["savepage-end"].eventIndex - $m["savepage-start"].eventIndex), (if .serverLog then ([.serverLog[] | select(.at >= $m["savepage-start"].at and .at <= $m["savepage-end"].at)] | length) else "no log" end)] | @tsv' $J
```

```text
q1-e2e-recapture-consent	1	0	no log
q1-e2e-recapture-1	2	0	no log
q1-e2e-recapture-2	3	0	no log
q1-playwright-session	4	0	0
q2-savepage	2	0	0
q3-consent-network-rule	1	0	0
q4-cross-site-iframe	3	0	0
q4-cross-port-redirect	2	0	0
q5-cache	1	0	0
q6-tls13	1	0	0
q6-tls12-gcm	1	0	0
q6-tls12-cbc	3	0	0
q7-history-keep	0	0	0
q7-history-direct	1	0	0
q7-history-clear-before	1	0	0
q7-history-reset-cdp	1	0	0
q7-history-location-replace	1	0	0
q7-history-remove-after-commit	1	0	0
q7-history-clear-after-commit	1	0	0
```

The `q2-savepage` timeline, markers and server requests merged, in milliseconds from
`blank-loaded`:

```shell
jq -r '.runs[] | select(.name == "q2-savepage") | .markers[0].at as $t0 | ([.markers[] | {t: (.at - $t0), what: "marker \(.marker)"}] + [.serverLog[] | {t: (.at - $t0), what: "server \(.url)"}]) | sort_by(.t) | .[] | "+\(.t) ms\t\(.what)"' $J
jq -r '.runs[] | select(.name == "q2-savepage") | .mhtml.bytes, (.mhtml.contentLocations[] | sub("Content-Location: http://127.0.0.1:[0-9]+"; ""))' $J
jq '[.runs[] | (.markers | map({(.marker): .eventIndex}) | add) as $e | $e["text-end"] - $e["screenshot-start"]] | add' $J
```

```text
+0 ms	marker blank-loaded
+3 ms	marker network-enabled
+5 ms	marker target-load-start
+9 ms	server /savepage
+23 ms	server /savepage/style.css
+24 ms	server /savepage/cacheable.png
+24 ms	server /savepage/nostore.png
+31 ms	server /savepage/frame
+32 ms	server /savepage/srcset-1x.png
+32 ms	server /savepage/bg.png
+40 ms	server /savepage/font.woff2
+46 ms	server /savepage/frame-nostore.png
+53 ms	marker target-loaded
+1754 ms	server /savepage/lazy.png
+3756 ms	marker screenshot-start
+3967 ms	marker screenshot-end
+3967 ms	marker savepage-start
+3969 ms	marker savepage-end
+3970 ms	marker text-end
4163
/savepage
/savepage/lazy.png
/savepage/nostore.png
/savepage/cacheable.png
/savepage/bg.png
/savepage/font.woff2
/savepage/style.css
/savepage/frame
/savepage/frame-nostore.png
0
```

All three exit 0. `wc.savePage` took 0 to 4 ms on these pages. The MHTML holds the four
`no-store` resources with no new request, so the serializer wrote them from memory. The last
number is the count of `Network` events between `screenshot-start` and `text-end` across all 19
runs. Three side observations: the icon and the print-only image were never requested, and the
`srcset` image reached the server but has no `Content-Location` line in the MHTML.

**Verdict.** None: no fixture server logged a request between the start and the end of
`wc.savePage` in any of the 16 fixture runs, and no `Network` event arrived during `savePage`, or
during the screenshot before it, in any of the 19 runs.

## Question 3: a request the consent filter cancels

**Question.** "How does a request the consent filter cancels arrive: `loadingFailed` with
`canceled`, with `blockedReason`, or another way?"

**Run.** `q3-consent-network-rule`. The page loads `/spike-cmp-blocked.js` three ways (a
`<script>`, an `<img>`, and a `fetch`), all matching the fixture list's network rule, and one
image no rule matches.

**Observed.**

```shell
jq -c '.runs[] | select(.name == "q3-consent-network-rule") | [.events[] | select(.params.requestId)] | group_by(.params.requestId)[] | {url: (map(select(.method == "Network.requestWillBeSent"))[0].params.request.url), methods: map(.method | sub("Network."; ""))}' $J
jq -c '.runs[] | select(.name == "q3-consent-network-rule") | .events[] | select(.method == "Network.loadingFailed") | .params | del(.timestamp)' $J
jq -c '.runs[] | select(.name == "q3-consent-network-rule") | [.serverLog[].url]' $J
```

```text
{"url":"http://127.0.0.1:43902/consent","methods":["requestWillBeSent","requestWillBeSentExtraInfo","responseReceivedExtraInfo","responseReceived","dataReceived","loadingFinished"]}
{"url":"http://127.0.0.1:43902/spike-cmp-blocked.js","methods":["requestWillBeSent","loadingFailed"]}
{"url":"http://127.0.0.1:43902/spike-cmp-blocked.js?as=img","methods":["requestWillBeSent","loadingFailed"]}
{"url":"http://127.0.0.1:43902/consent-allowed.png","methods":["requestWillBeSent","requestWillBeSentExtraInfo","responseReceivedExtraInfo","resourceChangedPriority","responseReceived","dataReceived","dataReceived","loadingFinished"]}
{"url":"http://127.0.0.1:43902/spike-cmp-blocked.js?as=fetch","methods":["requestWillBeSent","loadingFailed"]}
{"blockedReason":"other","canceled":false,"errorText":"net::ERR_BLOCKED_BY_CLIENT","requestId":"3129300.3","type":"Image"}
{"blockedReason":"other","canceled":false,"errorText":"net::ERR_BLOCKED_BY_CLIENT","requestId":"3129300.2","type":"Script"}
{"blockedReason":"other","canceled":false,"errorText":"net::ERR_BLOCKED_BY_CLIENT","requestId":"3129300.8","type":"Fetch"}
["/consent","/consent-allowed.png"]
```

All three exit 0.

**Verdict.** Each of the three requests the network rule cancelled arrived as a
`Network.requestWillBeSent` followed by `Network.loadingFailed` with `canceled: false`,
`blockedReason: "other"`, and `errorText: "net::ERR_BLOCKED_BY_CLIENT"`, with no `ExtraInfo` or
response event, and the server logged none of them.

## Question 4: a cross-site iframe and a cross-port redirect

**Question.** "Do the requests of a cross-site iframe (for example, a page on `127.0.0.1` framing
one on `localhost`), and both hops of a main document redirected between two loopback ports,
appear on `wc.debugger`? Does the iframe run in its own renderer process?"

**Runs.** `q4-cross-site-iframe`: a page on `127.0.0.1:<A>` framing `localhost:<B>/frame-child`,
which loads a stylesheet, an image, and a `fetch` from `localhost:<B>`. `q4-cross-port-redirect`:
`127.0.0.1:<A>/redirect-start` answers `302` to `127.0.0.1:<C>/redirect-end`, which loads an
image. The process of each frame comes from `WebFrameMain.osProcessId` on
`wc.mainFrame.framesInSubtree`, read in the main process after the post-scroll idle wait.

**Observed.**

```shell
jq -c '.runs[] | select(.question == 4) | .name as $n | [.events[] | select(.params.requestId)] | group_by(.params.requestId)[] | {run: $n, url: (map(select(.method == "Network.requestWillBeSent"))[0].params.request.url), methods: map(.method | sub("Network."; ""))}' $J
jq -c '.runs[] | select(.question == 4) | {name, frames: [.frames[] | {url, isMainFrame, osProcessId}], targets, childSessionIds, server: [.serverLog[] | "\(.server) \(.url)"]}' $J
jq -c '.runs[] | select(.name == "q4-cross-port-redirect") | .events[] | select(.method == "Network.requestWillBeSent") | [.params.requestId, .params.request.url, (.params.redirectResponse.status // null), (.params.redirectResponse.url // null)]' $J
jq -r '.runs[] | select(.name == "q4-cross-site-iframe") | .mhtml.contentLocations[]' $J
jq -c '.runs[] | select(.name == "q2-savepage" or .name == "q5-cache") | ([.events[] | select(.method == "Network.requestWillBeSent")][0].params.frameId) as $main | {name, processes: ([.frames[].osProcessId] | unique), iframeRequests: [.events[] | select(.method == "Network.requestWillBeSent" and .params.frameId != $main) | .params.request.url | sub("http://127.0.0.1:[0-9]+"; "")]}' $J
```

```text
{"run":"q4-cross-site-iframe","url":"http://127.0.0.1:43902/frame-parent.png","methods":["requestWillBeSentExtraInfo","requestWillBeSent","responseReceivedExtraInfo","resourceChangedPriority","responseReceived","dataReceived","dataReceived","loadingFinished"]}
{"run":"q4-cross-site-iframe","url":"http://127.0.0.1:43902/frame-parent","methods":["requestWillBeSent","requestWillBeSentExtraInfo","responseReceivedExtraInfo","responseReceived","dataReceived","loadingFinished"]}
{"run":"q4-cross-site-iframe","url":"http://localhost:44682/frame-child","methods":["requestWillBeSent","requestWillBeSentExtraInfo","responseReceivedExtraInfo","responseReceived"]}
{"run":"q4-cross-port-redirect","url":"http://127.0.0.1:44794/redirect-end.png","methods":["requestWillBeSentExtraInfo","responseReceivedExtraInfo","requestWillBeSent","responseReceived","dataReceived","dataReceived","loadingFinished"]}
{"run":"q4-cross-port-redirect","url":"http://127.0.0.1:43902/redirect-start","methods":["requestWillBeSent","requestWillBeSentExtraInfo","responseReceivedExtraInfo","requestWillBeSent","requestWillBeSentExtraInfo","responseReceivedExtraInfo","responseReceived","dataReceived","loadingFinished"]}
{"name":"q4-cross-site-iframe","frames":[{"url":"http://127.0.0.1:43902/frame-parent","isMainFrame":true,"osProcessId":3129640},{"url":"http://localhost:44682/frame-child","isMainFrame":false,"osProcessId":3129648}],"targets":[{"type":"page","url":"http://127.0.0.1:43902/frame-parent"},{"type":"iframe","url":"http://localhost:44682/frame-child"}],"childSessionIds":[],"server":["main /frame-parent","main /frame-parent.png","child /frame-child","child /frame-child.css","child /frame-child.png","child /frame-child.json"]}
{"name":"q4-cross-port-redirect","frames":[{"url":"http://127.0.0.1:44794/redirect-end","isMainFrame":true,"osProcessId":3129698}],"targets":[{"type":"page","url":"http://127.0.0.1:44794/redirect-end"}],"childSessionIds":[],"server":["main /redirect-start","hop /redirect-end","hop /redirect-end.png"]}
["E4D807742EE9CC96BB46193A2F46003E","http://127.0.0.1:43902/redirect-start",null,null]
["E4D807742EE9CC96BB46193A2F46003E","http://127.0.0.1:44794/redirect-end",302,"http://127.0.0.1:43902/redirect-start"]
["3129698.2","http://127.0.0.1:44794/redirect-end.png",null,null]
Content-Location: http://127.0.0.1:43902/frame-parent
Content-Location: http://127.0.0.1:43902/frame-parent.png
Content-Location: http://localhost:44682/frame-child
Content-Location: http://localhost:44682/frame-child.png
Content-Location: http://localhost:44682/frame-child.css
{"name":"q2-savepage","processes":[3129153],"iframeRequests":["/savepage/frame","/savepage/frame-nostore.png"]}
{"name":"q5-cache","processes":[3129727],"iframeRequests":["/cache/frame","/cache/shared-with-frame.js"]}
```

All five exit 0. The `child` server logged `/frame-child.css`, `/frame-child.png`, and
`/frame-child.json`, and the MHTML holds the first two, but `wc.debugger` reported none of the
three. The iframe's own document arrived with request and response events and no `dataReceived`
or `loadingFinished`, so a collector would count it as in flight. `Target.getTargets` lists the
iframe as a separate `iframe` target, and no event carried a child `sessionId`. Same-origin
iframes behave differently: in `q2-savepage` and `q5-cache` the iframe shares the main frame's
process, and its requests appear on `wc.debugger`.

**Verdict.** Stop condition 1 holds: the cross-site iframe's three subresource requests never
appeared on `wc.debugger` (its document request appeared but never finished there); both hops of
the cross-port redirect appeared, as two `Network.requestWillBeSent` events under one request id,
the second carrying the `302` as `redirectResponse`; and the iframe ran in a renderer process
other than the main frame's (OS process 3129648 against 3129640, read from
`WebFrameMain.osProcessId`).

## Question 5: cache events in a fresh partition

**Question.** "Can a fixture produce `Network.requestServedFromCache` or a `fromDiskCache`
response in a fresh partition?"

**Run.** `q5-cache`. Every subresource carries `Cache-Control: max-age=3600` except `etag.json`,
which carries `no-cache` and an `ETag` and answers `304` to a matching `If-None-Match`; the page
and its iframe carry no cache header. The page
tries eight ways to use a resource twice:

| Fixture | First use | Second use |
| --- | --- | --- |
| `preload.css` | `<link rel="preload">` | `<link rel="stylesheet">` |
| `script-then-fetch.js` | `<script>` | `fetch` after `load` |
| `script-twice.js` | `<script>` | a second `<script>` element added after `load` |
| `shared-with-frame.js` | `<script>` in the page | `<script>` in a same-origin iframe |
| `img-twice-later.png` | `<img>` | `new Image()` after `load` |
| `force-cache.json` | `fetch` with `cache: 'force-cache'` | the same `fetch` again |
| `max-age.json` | `fetch` | the same `fetch` again |
| `etag.json` | `fetch` | the same `fetch` again, revalidated |

**Observed.** Per response: URL, `status`, the `responseReceivedExtraInfo` status code (`-` when
none arrived), `fromDiskCache`, and whether a `Network.requestServedFromCache` named the request.

```shell
jq -r '.runs[] | select(.name == "q5-cache") | [.events[] | select(.method == "Network.requestServedFromCache") | .params.requestId] as $c | ([.events[] | select(.method == "Network.responseReceivedExtraInfo") | {key: .params.requestId, value: .params.statusCode}] | from_entries) as $x | .events[] | select(.method == "Network.responseReceived") | [(.params.response.url | sub("http://127.0.0.1:[0-9]+"; "")), .params.response.status, ($x[.params.requestId] // "-"), .params.response.fromDiskCache, (.params.requestId as $id | $c | index($id) != null)] | @tsv' $J
jq -r '.runs[] | select(.name == "q5-cache") | .serverLog | group_by(.url)[] | "\(.[0].url)\t\(length)"' $J
jq -r '.runs[] | [.name, ([.events[] | select(.method == "Network.requestServedFromCache")] | length), ([.events[] | select(.method == "Network.responseReceived" and .params.response.fromDiskCache)] | length)] | select(.[1] + .[2] > 0) | @tsv' $J
```

```text
/cache	200	200	false	false
/cache/preload.css	200	200	false	false
/cache/script-then-fetch.js	200	200	false	false
/cache/script-twice.js	200	200	false	false
/cache/shared-with-frame.js	200	200	false	false
/cache/img-twice-later.png	200	200	false	false
/cache/frame	200	200	false	false
/cache/shared-with-frame.js	200	-	false	true
/cache/script-then-fetch.js	200	-	true	false
/cache/force-cache.json	200	200	false	false
/cache/force-cache.json	200	-	true	false
/cache/max-age.json	200	200	false	false
/cache/max-age.json	200	-	true	false
/cache/etag.json	200	200	false	false
/cache/etag.json	200	304	false	false
/cache	1
/cache/etag.json	2
/cache/force-cache.json	1
/cache/frame	1
/cache/img-twice-later.png	1
/cache/max-age.json	1
/cache/preload.css	1
/cache/script-then-fetch.js	1
/cache/script-twice.js	1
/cache/shared-with-frame.js	1
q5-cache	1	3
```

All three exit 0. The second uses of `preload.css`, `script-twice.js`, and `img-twice-later.png`
produced no event at all, as the probe found for an image used twice. The revalidated `etag.json`
reached the server, which answered `304`; `responseReceived` reported `200` with
`fromDiskCache: false`, and only `responseReceivedExtraInfo` carried the `304`. The last line
shows no other run produced either cache signal.

**Verdict.** Yes: `script-then-fetch.js`, `force-cache.json`, and `max-age.json` each produced a
`fromDiskCache: true` response on their second use, `shared-with-frame.js` produced
`Network.requestServedFromCache` (with `fromDiskCache: false`), and `preload.css`,
`script-twice.js`, `img-twice-later.png`, and `etag.json` produced neither.

## Question 6: `securityDetails` over HTTPS

**Question.** "Served over HTTPS with a generated certificate, accepted through a test-only
`setCertificateVerifyProc` on the render's session, does the main document's
`Network.responseReceived` carry `securityDetails`, and do its field names match D7 on Chromium
152? The spike records the `keyExchange`, `keyExchangeGroup`, and `mac` values it sees."

**Runs.** `q6-tls13`, `q6-tls12-gcm`, and `q6-tls12-cbc`, one per HTTPS server. The leaf is RSA
2048, issued by the run's own test authority, `CN=Spike Test CA`, with SANs `IP:127.0.0.1` and
`DNS:localhost`, valid for two days. The authority and the leaf's key stayed in the run's output
directory under `/tmp` and are in neither file this spike commits.

**Observed.**

```shell
jq -c '.runs[] | select(.question == 6) | {name, securityDetails: (.events[] | select(.method == "Network.responseReceived" and .params.type == "Document") | .params.response.securityDetails)}' $J
jq -c '.runs[] | select(.question == 6) | {name, subresources: [.events[] | select(.method == "Network.responseReceived" and .params.type != "Document") | {type: .params.type, securityDetails: (.params.response.securityDetails != null)}]}' $J
```

```text
{"name":"q6-tls13","securityDetails":{"certificateId":0,"certificateTransparencyCompliance":"unknown","cipher":"AES_256_GCM","encryptedClientHello":false,"issuer":"Spike Test CA","keyExchange":"","keyExchangeGroup":"X25519","protocol":"TLS 1.3","sanList":["localhost","127.0.0.1"],"serverSignatureAlgorithm":2052,"signedCertificateTimestampList":[],"subjectName":"localhost","validFrom":1791751656,"validTo":1791924456}}
{"name":"q6-tls12-gcm","securityDetails":{"certificateId":0,"certificateTransparencyCompliance":"unknown","cipher":"AES_128_GCM","encryptedClientHello":false,"issuer":"Spike Test CA","keyExchange":"ECDHE_RSA","keyExchangeGroup":"X25519","protocol":"TLS 1.2","sanList":["localhost","127.0.0.1"],"serverSignatureAlgorithm":2052,"signedCertificateTimestampList":[],"subjectName":"localhost","validFrom":1791751656,"validTo":1791924456}}
{"name":"q6-tls12-cbc","securityDetails":{"certificateId":0,"certificateTransparencyCompliance":"unknown","cipher":"AES_128_CBC","encryptedClientHello":false,"issuer":"Spike Test CA","keyExchange":"ECDHE_RSA","keyExchangeGroup":"X25519","mac":"HMAC-SHA1","protocol":"TLS 1.2","sanList":["localhost","127.0.0.1"],"serverSignatureAlgorithm":2052,"signedCertificateTimestampList":[],"subjectName":"localhost","validFrom":1791751656,"validTo":1791924456}}
{"name":"q6-tls13","subresources":[{"type":"Image","securityDetails":true}]}
{"name":"q6-tls12-gcm","subresources":[{"type":"Image","securityDetails":true}]}
{"name":"q6-tls12-cbc","subresources":[{"type":"Image","securityDetails":true}]}
```

Both exit 0. Each page's image response carried `securityDetails` too. Against the D7 table (plan,
`:392`):

| D7 field | TLS 1.3 | TLS 1.2, GCM | TLS 1.2, CBC | In the recorded `securityDetails` |
| --- | --- | --- | --- | --- |
| `protocol` | `TLS 1.3` | `TLS 1.2` | `TLS 1.2` | present |
| `cipher` | `AES_256_GCM` | `AES_128_GCM` | `AES_128_CBC` | present |
| `subjectName` | `localhost` | same | same | present |
| `sanList` | `["localhost","127.0.0.1"]` | same | same | present |
| `issuer` | `Spike Test CA` | same | same | present |
| `validFrom`, `validTo` | whole seconds since the epoch | same | same | present |
| `signedCertificateTimestampList` | `[]` | `[]` | `[]` | present, empty; its eight entry fields could not be checked |
| `keyExchange` | `""` | `ECDHE_RSA` | `ECDHE_RSA` | present |
| `keyExchangeGroup` | `X25519` | `X25519` | `X25519` | present |
| `mac` | not sent | not sent | `HMAC-SHA1` | present when the cipher has a separate MAC |
| `certificateTransparencyCompliance` | `unknown` | same | same | present |
| `serverSignatureAlgorithm` | `2052` | same | same | present |
| `encryptedClientHello` | `false` | same | same | present |
| `certificateId` (D7 drops it) | `0` | same | same | present |

No field arrived under a name D7 does not list.

**Verdict.** The second stop condition does not hold: every main document response carried
`securityDetails`, and every D7 field is present under its D7 name, with `mac` present only for
the CBC cipher and the timestamp list empty; `keyExchange` was the empty string on TLS 1.3 and
`ECDHE_RSA` on both TLS 1.2 runs, `keyExchangeGroup` was `X25519` on all three, and `mac` was
`HMAC-SHA1` on the CBC run and absent on the two AEAD runs.

## Question 7: `history.length`

**Question.** "What does the target read as `history.length`? A scratch run for this plan read 2
after `about:blank` and 1 without it (Probe rerun on Electron 44.5.1). Can the renderer remove
the `about:blank` entry before the target's document commits, for example with
`wc.navigationHistory.clear()`, so the target reads 1?"

**Runs.** Seven loads of `<A>/history`, whose inline `<head>` script reads `history.length` while
the parser runs, again at `DOMContentLoaded` and `load`, and 1 s after `load`. The renderer reads
it once more before the screenshot. The `spike-mode` parameter picks the variant:

| Mode | What the renderer does |
| --- | --- |
| `keep` | `about:blank`, `Network.enable`, `wc.loadURL(target)`, as step 9 plans |
| `direct` | `wc.loadURL(target)` only: no `about:blank` and no `Network.enable` |
| `clear-before` | `wc.navigationHistory.clear()` after `about:blank`, then `wc.loadURL(target)` |
| `reset-cdp` | `Page.resetNavigationHistory` over `wc.debugger` after `about:blank`, then `wc.loadURL(target)` |
| `location-replace` | `location.replace(target)` run in the `about:blank` page through `wc.executeJavaScript` |
| `remove-after-commit` | `wc.navigationHistory.removeEntryAtIndex(0)` on the target's `did-navigate` |
| `clear-after-commit` | `wc.navigationHistory.clear()` on the target's `did-navigate` |

**Observed.** Per run: `Network` event count, the page's readings, the renderer's read before the
screenshot, `wc.navigationHistory.length()`, and the `Sec-Fetch-Site` header the server received.

```shell
jq -r '.runs[] | select(.question == 7) | [.name, (.events | length), ([.history["before-screenshot"].page.log[] | "\(.at)=\(.length)"] | join(" ")), .history["before-screenshot"].page.length, .history["before-screenshot"].navigationHistory.length, ([.serverLog[] | select(.url | startswith("/history")) | .headers["sec-fetch-site"]] | join(","))] | @tsv' $J
jq -c '.runs[] | select(.name == "q7-history-keep" or .name == "q7-history-location-replace") | {name, request: [.events[] | select(.method == "Network.requestWillBeSent") | .params | {initiator: .initiator.type, hasUserGesture, referer: (.request.headers.Referer // null)}]}' $J
```

```text
q7-history-keep	7	parse=2 domcontentloaded=2 load=2 load+1000ms=2	2	2	none
q7-history-direct	0	parse=1 domcontentloaded=1 load=1 load+1000ms=1	1	1	none
q7-history-clear-before	7	parse=2 domcontentloaded=2 load=2 load+1000ms=2	2	2	none
q7-history-reset-cdp	7	parse=2 domcontentloaded=2 load=2 load+1000ms=2	2	2	none
q7-history-location-replace	7	parse=1 domcontentloaded=1 load=1 load+1000ms=1	1	1	cross-site
q7-history-remove-after-commit	7	parse=2 domcontentloaded=2 load=2 load+1000ms=2	2	1	none
q7-history-clear-after-commit	7	parse=2 domcontentloaded=2 load=2 load+1000ms=1	1	1	none
{"name":"q7-history-keep","request":[{"initiator":"other","hasUserGesture":false,"referer":null}]}
{"name":"q7-history-location-replace","request":[{"initiator":"script","hasUserGesture":true,"referer":null}]}
```

Both exit 0. The `direct` run recorded no events because it never sent `Network.enable`.
`removeEntryAtIndex(0)` shortened Electron's list to one entry while the page kept reading 2.
`clear()` after commit reached the page only after `load`. `location.replace` kept the `Network`
domain on and gave 1 from the first script, but the main document request arrived as a
script-initiated navigation with `Sec-Fetch-Site: cross-site`, where every `wc.loadURL` run sent
`none`.

**Verdict.** The target read 2 with the `about:blank` load and 1 without it; of the five methods
tried (`navigationHistory.clear()` before the target, `Page.resetNavigationHistory`,
`location.replace` from `about:blank`, `navigationHistory.removeEntryAtIndex(0)` after commit, and
`navigationHistory.clear()` after commit), only `location.replace` made the target read 1 from
its first script, by replacing the entry rather than removing it and at the cost of a changed
`Sec-Fetch-Site`; none removed the entry before the target's document committed.

## The event file

`2026-10-11-capture-engine-renderer-spike-events.json` holds one object: `issue`, `cutFrom` (the
commit above), `versions` (`electron`, `chrome`, `node`, `v8`), `os`, and `runs`. Each of the 19
runs holds:

- `name` and `question`;
- `url`, the target, and `mode`, the `spike-mode` value (`keep` for every run outside question 7);
- `enableError`, `null` in every run;
- `childSessionIds`, the non-empty `sessionId` values seen, empty in every run;
- `markers`, each `{ marker, at, eventIndex }`, where `eventIndex` counts the events before it;
- `frames`, `targets`, `history`, and `mhtml`, the readings described under "The scratch change";
- `playwright`, on `q1-playwright-session` only, and `serverLog`, on the 16 fixture runs only,
  each entry `{ server, at, method, url, headers }`;
- `events`, the `{ method, params }` pairs in arrival order, unmodified. This is the input step 7's
  collector reads.

Every `http`, `https`, `ws`, and `wss` URL in it has the host `127.0.0.1` or `localhost`, and it
holds no certificate or key bytes (see "Reproduce" for both checks).

## Notes for later steps

- **Where collection stops (step 9).** No event and no request arrived during the screenshot or
  `savePage` in any run, so on these fixtures stopping after `savePage` and stopping before the
  screenshot record the same events. A page with timers or long polls still running at that point
  would separate the two; these fixtures have none.
- **Event order (step 7).** In 5 exchanges across the file, an `ExtraInfo` event arrived before
  its `Network.requestWillBeSent`, for example the image in `q4-cross-port-redirect`. The count
  comes from
  `jq '[.runs[] | [.events[] | select(.params.requestId)] | group_by(.params.requestId)[] | select(.[0].method | endswith("ExtraInfo"))] | length' $J`
  (exit 0).
- **Two cache shapes (step 7, D4 `cached`).** A disk cache hit arrives as `responseReceived` with
  `fromDiskCache: true` and no `requestServedFromCache`. A memory cache hit arrives as
  `requestServedFromCache` followed by `responseReceived` with `fromDiskCache: false`.
- **Revalidation (steps 7 and 8).** A `304` revalidation arrives as `responseReceived` with status
  `200` and `responseReceivedExtraInfo` with `statusCode: 304`. D8 prefers the `ExtraInfo`
  headers, so the writer has to pick which status line it writes.
- **Consent cancels (step 7, D4 `cancelled`).** `canceled` is `false` on a request the consent
  filter blocked; `errorText` and `blockedReason` identify it.
- **Test certificate allowance (step 9).** A `setCertificateVerifyProc` on the render's session
  that accepts one leaf was enough: Chromium reported `securityState: "secure"` and full
  `securityDetails`.

## What this does not show

- One pass of each run. An earlier pass of all 19 runs, before the MHTML listing joined the
  scratch change, gave the same verdicts; its files were deleted and nothing here cites them.
- HTTP/1.1 only. The fixture servers speak neither HTTP/2 nor HTTP/3.
- The test authority is private, so no certificate transparency log knows the leaf. The timestamp
  list was empty and `certificateTransparencyCompliance` was `unknown`; the eight timestamp entry
  fields in D7 and the other two compliance values were not observed. `encryptedClientHello` was
  never `true`.
- One cross-site iframe, one level deep. No nested frames, workers, or service workers. The spike
  did not try `Target.setAutoAttach` or any other way to reach the iframe's own target: that is
  the design the first ruling asks for.
- One consent list with one network rule. Real lists also redirect and rewrite requests.
- Cache events come from the eight fixtures listed. A fresh partition starts empty, so every hit
  here is a reuse inside one render.
- Playwright was attached in every run. Whether its session changes any event the renderer
  records is unmeasured.
- Small pages: the largest MHTML was 4,163 bytes.
- Linux under WSL2 and `Xvfb` only.

## Reproduce

### Commands

Every command, in order, with its exit code. Rows 7 to 22 ran on the scratch branch; the rest ran
on `docs/1823-renderer-spike`, which matched `2598173f` until this page and the event file were
committed on it. Rows 11 to 13 are the first pass, whose output row 17 deleted; rows 17 to 19 are
the pass this page reports.

| # | Command | Exit |
| --- | --- | --- |
| 1 | `bash scripts/setup-worktree.sh` | 0 |
| 2 | `gh issue view 1693 --json state,title,closedAt,stateReason`, and the same for `1726` | 0, 0 (both `OPEN`) |
| 3 | `pnpm build` (control, unmodified) | 0 |
| 4 | `ss -ltnp \| grep 19845` | 1 (no listener) |
| 5 | `env -u ELECTRON_RUN_AS_NODE -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 xvfb-run --auto-servernum npx playwright test e2e/recapture.spec.ts e2e/recapture-consent.spec.ts --reporter=list` (control) | 0 (2 passed) |
| 6 | the same without `--reporter=list` (control) | 0 (2 passed) |
| 7 | `git switch -c scratch/1823-renderer-instrumentation` | 0 |
| 8 | edit `src/main/services/backgroundRenderer.ts` to the diff below without its MHTML listing, and add the two scripts without `mhtml: r.mhtml` | none: a file edit |
| 9 | `npx tsc -p tsconfig.node.json --noEmit` | 0 |
| 10 | `pnpm build` | 0 |
| 11 | `rm -rf /tmp/spike-1823 && mkdir -p /tmp/spike-1823`, `ss -ltnp \| grep 19845`, then the e2e command under question 1 | 0, 1, then 0 (2 passed) |
| 12 | `ss -ltnp \| grep 19845`, then `env -u ELECTRON_RUN_AS_NODE -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 xvfb-run --auto-servernum node spike-1823/run.mjs /tmp/spike-1823/fixtures` | 1, then 0 (16 Captures stored) |
| 13 | `node spike-1823/assemble.mjs /tmp/spike-1823/events.json /tmp/spike-1823/e2e /tmp/spike-1823/fixtures` | 0 |
| 14 | edit: add the MHTML listing, which completes the diff below and `assemble.mjs` | none: a file edit |
| 15 | `npx tsc -p tsconfig.node.json --noEmit` | 0 |
| 16 | `pnpm build` | 0 |
| 17 | row 11 again | 0, 1, then 0 (2 passed) |
| 18 | row 12 again | 1, then 0 (16 Captures stored) |
| 19 | row 13 again | 0 |
| 20 | `gitleaks dir --config .gitleaks.toml --no-banner --redact /tmp/spike-1823/events.json` (Gitleaks 8.30.1, the version `.github/workflows/security.yml` pins) | 0 (no leaks found) |
| 21 | `git commit` of the change and both scripts on the scratch branch, as `3f346c37` | 0 |
| 22 | `git diff 2598173f 3f346c37 -- src/main/services/backgroundRenderer.ts > /tmp/spike-1823/renderer.diff` | 0 |
| 23 | `git switch docs/1823-renderer-spike`, then `cp /tmp/spike-1823/events.json docs/specs/2026-10-11-capture-engine-renderer-spike-events.json` | 0, 0 |
| 24 | the `jq` commands under each question, run against the committed file | 0 each; an earlier draft of the first question 5 query exited 5 on a `jq` precedence error and was rewritten |
| 25 | `git apply --check /tmp/spike-1823/renderer.diff`, on a tree whose renderer matches `2598173f` | 0 |
| 26 | `jq empty docs/specs/2026-10-11-capture-engine-renderer-spike-events.json` | 0 |
| 27 | the issue's URL scan: `jq -r '.. \| strings' <event file> \| grep -oE '(https?\|wss?)://[^[:space:]"]+' \| grep -Ev '^(https?\|wss?)://(127\.0\.0\.1\|localhost)([:/?#]\|$)'` | 1: the last `grep` printed nothing, so every URL is loopback |
| 28 | `.claude/hooks/vale-prose.sh --base origin/main` | 0: no errors on the changed lines |
| 29 | `git diff --name-only --no-renames origin/main...HEAD` | 0: prints this page and the event file, both under `docs/specs/` |

To rerun: cut a branch from `2598173f`, save the diff as `renderer.diff` and run
`git apply renderer.diff`, save the two scripts as `spike-1823/run.mjs` and
`spike-1823/assemble.mjs`, then run rows 1, 10, 11, 12, and 13. `run.mjs` needs `openssl` on
`PATH`, and `assemble.mjs` needs an `origin/main` ref.

### The change to `src/main/services/backgroundRenderer.ts`

```diff
diff --git a/src/main/services/backgroundRenderer.ts b/src/main/services/backgroundRenderer.ts
index 540afa23..3360f408 100644
--- a/src/main/services/backgroundRenderer.ts
+++ b/src/main/services/backgroundRenderer.ts
@@ -2,7 +2,7 @@ import { BrowserWindow, app } from 'electron'
 import type { WebContents, Session } from 'electron'
 import type { ElectronBlocker } from '@ghostery/adblocker-electron'
 import sharp from 'sharp'
-import { createReadStream } from 'fs'
+import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
 import { unlink } from 'fs/promises'
 import { join } from 'path'
 import { randomUUID } from 'crypto'
@@ -462,9 +462,55 @@ export const renderPageInHiddenWindow: RenderPage = async (url, { timeoutMs }) =
       httpStatus = httpResponseCode
     })
 
-    // The debugger is attached for the whole render but no CDP event domains are
-    // enabled — only the one-shot getLayoutMetrics/captureScreenshot commands use
-    // it. Network-idle is tracked out-of-band via the session's webRequest API.
+    // SPIKE #1823 (scratch): record every Network event, in arrival order.
+    let spikeMode = 'keep'
+    try {
+      spikeMode = new URL(url).searchParams.get('spike-mode') ?? 'keep'
+    } catch {
+      // keep the default
+    }
+    const spike = {
+      url,
+      mode: spikeMode,
+      pid: process.pid,
+      versions: process.versions,
+      enableError: null as string | null,
+      sessionIds: [] as string[],
+      markers: [] as Array<{ marker: string; at: number; eventIndex: number }>,
+      history: {} as Record<string, unknown>,
+      frames: null as unknown,
+      targets: null as unknown,
+      mhtml: null as unknown,
+      events: [] as Array<{ method: string; params: unknown }>
+    }
+    const mark = (marker: string): void => {
+      spike.markers.push({ marker, at: Date.now(), eventIndex: spike.events.length })
+    }
+    const readHistory = async (label: string): Promise<void> => {
+      spike.history[label] = {
+        page: await wc
+          .executeJavaScript('({ length: history.length, log: window.__spikeHistory ?? null })')
+          .catch((err) => String(err)),
+        navigationHistory: {
+          length: wc.navigationHistory.length(),
+          activeIndex: wc.navigationHistory.getActiveIndex(),
+          urls: wc.navigationHistory.getAllEntries().map((e) => e.url)
+        }
+      }
+    }
+    const certPath = process.env.BIRDBRAIN_SPIKE_TEST_CERT
+    if (certPath) {
+      const pemBody = (pem: string): string => pem.replace(/-----[^-]+-----|\s/g, '')
+      const trusted = pemBody(readFileSync(certPath, 'utf8'))
+      session.setCertificateVerifyProc((req, cb) =>
+        cb(pemBody(req.certificate.data) === trusted ? 0 : -3)
+      )
+    }
+    wc.debugger.on('message', (_event, method, params, sessionId) => {
+      if (!method.startsWith('Network.')) return
+      spike.events.push({ method, params })
+      if (sessionId && !spike.sessionIds.includes(sessionId)) spike.sessionIds.push(sessionId)
+    })
     wc.debugger.attach('1.3')
 
     // Neutralize consent/cookie-notice overlays before the page loads: the fresh
@@ -494,7 +540,44 @@ export const renderPageInHiddenWindow: RenderPage = async (url, { timeoutMs }) =
     networkTracker = createNetworkIdleTracker(session)
 
     try {
-      await wc.loadURL(url)
+      if (spikeMode !== 'direct') {
+        await wc.loadURL('about:blank')
+        mark('blank-loaded')
+        try {
+          await Promise.race([
+            wc.debugger.sendCommand('Network.enable', {
+              maxTotalBufferSize: 50e6,
+              maxResourceBufferSize: 10e6
+            }),
+            sleep(10_000).then(() => {
+              throw new Error('Network.enable: no reply in 10 s')
+            })
+          ])
+        } catch (err) {
+          spike.enableError = String(err)
+        }
+        mark('network-enabled')
+        if (spikeMode === 'clear-before') wc.navigationHistory.clear()
+        if (spikeMode === 'reset-cdp') await wc.debugger.sendCommand('Page.resetNavigationHistory')
+        await readHistory('before-target')
+      }
+      if (spikeMode === 'remove-after-commit' || spikeMode === 'clear-after-commit') {
+        wc.once('did-navigate', () => {
+          if (spikeMode === 'remove-after-commit') wc.navigationHistory.removeEntryAtIndex(0)
+          else wc.navigationHistory.clear()
+          mark('history-dropped-after-commit')
+        })
+      }
+      mark('target-load-start')
+      if (spikeMode === 'location-replace') {
+        const loaded = new Promise<void>((resolve) => wc.once('did-finish-load', () => resolve()))
+        void wc.executeJavaScript(`location.replace(${JSON.stringify(url)})`).catch(() => {})
+        await loaded
+      } else {
+        await wc.loadURL(url)
+      }
+      mark('target-loaded')
+      await readHistory('after-target-load')
       await waitForDocumentComplete(wc, remainingMs(FINAL_ARTIFACT_RESERVE_MS))
       await networkTracker.waitForIdle(
         NETWORK_IDLE_MS,
@@ -514,13 +597,39 @@ export const renderPageInHiddenWindow: RenderPage = async (url, { timeoutMs }) =
       )
       await sleep(Math.min(FINAL_SETTLE_MS, remainingMs(FINAL_ARTIFACT_RESERVE_MS)))
 
+      spike.frames = wc.mainFrame.framesInSubtree.map((f) => ({
+        url: f.url,
+        origin: f.origin,
+        isMainFrame: f.parent === null,
+        osProcessId: f.osProcessId,
+        processId: f.processId,
+        routingId: f.routingId
+      }))
+      spike.targets = await wc.debugger
+        .sendCommand('Target.getTargets')
+        .then((r: { targetInfos: Array<{ type: string; url: string }> }) =>
+          r.targetInfos
+            .filter((t) => /^https?:/.test(t.url))
+            .map((t) => ({ type: t.type, url: t.url }))
+        )
+        .catch((err) => String(err))
+      await readHistory('before-screenshot')
+      mark('screenshot-start')
       const screenshot = await captureFullPageScreenshot(wc)
+      mark('screenshot-end')
 
+      mark('savepage-start')
       await wc.savePage(tmpPath, 'MHTML')
+      mark('savepage-end')
+      spike.mhtml = {
+        bytes: statSync(tmpPath).size,
+        contentLocations: readFileSync(tmpPath, 'latin1').match(/^Content-Location: .*$/gm) ?? []
+      }
 
       const text = (await wc.executeJavaScript(
         'document.body ? document.body.innerText : ""'
       )) as string
+      mark('text-end')
 
       return {
         mhtmlStream: createReadStream(tmpPath) as unknown as AsyncIterable<Uint8Array>,
@@ -538,6 +647,14 @@ export const renderPageInHiddenWindow: RenderPage = async (url, { timeoutMs }) =
         }
       }
     } finally {
+      const spikeOut = process.env.BIRDBRAIN_SPIKE_OUT
+      if (spikeOut) {
+        mkdirSync(spikeOut, { recursive: true })
+        writeFileSync(
+          join(spikeOut, `render-${Date.now()}-${randomUUID()}.json`),
+          JSON.stringify(spike)
+        )
+      }
       cleanup()
     }
   }
```

### `spike-1823/run.mjs`: fixture servers and app driver

```js
// Scratch driver for the #1823 renderer spike. Starts the fixture servers, launches the
// built app the way e2e/fixtures/electronApp.ts does, and queues one Recapture per
// fixture. Usage: node spike-1823/run.mjs <out-dir>. Never merges.
import { _electron } from '@playwright/test'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = process.argv[2]
if (!OUT) throw new Error('usage: node spike-1823/run.mjs <out-dir>')
mkdirSync(join(OUT, 'tls'), { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Test CA and leaf, generated per run outside the repository; no key is committed.
const tls = (f) => join(OUT, 'tls', f)
const ssl = (...args) => execFileSync('openssl', args, { stdio: 'pipe' })
ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj',
  '/O=Birdbrain Spike/CN=Spike Test CA', '-keyout', tls('ca.key'), '-out', tls('ca.pem'))
ssl('req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/O=Birdbrain Spike/CN=localhost',
  '-keyout', tls('leaf.key'), '-out', tls('leaf.csr'))
writeFileSync(tls('leaf.ext'), 'subjectAltName=IP:127.0.0.1,DNS:localhost\nextendedKeyUsage=serverAuth\n')
ssl('x509', '-req', '-in', tls('leaf.csr'), '-CA', tls('ca.pem'), '-CAkey', tls('ca.key'),
  '-CAcreateserial', '-days', '2', '-extfile', tls('leaf.ext'), '-out', tls('leaf.pem'))
const tlsOptions = { key: readFileSync(tls('leaf.key')), cert: readFileSync(tls('leaf.pem')) }

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const page = (title, head, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head><body><h1>${title}</h1>${body}</body></html>`
const send = (type, body, headers = {}) => (_req, res) =>
  res.writeHead(200, { 'content-type': type, ...headers }).end(body)
const png = (headers) => send('image/png', PNG, headers)
const js = (body, headers) => send('text/javascript', body, headers)
const json = (headers) => send('application/json', '{"fixture":true}', headers)
const MAX_AGE = { 'cache-control': 'max-age=3600' }

const serverLog = []
const LOGGED_HEADERS = ['sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user', 'referer', 'if-none-match']
function handler(name, routes) {
  return (req, res) => {
    const headers = {}
    for (const h of LOGGED_HEADERS) if (req.headers[h]) headers[h] = req.headers[h]
    serverLog.push({ server: name, at: Date.now(), method: req.method, url: req.url, headers })
    const route = routes[req.url.split('?')[0]]
    if (route) route(req, res)
    else res.writeHead(404).end()
  }
}
async function listen(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return server.address().port
}

const main = createServer()
const child = createServer()
const hop = createServer()
const tls13 = createHttpsServer(tlsOptions)
const tls12gcm = createHttpsServer({ ...tlsOptions, maxVersion: 'TLSv1.2', ciphers: 'ECDHE-RSA-AES128-GCM-SHA256' })
const tls12cbc = createHttpsServer({ ...tlsOptions, maxVersion: 'TLSv1.2', ciphers: 'ECDHE-RSA-AES128-SHA' })
const [A, B, C, D, E, F] = await Promise.all([main, child, hop, tls13, tls12gcm, tls12cbc].map(listen))
const MAIN = `http://127.0.0.1:${A}`

const HISTORY_PAGE = page('History fixture', `<script>
window.__spikeHistory = [{ at: 'parse', length: history.length }]
addEventListener('DOMContentLoaded', () => __spikeHistory.push({ at: 'domcontentloaded', length: history.length }))
addEventListener('load', () => {
  __spikeHistory.push({ at: 'load', length: history.length })
  setTimeout(() => __spikeHistory.push({ at: 'load+1000ms', length: history.length }), 1000)
})
</script>`, '')

const CACHE_PAGE = page('Cache fixture', `
<link rel="preload" href="/cache/preload.css" as="style">
<link rel="stylesheet" href="/cache/preload.css">
<script src="/cache/script-then-fetch.js"></script>
<script src="/cache/script-twice.js"></script>
<script src="/cache/shared-with-frame.js"></script>`, `
<img src="/cache/img-twice-later.png" width="20" height="20">
<iframe src="/cache/frame" width="100" height="40"></iframe>
<script>
addEventListener('load', async () => {
  await new Promise((r) => setTimeout(r, 300))
  await fetch('/cache/script-then-fetch.js')
  await new Promise((r) => { const s = document.createElement('script'); s.src = '/cache/script-twice.js'; s.onload = s.onerror = r; document.head.append(s) })
  await new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = '/cache/img-twice-later.png' })
  await fetch('/cache/force-cache.json', { cache: 'force-cache' })
  await fetch('/cache/force-cache.json', { cache: 'force-cache' })
  await fetch('/cache/max-age.json')
  await fetch('/cache/max-age.json')
  await fetch('/cache/etag.json')
  await fetch('/cache/etag.json')
})
</script>`)

main.on('request', handler('main', {
  '/filters.txt': send('text/plain', '###spike-cmp-banner\n/spike-cmp-blocked.js\n'),
  '/consent': send('text/html', page('Consent fixture',
    '<script src="/spike-cmp-blocked.js"></script>',
    `<div id="spike-cmp-banner">Fixture consent banner</div>
<img src="/spike-cmp-blocked.js?as=img" width="20" height="20">
<img src="/consent-allowed.png" width="20" height="20">
<script>fetch('/spike-cmp-blocked.js?as=fetch').catch(() => {})</script>`)),
  '/spike-cmp-blocked.js': js('window.cmpLoaded = true'),
  '/consent-allowed.png': png(),
  '/savepage': send('text/html', page('Savepage fixture',
    '<link rel="icon" href="/savepage/icon.png"><link rel="stylesheet" href="/savepage/style.css">',
    `<img src="/savepage/cacheable.png" width="40" height="40">
<img src="/savepage/nostore.png" width="40" height="40">
<img srcset="/savepage/srcset-1x.png 1x, /savepage/srcset-2x.png 2x" width="40" height="40">
<iframe src="/savepage/frame" width="200" height="80"></iframe>
<div style="height:3000px"></div>
<img loading="lazy" src="/savepage/lazy.png" width="40" height="40">`)),
  '/savepage/style.css': send('text/css',
    '@font-face{font-family:SpikeFont;src:url(/savepage/font.woff2)}' +
    'body{font-family:SpikeFont,sans-serif;background:url(/savepage/bg.png)}' +
    '@media print{body{background:url(/savepage/print-only.png)}}'),
  '/savepage/font.woff2': send('font/woff2', Buffer.from('not a real font')),
  '/savepage/icon.png': png(),
  '/savepage/bg.png': png({ 'cache-control': 'no-store' }),
  '/savepage/print-only.png': png(),
  '/savepage/cacheable.png': png(MAX_AGE),
  '/savepage/nostore.png': png({ 'cache-control': 'no-store' }),
  '/savepage/srcset-1x.png': png(),
  '/savepage/srcset-2x.png': png(),
  '/savepage/lazy.png': png({ 'cache-control': 'no-store' }),
  '/savepage/frame': send('text/html', page('Savepage frame', '', '<img src="/savepage/frame-nostore.png">'),
    { 'cache-control': 'no-store' }),
  '/savepage/frame-nostore.png': png({ 'cache-control': 'no-store' }),
  '/frame-parent': send('text/html', page('Cross-site frame parent', '',
    `<img src="/frame-parent.png"><iframe src="http://localhost:${B}/frame-child" width="300" height="100"></iframe>`)),
  '/frame-parent.png': png(),
  '/redirect-start': (_req, res) =>
    res.writeHead(302, { location: `http://127.0.0.1:${C}/redirect-end` }).end(),
  '/cache': send('text/html', CACHE_PAGE),
  '/cache/preload.css': send('text/css', 'h1{color:#333}', MAX_AGE),
  '/cache/script-then-fetch.js': js('window.a = 1', MAX_AGE),
  '/cache/script-twice.js': js('window.b = (window.b || 0) + 1', MAX_AGE),
  '/cache/shared-with-frame.js': js('window.c = 1', MAX_AGE),
  '/cache/img-twice-later.png': png(MAX_AGE),
  '/cache/frame': send('text/html', page('Cache frame', '<script src="/cache/shared-with-frame.js"></script>', '')),
  '/cache/force-cache.json': json(MAX_AGE),
  '/cache/max-age.json': json(MAX_AGE),
  '/cache/etag.json': (req, res) => {
    if (req.headers['if-none-match'] === '"spike-1"') return res.writeHead(304, { etag: '"spike-1"' }).end()
    json({ 'cache-control': 'no-cache', etag: '"spike-1"' })(req, res)
  },
  '/history': send('text/html', HISTORY_PAGE),
  '/slow-idle': send('text/html', page('Slow idle fixture', '', "<script>fetch('/slow')</script>")),
  '/slow': (_req, res) => setTimeout(() => res.writeHead(200, { 'content-type': 'text/plain' }).end('slow'), 5000)
}))
child.on('request', handler('child', {
  '/frame-child': send('text/html', page('Cross-site frame child',
    '<link rel="stylesheet" href="/frame-child.css">',
    "<img src=\"/frame-child.png\"><script>fetch('/frame-child.json')</script>")),
  '/frame-child.css': send('text/css', 'h1{color:#555}'),
  '/frame-child.png': png(),
  '/frame-child.json': json()
}))
hop.on('request', handler('hop', {
  '/redirect-end': send('text/html', page('Redirect end', '', '<img src="/redirect-end.png">')),
  '/redirect-end.png': png()
}))
for (const [name, server] of [['tls13', tls13], ['tls12gcm', tls12gcm], ['tls12cbc', tls12cbc]]) {
  server.on('request', handler(name, {
    '/tls': send('text/html', page('TLS fixture', '', '<img src="/tls.png">')),
    '/tls.png': png()
  }))
}

const RUNS = [
  ['q1-playwright-session', 1, `${MAIN}/slow-idle`],
  ['q2-savepage', 2, `${MAIN}/savepage`],
  ['q3-consent-network-rule', 3, `${MAIN}/consent`],
  ['q4-cross-site-iframe', 4, `${MAIN}/frame-parent`],
  ['q4-cross-port-redirect', 4, `${MAIN}/redirect-start`],
  ['q5-cache', 5, `${MAIN}/cache`],
  ['q6-tls13', 6, `https://127.0.0.1:${D}/tls`],
  ['q6-tls12-gcm', 6, `https://127.0.0.1:${E}/tls`],
  ['q6-tls12-cbc', 6, `https://127.0.0.1:${F}/tls`],
  ...['keep', 'direct', 'clear-before', 'reset-cdp', 'location-replace', 'remove-after-commit',
    'clear-after-commit'].map((m) => [`q7-history-${m}`, 7, `${MAIN}/history?spike-mode=${m}`])
]

// Launch exactly as e2e/fixtures/electronApp.ts does: settings and signing key seeded.
const userData = mkdtempSync(join(tmpdir(), 'spike-1823-userdata-'))
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ operatorName: 'Spike Operator' }))
const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})
writeFileSync(join(userData, 'signing-key.pem'), keys.privateKey)
writeFileSync(join(userData, 'signing-public-key.pem'), keys.publicKey)
const app = await _electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  cwd: REPO,
  env: {
    ...process.env,
    BIRDBRAIN_USER_DATA: userData,
    BIRDBRAIN_SPIKE_OUT: join(OUT, 'renders'),
    BIRDBRAIN_SPIKE_TEST_CERT: tls('leaf.pem'),
    BIRDBRAIN_CONSENT_LISTS: `${MAIN}/filters.txt`
  }
})
const results = []
try {
  const win = await app.firstWindow()
  await win.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 })
  const { id: caseId } = await win.evaluate(() => window.birdbrain.cases.create({ name: 'Renderer spike' }))
  for (const [name, question, url] of RUNS) {
    const startedAt = Date.now()
    const enqueued = await win.evaluate((p) => window.birdbrain.recapture.enqueue(p), { urls: [url], caseId })
    let playwright = null
    if (name === 'q1-playwright-session') {
      // Is Playwright attached to the hidden window, and can it still evaluate there?
      for (let i = 0; i < 40 && !playwright; i++) {
        const hidden = app.windows().find((p) => p.url() === url)
        if (hidden) {
          playwright = await hidden.evaluate(() => ({ title: document.title, href: location.href }))
            .then((r) => ({ found: true, evaluated: r }))
            .catch((err) => ({ found: true, error: String(err) }))
        } else await sleep(100)
      }
      playwright ??= { found: false, windowUrls: app.windows().map((p) => p.url()) }
    }
    for (;;) {
      await sleep(250)
      const status = await win.evaluate(() => window.birdbrain.recapture.queueStatus())
      if (status.pending === 0 && status.activeUrl === null) break
    }
    results.push({ name, question, url, enqueued, playwright, startedAt, endedAt: Date.now() })
    console.log(name, JSON.stringify(enqueued), playwright ? JSON.stringify(playwright) : '')
  }
  const captures = await win.evaluate((id) => window.birdbrain.captures.list(id), caseId)
  console.log('captures stored:', captures.length)
} finally {
  await app.close().catch(() => {})
  rmSync(userData, { recursive: true, force: true })
  for (const s of [main, child, hop, tls13, tls12gcm, tls12cbc]) s.close()
  writeFileSync(join(OUT, 'runs.json'), JSON.stringify(results, null, 2))
  writeFileSync(join(OUT, 'server-log.json'), JSON.stringify(serverLog, null, 2))
}
```

### `spike-1823/assemble.mjs`

```js
// Scratch: joins the renderer's per-render files with the run list and the fixture
// server log into the committed event-stream JSON.
// Usage: node spike-1823/assemble.mjs <out.json> <e2e-dir> <fixture-dir>. Never merges.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'

const [outFile, e2eDir, fixtureDir] = process.argv.slice(2)
const read = (f) => JSON.parse(readFileSync(f, 'utf8'))
const renders = (dir) =>
  readdirSync(join(dir, 'renders')).filter((f) => f.endsWith('.json')).sort()
    .map((f) => read(join(dir, 'renders', f)))
const shape = (name, question, r, extra = {}) => ({
  name, question, url: r.url, mode: r.mode, enableError: r.enableError,
  childSessionIds: r.sessionIds, markers: r.markers, frames: r.frames, targets: r.targets,
  history: r.history, mhtml: r.mhtml, ...extra, events: r.events
})

// The e2e run launches the app once per spec: the consent spec renders once, and
// recapture.spec.ts renders twice (a capture, then its Recapture).
const byPid = new Map()
for (const r of renders(e2eDir)) byPid.set(r.pid, [...(byPid.get(r.pid) ?? []), r])
const e2eRuns = []
for (const group of byPid.values()) {
  if (group.length === 1) e2eRuns.push(shape('q1-e2e-recapture-consent', 1, group[0]))
  else if (group.length === 2) group.forEach((r, i) => e2eRuns.push(shape(`q1-e2e-recapture-${i + 1}`, 1, r)))
  else throw new Error(`unexpected e2e render group of ${group.length}`)
}

const fixtureRenders = renders(fixtureDir)
const serverLog = read(join(fixtureDir, 'server-log.json'))
const fixtureRuns = read(join(fixtureDir, 'runs.json')).map((run) => {
  const matches = fixtureRenders.filter((r) => r.url === run.url)
  if (matches.length !== 1) throw new Error(`${run.name}: ${matches.length} renders`)
  return shape(run.name, run.question, matches[0], {
    playwright: run.playwright ?? undefined,
    serverLog: serverLog.filter((e) => e.at >= run.startedAt && e.at <= run.endedAt)
  })
})

const { electron, chrome, node, v8 } = fixtureRenders[0].versions
const osName = readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="(.*)"$/m)[1]
writeFileSync(outFile, JSON.stringify({
  issue: 1823,
  cutFrom: execFileSync('git', ['merge-base', 'HEAD', 'origin/main']).toString().trim(),
  versions: { electron, chrome, node, v8 },
  os: `${osName}, Linux ${release()}`,
  runs: [...e2eRuns, ...fixtureRuns]
}, null, 1) + '\n')
```
