# Transaction Record charset spike: the served bytes of a text response

**Date:** 2026-10-26

**Status:** Complete. A measurement, not a decision. It recommended a collector change for step 9,
and the maintainer ruled on its three questions on 2026-10-26 (see "Rulings, 2026-10-26").

**Frame of reference:** every run used a checkout of `50966b79` (`origin/main` on 2026-10-26).
Citations of the writer point at `b4e11287`, the head of `feat/1906-warc-writer` (PR #1979) on the
same day.

This spike answers the four questions of #1983. The review of PR #1979 measured that
`Network.getResponseBody` hands a text body back as a string decoded from the page's character
set, so the writer stores bytes the server did not send (PR #1979, review comment `6413786610`).
A scratch Electron harness served invented fixtures from a local server, fetched each body through
every Chrome DevTools Protocol (CDP) path that might return the served bytes, and compared what the
writer would store with what the server sent. The per-response results are in
[the results file](2026-10-26-transaction-record-charset-spike-results.json). The harness, the
queries quoted below, the scratch renderer change, and every command with its exit code are under
"Reproduce".

## Verdicts

| Question | Verdict |
| --- | --- |
| 1. A path that returns the served bytes | `Network.getResponseBody` on a session that was sent `Network.configureDurableMessages`: all 23 fixture responses, as base64 for each body that is not valid UTF-8 and as a string for each body that is. The `Fetch` domain at the response stage also returns them, always as base64. Plain `Network.getResponseBody` returned 16 of the 23 as something else. |
| 2. Cost | Durable messages pause no request. Over 15 loads of a page with 151 requests, the median was 503 ms with them and 529 ms with no body fetched at all. Consent cancellations and D17's attach order behave as without them. The page's copy of a response that a service worker answered returns no body. The `Fetch` path paused all 151 requests and raised the median by 152 ms without fetching bodies and by 288 ms with them, and `Fetch.enable` does not exist on a worker session. |
| 3. `Network.enable` and Playwright | Works with both. It works after `Network.enable` with the renderer spike's limits and D17's auto-attach, under Playwright's Electron driver, and in both Recapture e2e specs with a scratch renderer that sends the command (2 passed, exit 0). |
| 4. If no path exists | Does not arise on Electron 44.9.1. Where the durable store holds no body, `Network.getResponseBody` returned an error, never a decoded string, so the record omits the body. A session that was never sent `Network.configureDurableMessages` returns decoded strings, so a session where the command fails or does not answer is the case left, and the recommendation's fourth item covers it. |

## Recommendation

The collector change is four items for step 9, the step that wires the collector to a render.

1. On the page's session, send `Network.configureDurableMessages` with the limits `Network.enable`
   gets, once `Network.enable` answers and before the target loads.
2. On each attached `iframe` or `worker` session, send it together with `Network.enable` and
   `Target.setAutoAttach`, and resume once all three answer or D17's child setup bound runs out.
   On a `service_worker` session, send it
   with the other three commands together. D17's order is otherwise unchanged (plan, D17, "The
   attach", items 2 and 3).
3. Count a target in `recordedTargets` only when its `Network.configureDurableMessages` answered
   too (plan, D17, "The two counts").
4. Keep a string body only from a session whose `Network.configureDurableMessages` answered. On any
   other session, treat a string body as not returned, so the exchange counts as `body-omitted`.
   Keep a base64 body from any session: every base64 body plain `Network.getResponseBody` returned
   matched the served bytes (Question 1, last query).

The protocol offers a second switch, `enableDurableMessages` on `Network.enable`, and describes it
as "being deprecated in favor of the dedicated configureDurableMessages command, due to the
possibility of deadlocks when awaiting Network.enable before issuing
Runtime.runIfWaitingForDebugger". D17 awaits `Network.enable` before the resume on frames and
workers, so item 2 uses the dedicated command. Neither switch deadlocked in these runs.

**The marker.** PR #1979's writer adds `x-birdbrain-decoded-text: utf-8` to every record whose
body arrived with `base64Encoded: false` (`src/packages/transaction-record/lib/write.ts:26`,
`:88-93`, `:155`, and `:188` at `b4e11287`). Under the durable path, a string body is the served
bytes: the UTF-8 encoding of each string equalled them, a byte-order mark included. The marker
would then state a re-encoding that did not happen, so it goes, with the `warcinfo` sentence that
announces it (`:32-35`). Until the collector change lands, the writer's input is plain
`Network.getResponseBody`, for which the marker is true. The marker should therefore leave in the
same pull request as items 1 to 4. Step 9's pull request is that pull request, because step 9
makes the format live. The rest of the decoded-bodies statement stays true: the durable path
returned the gzip fixture with its content coding removed.

**The known-answer test.** The design's known-answer row "each payload digest in the WARC equals
the digest of the fixture's decoded payload" (capture engine design, Validation) needs the stored
body to equal the decoded payload. Every durable result here does, and 16 plain results do not.
Step 9's fixture page can pin the row with a windows-1252 body, a Shift_JIS body, a UTF-8 body
with a byte-order mark, and UTF-8 bytes under a windows-1252 label. On the plain path each of the
four came back as other bytes. This spike ran no writer, so it shows the bytes and not the digests.

## Rulings this asks for

1. **The collector change.** Adopt items 1 to 4, and remove the marker in step 9's pull request.
   This amends D8's "Text bodies" ruling of 2026-10-26.
2. **Service-worker responses.** Under durable messages, the page's exchange for a request a
   service worker answered returns `No data found for resource with given identifier`, so it
   counts in `bodiesOmitted`. The worker's own exchange for the same response, on the worker's
   session, holds the served bytes (Question 2, service workers). On the plain path both copies
   came back decoded. D17 already records the two as separate exchanges.
3. **The per-resource limit.** The durable store returned a 9,000,000-byte and a 12,000,000-byte
   body under `maxResourceBufferSize` 1,000,000. A `maxTotalBufferSize` of 1,000,000 refused both
   (Question 2, large bodies). D4's `budget` records the two limits passed to `Network.enable`, so
   a reader takes "over the budget" to mean those limits. If the record states a per-resource
   limit, step 9 has to enforce it itself. D17 item 7 already makes the engine's own cap the bound
   on the total.

## Rulings, 2026-10-26

The maintainer ruled on the three questions above on 2026-10-26.

1. **The collector change: adopted.** Step 9 makes the collector change as the Recommendation
   states it. A target counts as recorded only when its `Network.configureDurableMessages`
   answered, and the collector keeps a text body only from such a session. Step 9's pull request
   removes the `x-birdbrain-decoded-text` marker and its `warcinfo` sentence.
2. **Service-worker responses: accepted.** A page's copy of a response that a service worker
   answered becomes `body-omitted`.
3. **The per-resource limit: step 9 applies it.** Step 9 applies the per-resource limit itself
   before it keeps a body, and records an oversized body as omitted.

## Environment

- **Runtime the harness reported.** `process.versions` in the harness: Electron 44.9.1, Chromium
  152.0.7977.167, Node 24.22.0, V8 15.2.124.43-electron.0. The browser's `/json/version` reported
  `Chrome/152.0.7977.167` and protocol version 1.3. `package.json` pins `electron` at `^44.9.1`,
  and `node_modules/electron/package.json` read 44.9.1.
- **Operating system.** `PRETTY_NAME="Omarchy"` in `/etc/os-release`, Linux 7.2.8-9-omarchy,
  x86_64. Every Electron run
  used `xvfb-run --auto-servernum` with `XDG_SESSION_TYPE=x11`; `ELECTRON_RUN_AS_NODE` and
  `WAYLAND_DISPLAY` were unset in the shell.
- **Tooling.** Node 20.20.2 and pnpm 10.28.2 for the scripts, Playwright 1.64.1, jq 1.8.2,
  Gitleaks 8.30.1.
- **Host load.** Other sessions shared the host: `/proc/loadavg` read 18.03 before the 15-run
  latency pass and 24.16 after it, on 18 cores. The latency figures carry that noise.

## Method

### The harness

`main.cjs` (under "Reproduce") is a standalone Electron main script, not the app. Each render
opens a window with the options `renderPageInHiddenWindow` gives its own
(`src/main/services/backgroundRenderer.ts`): `show: false`, `offscreen: true`, `sandbox: true`,
`contextIsolation: true`, and a fresh `spike-<uuid>` partition. Then it:

1. attaches `wc.debugger` with protocol 1.3 and loads `about:blank`;
2. sends `Network.enable` with `maxTotalBufferSize: 50e6, maxResourceBufferSize: 10e6`, the
   renderer spike's limits, under a 10 s bound, and the same limits on every child session, as D17
   item 7 has it;
3. sends `Target.setAutoAttach` with `autoAttach`, `waitForDebuggerOnStart`, and `flatten` on the
   page's session, and sets up each attached target in D17's order: on an `iframe` or `worker`,
   `Network.enable`, `Target.setAutoAttach`, and the path's own setup command together, each under
   a 2 s bound, then `Runtime.runIfWaitingForDebugger`; on a `service_worker`, all of them at once;
4. sends the path's setup command on the page's session, then loads the target;
5. waits for the load, then for the page's title to read `done` where the fixture sets one, then
   500 ms or the mode's settle time, then for every outstanding command.

For each body a path returns, the harness converts it to bytes the way PR #1979's writer does
(`stored`, `write.ts:88-93` at `b4e11287`): base64 is decoded, and a string is encoded as UTF-8. It
then compares those bytes with the fixture's served body, which is the body before any content
coding.

### The body paths

The protocol the pinned browser serves at `/json/protocol` lists every command below, so none is
missing (Question 1, first query).

| Path | What the harness sends |
| --- | --- |
| `network` | `Network.getResponseBody` on each `Network.loadingFinished`, on that event's session. This is what plan D17 item 6 specifies. |
| `durableConfigure` | As `network`, after `Network.configureDurableMessages` with the same limits on every session. |
| `durableEnable` | As `network`, with `enableDurableMessages: true` added to every `Network.enable`. |
| `fetch` | `Fetch.enable` with `{ urlPattern: '*', requestStage: 'Response' }` on every session, then on each `Fetch.requestPaused` `Fetch.getResponseBody` and `Fetch.continueRequest`. |
| `fetchStream` | As `fetch`, but `Fetch.takeResponseBodyAsStream` and `IO.read` to the end, then `Fetch.fulfillRequest` with the bytes, because taking the stream consumes the body. |
| `stream` | `Network.streamResourceContent` on each `Network.responseReceived`, then the returned `bufferedData` plus the `data` of each later `Network.dataReceived`. |
| `loadNetworkResource` | After the load, `Network.loadNetworkResource` for each fixture URL in the page's frame, then `IO.read`. |
| `pageResource` | After the load, `Page.getResourceContent` for each fixture URL, first without `Page.enable` and, when that fails, again after it. |

### Fixtures

`fixtures.cjs` serves every fixture from `127.0.0.1` on a free port, with `cache-control:
no-store`. Each body is invented.

| Fixture | `Content-Type` | Served bytes |
| --- | --- | --- |
| `w1252` | `text/html; charset=windows-1252` | `<p>café</p>` in windows-1252 |
| `sjis` | `text/html; charset=Shift_JIS` | `<p>日本</p>` in Shift_JIS |
| `bom` | `text/html; charset=utf-8` | a UTF-8 byte-order mark, then `<p>ab</p>` |
| `invalid` | `text/html; charset=utf-8` | `<p>a`, the byte `ff`, `b</p>` |
| `gzip1252` | `text/html; charset=windows-1252` | `w1252`'s bytes, sent with `Content-Encoding: gzip` |
| `nolabel` | `text/html` | `w1252`'s bytes, with no charset |
| `utf8` | `text/html; charset=utf-8` | `<p>café</p>` in UTF-8 |
| `plain1252` | `text/plain; charset=windows-1252` | `café` in windows-1252 |
| `mojibake` | `text/html; charset=windows-1252` | `utf8`'s bytes, valid UTF-8 under a windows-1252 label |
| `utf16` | `text/html; charset=utf-16` | `<p>ab</p>` in UTF-16LE after its byte-order mark |
| `css1252`, `js1252` | `text/css` and `text/javascript`, `charset=windows-1252` | a comment holding `café` |
| `png` | `image/png` | a 1 x 1 PNG |
| `big1252`, `under1252` | `text/html; charset=windows-1252` | 12,000,000 and 9,000,000 bytes of `e9` |

The `paths` mode loads each of the first ten fixtures as the main document, then a host page that
loads `css1252`, `js1252`, and `png` by tag and `fetch`es the first ten with `?sub`. That is 23
responses per path. Other modes, named under each question, add slow, consent, frame, worker, and
latency pages.

### How this differs from a production render

- The harness is a standalone script: it runs no consent blocker except in the consent mode, no
  idle tracker, no scroll phase, no screenshot, and no `savePage`.
- The fixture server is HTTP/1.1 on loopback, so no run measured HTTP/2, HTTP/3, TLS, or a proxy.
- Only the Playwright mode and the e2e run have a second CDP client attached.

## Question 1: which path returns the served bytes

**Question.** "Which CDP path, if any, returns the decoded-content-coding bytes the server sent for
a text response: `Network.getResponseBody`, `Fetch.getResponseBody` at the response stage,
`Network.streamResourceContent` with `IO.read`, or another? Record the exact `base64Encoded` value
and bytes each returns."

**Observed.** Every query on this page runs against the committed results file, with `J` set as
in the first line below. The commands the pinned protocol lists, from `/json/protocol`:

```shell
J=docs/specs/2026-10-26-transaction-record-charset-spike-results.json
jq -r '.commands[] | [.command, "experimental=\(.experimental)", "deprecated=\(.deprecated)"] | @tsv' "$J"
```

```text
Fetch.enable	experimental=false	deprecated=false
Fetch.fulfillRequest	experimental=false	deprecated=false
Fetch.continueRequest	experimental=false	deprecated=false
Fetch.getResponseBody	experimental=false	deprecated=false
Fetch.takeResponseBodyAsStream	experimental=false	deprecated=false
IO.close	experimental=false	deprecated=false
IO.read	experimental=false	deprecated=false
Network.enable	experimental=false	deprecated=false
Network.configureDurableMessages	experimental=true	deprecated=false
Network.getResponseBody	experimental=false	deprecated=false
Network.getResponseBodyForInterception	experimental=true	deprecated=false
Network.takeResponseBodyForInterceptionAsStream	experimental=true	deprecated=false
Network.setRequestInterception	experimental=true	deprecated=true
Network.streamResourceContent	experimental=true	deprecated=false
Network.loadNetworkResource	experimental=true	deprecated=false
Page.getResourceContent	experimental=true	deprecated=false
```

The two `ForInterception` commands act on an intercepted request, and the command that intercepts
for them is deprecated:

```shell
jq -r '.commands[] | select(.command | test("ForInterception|setRequestInterception")) | "\(.command): \(.description | split("\n")[0])"' "$J"
```

```text
Network.getResponseBodyForInterception: Returns content served for the given currently intercepted request.
Network.takeResponseBodyForInterceptionAsStream: Returns a handle to the stream representing the response body. Note that after this command,
Network.setRequestInterception: Sets the requests to intercept that match the provided patterns and optionally resource types.
```

The full description of `Network.setRequestInterception` in the results file ends "Deprecated,
please use Fetch.enable instead.", so the harness intercepted through `Fetch` only. Per path, how
many of the 23 responses came back as the served bytes:

```shell
jq -r '.paths | group_by(.path) | .[] | [.[0].path, "rows=\(length)", "match=\(map(select(.matchesServed == true)) | length)", "differ=\(map(select(.matchesServed == false)) | length)", "error=\(map(select(.error != null)) | length)"] | @tsv' "$J"
```

```text
durableConfigure	rows=23	match=23	differ=0	error=0
durableEnable	rows=23	match=23	differ=0	error=0
fetch	rows=23	match=23	differ=0	error=0
fetchStream	rows=23	match=23	differ=0	error=0
loadNetworkResource	rows=23	match=23	differ=0	error=0
network	rows=23	match=7	differ=16	error=0
pageResource	rows=34	match=1	differ=2	error=31
stream	rows=23	match=10	differ=3	error=10
```

`pageResource` has 34 rows because the first attempt without `Page.enable` is a row of its own.
The exact bytes for the ten main documents, plain against durable:

```shell
jq -r '.paths[] | select(.kind == "document" and (.path == "network" or .path == "durableConfigure")) | [.path, .url, .servedHex, "base64Encoded=\(.base64Encoded)", .storedHex, "match=\(.matchesServed)"] | @tsv' "$J"
```

```text
network	/w1252	3c703e636166e93c2f703e	base64Encoded=false	3c703e636166c3a93c2f703e	match=false
network	/sjis	3c703e93fa967b3c2f703e	base64Encoded=false	3c703ee697a5e69cac3c2f703e	match=false
network	/bom	efbbbf3c703e61623c2f703e	base64Encoded=false	3c703e61623c2f703e	match=false
network	/invalid	3c703e61ff623c2f703e	base64Encoded=true	3c703e61ff623c2f703e	match=true
network	/gzip1252	3c703e636166e93c2f703e	base64Encoded=false	3c703e636166c3a93c2f703e	match=false
network	/nolabel	3c703e636166e93c2f703e	base64Encoded=true	3c703e636166e93c2f703e	match=true
network	/utf8	3c703e636166c3a93c2f703e	base64Encoded=false	3c703e636166c3a93c2f703e	match=true
network	/plain1252	636166e9	base64Encoded=false	636166c3a9	match=false
network	/mojibake	3c703e636166c3a93c2f703e	base64Encoded=false	3c703e636166c383c2a93c2f703e	match=false
network	/utf16	fffe3c0070003e00610062003c002f0070003e00	base64Encoded=false	3c703e61623c2f703e	match=false
durableConfigure	/w1252	3c703e636166e93c2f703e	base64Encoded=true	3c703e636166e93c2f703e	match=true
durableConfigure	/sjis	3c703e93fa967b3c2f703e	base64Encoded=true	3c703e93fa967b3c2f703e	match=true
durableConfigure	/bom	efbbbf3c703e61623c2f703e	base64Encoded=false	efbbbf3c703e61623c2f703e	match=true
durableConfigure	/invalid	3c703e61ff623c2f703e	base64Encoded=true	3c703e61ff623c2f703e	match=true
durableConfigure	/gzip1252	3c703e636166e93c2f703e	base64Encoded=true	3c703e636166e93c2f703e	match=true
durableConfigure	/nolabel	3c703e636166e93c2f703e	base64Encoded=true	3c703e636166e93c2f703e	match=true
durableConfigure	/utf8	3c703e636166c3a93c2f703e	base64Encoded=false	3c703e636166c3a93c2f703e	match=true
durableConfigure	/plain1252	636166e9	base64Encoded=true	636166e9	match=true
durableConfigure	/mojibake	3c703e636166c3a93c2f703e	base64Encoded=false	3c703e636166c3a93c2f703e	match=true
durableConfigure	/utf16	fffe3c0070003e00610062003c002f0070003e00	base64Encoded=true	fffe3c0070003e00610062003c002f0070003e00	match=true
```

The `servedHex` column is the body before content coding, so `gzip1252` reads as `w1252`'s bytes.
The plain path reproduces the review's readings for `w1252`, `sjis`, `bom`, and `invalid`. It also
decodes UTF-8 bytes by the windows-1252 label (`mojibake`, `c3a9` becomes `c383c2a9`) and decodes
the UTF-16 body to `<p>ab</p>`. The three subresource types:

```shell
jq -r '.paths[] | select(.kind == "subresource" and (.url | test("css1252|js1252|png"))) | select(.path == "network" or .path == "durableConfigure" or .path == "fetch") | [.path, .url, "base64Encoded=\(.base64Encoded)", "match=\(.matchesServed)"] | @tsv' "$J"
```

```text
network	/css1252?sub	base64Encoded=false	match=false
network	/png?sub	base64Encoded=true	match=true
network	/js1252?sub	base64Encoded=false	match=false
durableConfigure	/css1252?sub	base64Encoded=true	match=true
durableConfigure	/js1252?sub	base64Encoded=true	match=true
durableConfigure	/png?sub	base64Encoded=true	match=true
fetch	/css1252?sub	base64Encoded=true	match=true
fetch	/js1252?sub	base64Encoded=true	match=true
fetch	/png?sub	base64Encoded=true	match=true
```

Every string the two durable paths returned, as JSON:

```shell
jq -r '.paths[] | select((.path | startswith("durable")) and .base64Encoded == false) | [.path, .kind, .url, (.returned | @json)] | @tsv' "$J"
```

```text
durableEnable	document	/bom	"﻿<p>ab</p>"
durableEnable	document	/utf8	"<p>café</p>"
durableEnable	document	/mojibake	"<p>café</p>"
durableEnable	subresource	/bom?sub	"﻿<p>ab</p>"
durableEnable	subresource	/utf8?sub	"<p>café</p>"
durableEnable	subresource	/mojibake?sub	"<p>café</p>"
durableConfigure	document	/bom	"﻿<p>ab</p>"
durableConfigure	document	/utf8	"<p>café</p>"
durableConfigure	document	/mojibake	"<p>café</p>"
durableConfigure	subresource	/bom?sub	"﻿<p>ab</p>"
durableConfigure	subresource	/utf8?sub	"<p>café</p>"
durableConfigure	subresource	/mojibake?sub	"<p>café</p>"
```

Each `bom` string starts with U+FEFF, which the terminal does not show. The strings are exactly
the three fixtures whose bytes are valid UTF-8 and not plain ASCII. Each string decodes those bytes
as UTF-8, whatever the label says, so `mojibake` reads `café` and not `cafÃ©`. Every other durable
body came back as base64. Both `Fetch` paths returned base64 every time:

```shell
jq -r '[.paths[] | select(.path == "fetch" or .path == "fetchStream") | .base64Encoded] | group_by(.) | map("base64Encoded=\(.[0]) rows=\(length)") | .[]' "$J"
```

```text
base64Encoded=true rows=46
```

The two paths that did not return the served bytes:

```shell
jq -r '[.paths[] | select(.path == "stream" or .path == "pageResource") | [.path, .kind, .method, (.error // (if .matchesServed then "matches" else "differs" end))] | join(" | ")] | group_by(.) | map("\(length) x \(.[0])") | .[]' "$J"
```

```text
10 x pageResource | document | Page.getResourceContent (no Page.enable) | Agent is not enabled.
10 x pageResource | document | Page.getResourceContent | Content unavailable. Resource was not cached
1 x pageResource | subresource | Page.getResourceContent (no Page.enable) | Agent is not enabled.
10 x pageResource | subresource | Page.getResourceContent | No resource with given URL found
2 x pageResource | subresource | Page.getResourceContent | differs
1 x pageResource | subresource | Page.getResourceContent | matches
10 x stream | document | Network.streamResourceContent | matches
10 x stream | subresource | Network.streamResourceContent | Request with the provided ID has already finished loading
3 x stream | subresource | Network.streamResourceContent | differs
```

`Page.getResourceContent` returned only the stylesheet, the script, and the image. It returned the
first two decoded and the image intact. `Network.streamResourceContent` returned an error for ten
`fetch` subresources that had finished before the command arrived. For the stylesheet, the script,
and the image it returned an empty buffer and no data after it. The `slow` mode serves half of each
body, waits 800 ms, and sends the rest; there the stream returned the served bytes every time:

```shell
jq -r '.slowStream[] | [.url, "bufferedLength=\(.bufferedLength)", "dataChunks=\(.dataChunks)", "match=\(.matchesServed)"] | @tsv' "$J"
```

```text
/slow-w1252?gap=800	bufferedLength=5	dataChunks=1	match=true
/slow-sjis?gap=800	bufferedLength=5	dataChunks=1	match=true
/slow-bom?gap=800	bufferedLength=6	dataChunks=1	match=true
/slow-invalid?gap=800	bufferedLength=5	dataChunks=1	match=true
/slow-gzip1252?gap=800	bufferedLength=4	dataChunks=1	match=true
/slow-nolabel?gap=800	bufferedLength=5	dataChunks=1	match=true
/slow-utf8?gap=800	bufferedLength=6	dataChunks=1	match=true
/slow-plain1252?gap=800	bufferedLength=4	dataChunks=0	match=true
/slow-mojibake?gap=800	bufferedLength=6	dataChunks=1	match=true
/slow-utf16?gap=800	bufferedLength=10	dataChunks=1	match=true
```

`Network.loadNetworkResource` matched every time, but it asks the server again. The server logged
nine requests for each fixture over eight renders, the ninth from this path. `/host`, which the
path does not fetch, logged eight:

```shell
jq -r '.pathsServerRequests[] | select(.url == "/w1252" or .url == "/w1252?sub" or .url == "/host") | [.url, .requests] | @tsv' "$J"
```

```text
/w1252	9
/host	8
/w1252?sub	9
```

The server logged a tenth request for `/css1252?sub`, which the browser reported in none of the
eight renders' `Network.requestWillBeSent` events. Not traced. Last, every base64 body the plain
path returned:

```shell
jq -r '.paths[] | select(.path == "network" and .base64Encoded == true) | [.kind, .url, "match=\(.matchesServed)"] | @tsv' "$J"
```

```text
document	/invalid	match=true
document	/nolabel	match=true
subresource	/png?sub	match=true
subresource	/invalid?sub	match=true
subresource	/nolabel?sub	match=true
```

**Verdict.** `Network.getResponseBody` after `Network.configureDurableMessages` returns the served
bytes, with content coding removed, for all 23 responses. It returned `base64Encoded: true` and
the bytes for every body that is not valid UTF-8, and `base64Encoded: false` and a string for the
three that are. Each string's UTF-8 encoding equals the served bytes, a byte-order mark included.
`enableDurableMessages` on `Network.enable` gave the same 23 results. `Fetch.getResponseBody`, and
`Fetch.takeResponseBodyAsStream` with `IO.read`, at the response stage return the same bytes,
always as base64. `Network.streamResourceContent` returns them only for a response still loading
when the command arrives. `Network.loadNetworkResource` returns the bytes of a second request, not
of the exchange recorded. `Page.getResourceContent` holds only some resources and decodes text.
Plain `Network.getResponseBody` returns the served bytes only for valid UTF-8 and for what it
returns as base64.

## Question 2: what each path costs

**Question.** "What does each path cost: interception of every request, added latency, interaction
with the consent filter's cancellations and with the out-of-process frame sessions of D17?"

Question 1 leaves two candidates: the durable path and the `Fetch` path. This question measures
both, with the plain path as the reference.

### Latency

**Run.** The `latency` mode loads a page with 50 images, 50 stylesheets, and 50 `fetch`es, which
is 151 requests with the page. Each repetition loads it under five configurations in turn: `none`
(`Network.enable` and no body fetched), `network`, `durableConfigure`, `fetch` without
`Fetch.getResponseBody`, and `fetch` with it. `doneMs` runs from the `loadURL` call to the page's
title reading `done`, set when every `fetch` has resolved. Fifteen repetitions:

```shell
jq -r '.latency.runs | group_by("\(.path) \(.skipBodies)") | .[] | (map(.doneMs) | sort) as $d | [.[0].path, "skipBodies=\(.[0].skipBodies)", "runs=\(length)", "median=\($d[length / 2 | floor])", "min=\($d[0])", "max=\($d[-1])", "requests=\(map(.requests) | unique)", "paused=\(map(.paused) | unique)", "bodies=\(map(.bodies) | unique)"] | @tsv' "$J"
```

```text
durableConfigure	skipBodies=false	runs=15	median=503	min=146	max=754	requests=[151]	paused=[0]	bodies=[151]
fetch	skipBodies=false	runs=15	median=817	min=189	max=1194	requests=[151]	paused=[151]	bodies=[151]
fetch	skipBodies=true	runs=15	median=681	min=179	max=954	requests=[151]	paused=[151]	bodies=[0]
network	skipBodies=false	runs=15	median=518	min=124	max=782	requests=[151]	paused=[0]	bodies=[151]
none	skipBodies=false	runs=15	median=529	min=139	max=943	requests=[151]	paused=[0]	bodies=[0]
```

The ranges overlap, and the host was loaded (Environment). The durable median sits with the
plain path's and below the no-body median, while the two `Fetch` medians sit 152 ms and 288 ms
above it. Every page came from loopback, so this does not show what a pause costs over a real
network.

### Consent cancellations

**Run.** The `consent` mode enables the app's consent blocker, `ElectronBlocker` from
`@ghostery/adblocker-electron`, on the render's session with a one-rule list,
`/spike-blocked.js`. It then loads a page that requests that script, a windows-1252 script, and a
windows-1252 `fetch`.

```shell
jq -r '.consent[] | .path as $p | .events[] | [$p, .method, .url, (.errorText // ""), (.blockedReason // ""), (.responseStatusCode // "" | tostring)] | @tsv' "$J"
jq -r '.consentServerLog | group_by(.) | map("\(.[0]) \(length)") | .[]' "$J"
```

```text
network	Network.requestWillBeSent	/spike-blocked.js			
network	Network.loadingFailed		net::ERR_BLOCKED_BY_CLIENT	other	
durableConfigure	Network.requestWillBeSent	/spike-blocked.js			
durableConfigure	Network.loadingFailed		net::ERR_BLOCKED_BY_CLIENT	other	
fetch	Fetch.requestPaused	/consent			200
fetch	Network.requestWillBeSent	/spike-blocked.js			
fetch	Fetch.requestPaused	/js1252?consent			200
fetch	Network.loadingFailed		net::ERR_BLOCKED_BY_CLIENT	other	
fetch	Fetch.requestPaused	/w1252?consent			200
/consent 3
/js1252?consent 3
/w1252?consent 3
```

The cancelled request ends in the same `Network.loadingFailed` on every path: the renderer spike's
reading, `net::ERR_BLOCKED_BY_CLIENT` with `blockedReason: "other"`. Under `fetch` it never pauses,
and the server never receives it.

### Out-of-process frames and dedicated workers

**Run.** The `oopif` mode uses D17's fixture shape. A page on `127.0.0.1` starts a dedicated worker
and frames a page on `localhost`, which loads a stylesheet, a `fetch`, and a worker of its own.
Each worker fetches a Shift_JIS file. Five renders: `network`, `durableConfigure`,
`durableEnable`, `fetch` on every session, and `fetch` on the page's session only.

```shell
jq -r '.frames[] | "\(.path)\(if .variant then " (" + .variant + ")" else "" end): load=\(.loadResult) attached=\(.attached | join(",")) setup=\([.setupAnswers[] | "\(.type):\(.answers | join("/"))"] | join("; "))"' "$J"
```

```text
network: load=ok attached=iframe,worker,worker setup=worker:ok/ok; iframe:ok/ok; worker:ok/ok
durableConfigure: load=ok attached=iframe,worker,worker setup=worker:ok/ok/ok; iframe:ok/ok/ok; worker:ok/ok/ok
durableEnable: load=ok attached=iframe,worker,worker setup=worker:ok/ok; iframe:ok/ok; worker:ok/ok
fetch: load=ok attached=iframe,worker,worker setup=worker:ok/ok/'Fetch.enable' wasn't found; iframe:ok/ok/ok; worker:ok/ok/'Fetch.enable' wasn't found
fetch (fetch on the page session only): load=ok attached=iframe,worker,worker setup=worker:ok/ok; iframe:ok/ok; worker:ok/ok
```

The answers are, in order, `Network.enable`, `Target.setAutoAttach`, and the path's command.
`Network.configureDurableMessages` answered on every child session. `Fetch.enable` returned
`'Fetch.enable' wasn't found` on both worker sessions. Where each body came from:

```shell
jq -r '.frames[] | (.path + (if .variant then " (page only)" else "" end)) as $p | .bodies[] | select(.servedHex != null) | [$p, .url, .session, "match=\(.matchesServed)"] | @tsv' "$J"
jq -r '.frames[] | select(.path == "fetch") | (.variant // "every frame session") as $v | [$v, ([.paused[] | "\(.url)@\(.session)"] | join(" "))] | @tsv' "$J"
jq -r '.framesServerRequests[] | "\(.url) \(.requests)"' "$J"
```

```text
network	/w1252?parent	page	match=false
network	/sjis?worker	child	match=false
network	/css1252?child	child	match=false
network	/w1252?child	child	match=false
network	/sjis?worker-child	child	match=false
durableConfigure	/w1252?parent	page	match=true
durableConfigure	/sjis?worker	child	match=true
durableConfigure	/css1252?child	child	match=true
durableConfigure	/w1252?child	child	match=true
durableConfigure	/sjis?worker-child	child	match=true
durableEnable	/w1252?parent	page	match=true
durableEnable	/sjis?worker	child	match=true
durableEnable	/css1252?child	child	match=true
durableEnable	/w1252?child	child	match=true
durableEnable	/sjis?worker-child	child	match=true
fetch	/w1252?parent	page	match=true
fetch	/sjis?worker	page	match=true
fetch	/css1252?child	child	match=true
fetch	/w1252?child	child	match=true
fetch	/sjis?worker-child	child	match=true
fetch (page only)	/w1252?parent	page	match=true
fetch (page only)	/sjis?worker	page	match=true
every frame session	/frame-parent@page /worker.js@page /w1252?parent@page /frame-child@page /sjis?worker@page /css1252?child@child /w1252?child@child /worker.js?child@child /sjis?worker-child@child
fetch on the page session only	/frame-parent@page /worker.js@page /w1252?parent@page /frame-child@page /sjis?worker@page
/frame-parent 5
/w1252?parent 5
/worker.js 5
/sjis?worker 5
/frame-child 5
/css1252?child 5
/w1252?child 5
/worker.js?child 5
/sjis?worker-child 5
```

Under the durable paths each body comes from the session that reported its `loadingFinished`, as
D17 item 6 has it. Under `fetch`, a dedicated worker's requests pause on the session of the frame
that owns the worker: the page's worker on the page, the frame's worker on the frame. With
`Fetch.enable` on the page only, the frame's four subresource requests reached the server, as each
URL's five requests over five renders show, and paused nowhere, so their bodies were not fetched.

### Service workers

**Run.** The `sw` mode loads two pages. `/sw-parent` registers a service worker whose install
handler fetches a Shift_JIS and a windows-1252 file. `/swfetch-parent` registers one that claims the
page and answers `?viasw` requests by fetching them again. The page then `fetch`es two such URLs.

```shell
jq -r '.serviceWorkers[] | [.path, .page, ([.setupAnswers[] | "\(.type):\(.answers | join("/")),resume=\(.resume)"] | join("; "))] | @tsv' "$J"
jq -r '.serviceWorkers[] | .page as $page | .path as $p | .bodies[] | select(.servedHex != null or .error != null) | [$p, $page, .url, .session, "match=\(.matchesServed)", (.error // "")] | @tsv' "$J"
```

```text
network	/sw-parent	service_worker:ok/ok,resume=ok
network	/swfetch-parent	service_worker:ok/ok,resume=ok
durableConfigure	/sw-parent	service_worker:ok/ok/ok,resume=ok
durableConfigure	/swfetch-parent	service_worker:ok/ok/ok,resume=ok
fetch	/sw-parent	service_worker:ok/ok/ok,resume=ok
fetch	/swfetch-parent	service_worker:ok/ok/ok,resume=ok
network	/sw-parent	/sjis?sw	child	match=false	
network	/sw-parent	/w1252?sw	child	match=false	
network	/swfetch-parent	/w1252?viasw	child	match=false	
network	/swfetch-parent	/w1252?viasw	page	match=false	
network	/swfetch-parent	/sjis?viasw	child	match=false	
network	/swfetch-parent	/sjis?viasw	page	match=false	
durableConfigure	/sw-parent	/sjis?sw	child	match=true	
durableConfigure	/sw-parent	/w1252?sw	child	match=true	
durableConfigure	/swfetch-parent	/w1252?viasw	child	match=true	
durableConfigure	/swfetch-parent	/sjis?viasw	child	match=true	
durableConfigure	/swfetch-parent	/w1252?viasw	page	match=null	No data found for resource with given identifier
durableConfigure	/swfetch-parent	/sjis?viasw	page	match=null	No data found for resource with given identifier
fetch	/sw-parent	/sjis?sw	child	match=true	
fetch	/sw-parent	/w1252?sw	child	match=true	
fetch	/swfetch-parent	/w1252?viasw	child	match=true	
fetch	/swfetch-parent	/sjis?viasw	child	match=true	
```

The worker's own fetches came back as the served bytes on both candidate paths. For the page's copy
of a response the worker answered, the plain path returned decoded text and the durable path
returned `No data found`; the `fetch` path never paused that copy on the page's session.

### Large bodies

**Run.** `big1252` (12,000,000 bytes) and `under1252` (9,000,000 bytes), loaded as main documents
under three sets of limits.

```shell
jq -r '.largeBodies | to_entries[] | .key as $k | .value[] | [$k, .path, .url, (.error // "base64Encoded=\(.base64Encoded) stored=\(.storedLength // (.storedHex | length / 2)) served=\(.servedLength // (.servedHex | length / 2)) match=\(.matchesServed)")] | @tsv' "$J"
```

```text
networkEnableLimits	network	/big1252	Request content was evicted from inspector cache
networkEnableLimits	network	/under1252	base64Encoded=false stored=18000000 served=9000000 match=false
networkEnableLimits	durableEnable	/big1252	base64Encoded=true stored=12000000 served=12000000 match=true
networkEnableLimits	durableEnable	/under1252	base64Encoded=true stored=9000000 served=9000000 match=true
networkEnableLimits	durableConfigure	/big1252	base64Encoded=true stored=12000000 served=12000000 match=true
networkEnableLimits	durableConfigure	/under1252	base64Encoded=true stored=9000000 served=9000000 match=true
networkEnableLimits	fetch	/big1252	base64Encoded=true stored=12000000 served=12000000 match=true
networkEnableLimits	fetch	/under1252	base64Encoded=true stored=9000000 served=9000000 match=true
durableLimits1e6Total1e6Resource	durableSmall	/w1252	base64Encoded=true stored=11 served=11 match=true
durableLimits1e6Total1e6Resource	durableSmall	/under1252	No data found for resource with given identifier
durableLimits1e6Total1e6Resource	durableSmall	/big1252	No data found for resource with given identifier
durableLimits50e6Total1e6Resource	durableSmall	/w1252	base64Encoded=true stored=11 served=11 match=true
durableLimits50e6Total1e6Resource	durableSmall	/under1252	base64Encoded=true stored=9000000 served=9000000 match=true
durableLimits50e6Total1e6Resource	durableSmall	/big1252	base64Encoded=true stored=12000000 served=12000000 match=true
```

In the first block every path gets `Network.enable` with 50e6 and 10e6, and the durable paths get
the same limits for the store. The other two blocks keep `Network.enable` there and give
`Network.configureDurableMessages` the limits in the block's name. The plain path refused the body
over its 10e6 per-resource limit, while the durable store returned it. With a 1e6 total, the store
refused both large bodies with an error, not a decoded string. With a 50e6 total and a 1e6
per-resource limit, it returned both. The durable path returned the 12,000,000-byte body as 16,000,000 base64 characters (results file,
`returnedLength`). D17 item 7's four-thirds estimate covers that, because the body is not valid
UTF-8.

**Verdict.** The durable path pauses no request and showed no added median latency. It leaves
consent cancellations as they were, and its command answers on page, `iframe`, `worker`, and
`service_worker` sessions in D17's order. The page's copy of a service-worker-answered response
returns no body under it. In these runs the store applied `maxTotalBufferSize` and not
`maxResourceBufferSize`. The protocol describes the store as outside the renderer, and this spike
did not measure the memory it holds. The `Fetch` path pauses every request until the
engine continues it, which raised the median by 152 ms, or 288 ms with bodies. It needs
`Fetch.enable` on each frame's session, since the page's session misses a cross-site frame's
requests, and it has no command on a worker session.

## Question 3: `Network.enable` and the Playwright session

**Question.** "Does the chosen path still work with `Network.enable` as the collector sets it up,
and with the e2e suite's Playwright session attached (the #180 concern)?"

**Runs.** Every harness render sends `Network.enable` with the renderer spike's limits and the page's
`Target.setAutoAttach` before the path's command. The `pw` mode runs the harness through
Playwright's `_electron.launch`, as `e2e/fixtures/electronApp.ts` launches the app. `pw.mjs` waits
for each hidden window's title to read `done`, then calls `page.evaluate` in it, which `fetch`es
`/w1252?pw`, while the harness holds the window open. Last, the scratch renderer change under
"Reproduce" made `renderPageInHiddenWindow` load `about:blank` and send `Network.enable`,
`Network.configureDurableMessages`, and `Target.setAutoAttach`, with D17's per-type setup on each
attached target. It also fetched each body on `loadingFinished`. Both Recapture e2e specs then ran
against that build.

**Observed.** The setup answers across all 126 harness renders outside the latency and `pw`
modes, and the Network events of the host page:

```shell
jq -r '.renders | group_by("\(.enable) \(.autoAttach) \(.loadResult)") | .[] | "Network.enable=\(.[0].enable) Target.setAutoAttach=\(.[0].autoAttach) loadURL=\(.[0].loadResult) renders=\(length)"' "$J"
jq -r '[.renders[] | select(.pathSetup != "none") | "\(.path) setup=\(.pathSetup)"] | group_by(.) | map("\(.[0]) renders=\(length)") | .[]' "$J"
jq -r '.hostEventCounts[] | select(.path == "network" or .path == "durableConfigure" or .path == "fetch") | [.path, (.counts | to_entries | map("\(.key)=\(.value)") | join(" "))] | @tsv' "$J"
```

```text
Network.enable=ok Target.setAutoAttach=ok loadURL=ok renders=126
durableConfigure setup=ok renders=17
durableSmall setup=ok renders=6
fetch setup=ok renders=18
fetchStream setup=ok renders=11
network	Network.requestWillBeSent=14 Network.responseReceived=14 Network.dataReceived=17 Network.loadingFinished=14
durableConfigure	Network.requestWillBeSent=14 Network.responseReceived=14 Network.dataReceived=17 Network.loadingFinished=14
fetch	Network.requestWillBeSent=14 Fetch.requestPaused=14 Network.responseReceived=14 Network.dataReceived=17 Network.loadingFinished=14
```

`durableSmall` is the large-body mode's durable path. Under
Playwright:

```shell
jq -r '.playwright.driver | "windowsEvaluated=\(.windowsEvaluated) exitCode=\(.exitCode)", (.log[] | "\(.url | sub("http://[^/]+"; "")) fetched \(.evaluated.fetchedHex)")' "$J"
jq -r '.playwright.runs[] | [.path, "enable=\(.enable)", "autoAttach=\(.autoAttach)", "pathSetup=\(.pathSetup)", "held=\(.evaluatedWhileHeld)", "match=\(.bodies | map(select(.matchesServed == true)) | length)/\(.bodies | length)"] | @tsv' "$J"
```

```text
windowsEvaluated=3 exitCode=0
/host?round=network fetched 3c703e636166e93c2f703e
/host?round=durableConfigure fetched 3c703e636166e93c2f703e
/host?round=fetch fetched 3c703e636166e93c2f703e
network	enable=ok	autoAttach=ok	pathSetup=none	held=true	match=4/14
durableConfigure	enable=ok	autoAttach=ok	pathSetup=ok	held=true	match=14/14
fetch	enable=ok	autoAttach=ok	pathSetup=ok	held=true	match=14/14
```

Each run's 14 bodies are the host page's 13 fixtures plus Playwright's `/w1252?pw`. The e2e specs
on the scratch build:

```shell
BIRDBRAIN_SPIKE_OUT=/tmp/spike-1983/e2e-renders XDG_SESSION_TYPE=x11 xvfb-run --auto-servernum \
  npx playwright test e2e/recapture.spec.ts e2e/recapture-consent.spec.ts --reporter=list
```

```text
Running 2 tests using 1 worker

  ✓  1 e2e/recapture-consent.spec.ts:67:7 › Recapture through a consent wall › suppresses the wall, scrolls past the lock, and records provenance (20.8s)
  ✓  2 e2e/recapture.spec.ts:32:7 › Recapture (background capture) › captures a URL in the background with full provenance (11.1s)

  2 passed (34.1s)
```

Exit 0. Each render wrote what its setup answered and what each body returned:

```shell
jq -r '.e2eRenders[] | [.url, ([.setup[] | "\(.page // .type)=\(.a)"] | join(" ")), ([.bodies[] | "\(.url) base64Encoded=\(.base64Encoded) length=\(.length)"] | join(" "))] | @tsv' "$J"
```

```text
/page	Network.enable=ok Network.configureDurableMessages=ok Target.setAutoAttach=ok	/page base64Encoded=false length=1127
/page	Network.enable=ok Network.configureDurableMessages=ok Target.setAutoAttach=ok	/page base64Encoded=false length=123
/page	Network.enable=ok Network.configureDurableMessages=ok Target.setAutoAttach=ok	/page base64Encoded=false length=123
```

**Verdict.** Yes, for both. `Network.configureDurableMessages` answered after `Network.enable` with
the renderer spike's limits in every render that sent it. The four Network event types the harness records arrive
in the same numbers on the host page with it as without it; the harness does not record the
`ExtraInfo` events. Playwright's own session ran a `fetch` inside each hidden window while the
durable path held it, and the durable path still returned 14 of 14 bodies as served. Both
Recapture e2e specs passed with the command in the app's renderer. The e2e fixture pages are
UTF-8, so that run shows the setup and the attached Playwright session, not the bytes; the harness
runs show the bytes.

## Question 4: if no path returns the served bytes

**Question.** "If no path returns the served bytes, what per-record statement and fingerprint rule
does the record need so it never presents re-encoded bytes as the server's?"

**Verdict.** On Electron 44.9.1 the case does not arise for a session where
`Network.configureDurableMessages` answered. Where the store held no body, `Network.getResponseBody`
returned an error: `No data found for resource with given identifier`, both for a body over the
store's total and for the page's copy of a service-worker-answered response. It never fell back to
a decoded string, and the collector already counts a missing body as `body-omitted` (D4). The one
case left is a session whose command failed or did not answer. There a string body may be decoded
text, and the recommendation's fourth item drops it, so the record holds no body it cannot vouch
for and needs no per-record statement. If the maintainer rules to keep such bodies instead, the
rule #1979 already writes is the fallback: `x-birdbrain-decoded-text: utf-8` on the record, and the
payload digest over the stored bytes. It would then key on the session's answer, not on
`base64Encoded`, because under the durable path `base64Encoded: false` also marks served bytes.

## What this does not show

- No HTTP/2, HTTP/3, TLS, or proxied response. The fixture server is HTTP/1.1 on loopback.
- No other Electron version or platform. `Network.configureDurableMessages` is experimental, so a
  Chromium update can change or remove it. Step 9's e2e with a non-UTF-8 fixture is where such a
  change would fail (plan, D17, "Risks", for the same exposure of `flatten`).
- No cross-process navigation, which is what the protocol says the store survives, and no
  back-forward cache.
- No response a service worker synthesizes itself, such as `new Response(...)`. The fixture's worker
  only forwards with `fetch`.
- No measure of the memory the store holds outside the renderer, and no page whose bodies across
  several sessions approach the 50e6 total.
- No `Network.setRequestInterception` path, which the pinned protocol marks deprecated in favor of
  `Fetch.enable` (Question 1).
- The `Fetch` path was not run in the app's renderer or the e2e specs, only in the harness.

## Reproduce

### Commands

Every command with its exit code. Rows 3 to 16 produced what this page reports; row 13 ran before
row 3. Row 2 lists the earlier passes with drafts of the harness, which this page does not report.

| # | Command | Exit |
| --- | --- | --- |
| 1 | `pnpm install` in the checkout. The session's command hook refused `bash scripts/setup-worktree.sh`, and Node already read v20.20.2. | 0 |
| 2 | Earlier drafts of the harness, run with the commands in rows 3 to 12. Two failed and were fixed: the consent mode's second render threw `Attempted to register a second handler for '@ghostery/adblocker/inject-cosmetic-filters'` until the harness disabled the blocker after each render, and the first `pw` run stopped on `Disk quota exceeded` in `/tmp` until the large-body outputs were trimmed. | varied |
| 3 | `XDG_SESSION_TYPE=x11 SPIKE_OUT=/tmp/spike-1983/out SPIKE_MODE=protocol xvfb-run --auto-servernum node_modules/electron/dist/electron /tmp/spike-1983/harness/main.cjs` | 0 |
| 4 | The same with `SPIKE_MODE=paths` | 0 |
| 5 | The same with `SPIKE_MODE=paths SPIKE_PATHS=network,durableEnable,durableConfigure,fetch SPIKE_NAMES=big1252,under1252 SPIKE_SUB=0 SPIKE_FILE=big.json` | 0 |
| 6 | The same with `SPIKE_MODE=paths SPIKE_PATHS=durableSmall SPIKE_DURABLE_TOTAL=1000000 SPIKE_DURABLE_RESOURCE=1000000 SPIKE_NAMES=w1252,under1252,big1252 SPIKE_SUB=0 SPIKE_FILE=durable-small.json` | 0 |
| 7 | Row 6 with `SPIKE_DURABLE_TOTAL=50000000` and `SPIKE_FILE=durable-resource.json` | 0 |
| 8 | Row 3 with `SPIKE_MODE=slow` | 0 |
| 9 | Row 3 with `SPIKE_MODE=consent SPIKE_REPO=<checkout>` | 0 |
| 10 | Row 3 with `SPIKE_MODE=oopif`, then with `SPIKE_MODE=sw` | 0, 0 |
| 11 | Row 3 with `SPIKE_MODE=latency SPIKE_N=50 SPIKE_REPS=7`, whose output was set aside, then with `SPIKE_REPS=15` | 0, 0 |
| 12 | `XDG_SESSION_TYPE=x11 xvfb-run --auto-servernum node /tmp/spike-1983/harness/pw.mjs <checkout> /tmp/spike-1983/out` | 0 |
| 13 | Edit `src/main/services/backgroundRenderer.ts` to the scratch change below, save it with `git diff` to `/tmp/spike-1983/renderer.diff`, `pnpm build`, run the e2e command under Question 3, then revert the file with `git checkout --` | none (a file edit), 0, 0, 0 (2 passed), 0 |
| 14 | `node /tmp/spike-1983/harness/assemble.cjs /tmp/spike-1983/out /tmp/spike-1983/results.json /tmp/spike-1983/e2e-renders`, then copy the file to `docs/specs/2026-10-26-transaction-record-charset-spike-results.json` | 0, 0 |
| 15 | `gitleaks dir --config .gitleaks.toml --no-banner --redact docs/specs/2026-10-26-transaction-record-charset-spike-results.json` | 0 (no leaks found) |
| 16 | `bash queries.sh` from the checkout's root, which runs every query on this page against the committed file | 0 (29 queries, each exit 0) |

`<checkout>` is the absolute path of the checkout, which `pw.mjs` and the consent mode resolve
`@playwright/test`, Electron, and `@ghostery/adblocker-electron` from.

### Fixture server: `fixtures.cjs`

```js
// Fixture server for spike #1983. Every body is invented. `served` is the identity body, the
// bytes left once any content coding is removed; `wire` is what goes on the socket.
const http = require('http')
const zlib = require('zlib')

const hex = (h) => Buffer.from(h, 'hex')
const latin1 = (s) => Buffer.from(s, 'latin1')

// 1x1 transparent PNG.
const PNG = hex(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082'
)

const TEXT = {
  w1252: { type: 'text/html; charset=windows-1252', served: hex('3c703e636166e93c2f703e') },
  sjis: { type: 'text/html; charset=Shift_JIS', served: hex('3c703e93fa967b3c2f703e') },
  bom: { type: 'text/html; charset=utf-8', served: hex('efbbbf3c703e61623c2f703e') },
  invalid: { type: 'text/html; charset=utf-8', served: hex('3c703e61ff623c2f703e') },
  gzip1252: {
    type: 'text/html; charset=windows-1252',
    served: hex('3c703e636166e93c2f703e'),
    gzip: true
  },
  nolabel: { type: 'text/html', served: hex('3c703e636166e93c2f703e') },
  utf8: { type: 'text/html; charset=utf-8', served: hex('3c703e636166c3a93c2f703e') },
  plain1252: { type: 'text/plain; charset=windows-1252', served: latin1('caf\xe9') },
  // Bytes that are valid UTF-8 under a windows-1252 label: decoding by the label changes them.
  mojibake: { type: 'text/html; charset=windows-1252', served: hex('3c703e636166c3a93c2f703e') },
  utf16: { type: 'text/html; charset=utf-16', served: hex('fffe3c0070003e00610062003c002f0070003e00') }
}

const SUB_ONLY = {
  css1252: { type: 'text/css; charset=windows-1252', served: latin1('/* caf\xe9 */\n') },
  js1252: { type: 'text/javascript; charset=windows-1252', served: latin1('// caf\xe9\n') },
  png: { type: 'image/png', served: PNG }
}

// Larger than the 10e6 per-resource buffer the collector passes to Network.enable.
const BIG = {
  big1252: { type: 'text/html; charset=windows-1252', served: Buffer.alloc(12e6, 0xe9) },
  under1252: { type: 'text/html; charset=windows-1252', served: Buffer.alloc(9e6, 0xe9) }
}

const ALL = { ...TEXT, ...SUB_ONLY, ...BIG }

const hostPage = (names) => `<!doctype html><meta charset=utf-8><title>host</title>
<link rel=stylesheet href="/css1252?sub"><script src="/js1252?sub"></script><img src="/png?sub">
<script>
Promise.all(${JSON.stringify(names)}.map((n) => fetch('/' + n + '?sub').then((r) => r.arrayBuffer())))
  .then(() => { document.title = 'done' }, (e) => { document.title = 'error ' + e })
</script>`

// Many subresources, for the latency comparison.
const heavyPage = (n) => {
  const tags = []
  for (let i = 0; i < n; i++) {
    tags.push(`<img src="/png?i=${i}">`)
    tags.push(`<link rel=stylesheet href="/css1252?i=${i}">`)
  }
  const fetches = []
  for (let i = 0; i < n; i++) fetches.push(`'/w1252?i=${i}'`)
  return `<!doctype html><meta charset=utf-8><title>heavy</title>${tags.join('')}
<script>
Promise.all([${fetches.join(',')}].map((u) => fetch(u).then((r) => r.arrayBuffer())))
  .then(() => { document.title = 'done' })
</script>`
}

const consentPage = `<!doctype html><meta charset=utf-8><title>consent</title>
<script src="/spike-blocked.js"></script><script src="/js1252?consent"></script>
<script>fetch('/w1252?consent').then((r) => r.arrayBuffer()).then(() => { document.title = 'done' })</script>`

const framePage = (childOrigin) => `<!doctype html><meta charset=utf-8><title>frame-parent</title>
<script>
const w = new Worker('/worker.js')
w.onmessage = () => { window.workerDone = true }
</script>
<iframe src="${childOrigin}/frame-child"></iframe>
<script>fetch('/w1252?parent').then((r) => r.arrayBuffer())</script>`

const frameChild = `<!doctype html><meta charset=utf-8><title>frame-child</title>
<link rel=stylesheet href="/css1252?child">
<script>
fetch('/w1252?child').then((r) => r.arrayBuffer())
const w = new Worker('/worker.js?child')
</script>`

const workerJs = `fetch('/sjis?worker' + location.search.replace('?', '-')).then((r) => r.arrayBuffer()).then(() => postMessage('done'))`

const serve = (res, { type, served, gzip }, extra = {}) => {
  const wire = gzip ? zlib.gzipSync(served) : served
  const headers = { 'content-type': type, 'content-length': wire.length, 'cache-control': 'no-store', ...extra }
  if (gzip) headers['content-encoding'] = 'gzip'
  res.writeHead(200, headers)
  res.end(wire)
}

const start = (host, opts = {}) =>
  new Promise((resolve) => {
    const log = []
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x')
      const name = url.pathname.slice(1)
      log.push({ at: Date.now(), method: req.method, url: req.url })
      const delay = Number(url.searchParams.get('delay') ?? 0)
      const go = () => {
        if (name === 'host') {
          const names = (url.searchParams.get('names') ?? Object.keys(TEXT).join(',')).split(',')
          return serve(res, { type: 'text/html; charset=utf-8', served: Buffer.from(hostPage(names)) })
        }
        if (name === 'heavy') {
          return serve(res, {
            type: 'text/html; charset=utf-8',
            served: Buffer.from(heavyPage(Number(url.searchParams.get('n') ?? 20)))
          })
        }
        if (name === 'consent') {
          return serve(res, { type: 'text/html; charset=utf-8', served: Buffer.from(consentPage) })
        }
        if (name === 'spike-blocked.js') {
          return serve(res, { type: 'text/javascript', served: Buffer.from('window.blocked = false') })
        }
        if (name === 'filters.txt') {
          return serve(res, { type: 'text/plain', served: Buffer.from('/spike-blocked.js\n') })
        }
        if (name === 'frame-parent') {
          return serve(res, {
            type: 'text/html; charset=utf-8',
            served: Buffer.from(framePage(opts.childOrigin()))
          })
        }
        if (name === 'frame-child') {
          return serve(res, { type: 'text/html; charset=utf-8', served: Buffer.from(frameChild) })
        }
        if (name === 'sw-parent') {
          return serve(res, {
            type: 'text/html; charset=utf-8',
            served: Buffer.from(`<!doctype html><meta charset=utf-8><title>sw-parent</title>
<script>navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then(() => { document.title = 'done' })</script>`)
          })
        }
        if (name === 'sw.js') {
          return serve(res, {
            type: 'text/javascript',
            served: Buffer.from(`self.addEventListener('install', (e) => e.waitUntil(fetch('/sjis?sw').then((r) => r.arrayBuffer()).then(() => fetch('/w1252?sw')).then((r) => r.arrayBuffer())))`)
          })
        }
        if (name === 'swfetch-parent') {
          return serve(res, {
            type: 'text/html; charset=utf-8',
            served: Buffer.from(`<!doctype html><meta charset=utf-8><title>swfetch-parent</title>
<script>
const controlled = new Promise((r) => navigator.serviceWorker.controller ? r() : navigator.serviceWorker.addEventListener('controllerchange', r))
navigator.serviceWorker.register('/sw2.js')
controlled.then(() => Promise.all(['/w1252?viasw', '/sjis?viasw'].map((u) => fetch(u).then((r) => r.arrayBuffer())))).then(() => { document.title = 'done' })
</script>`)
          })
        }
        if (name === 'sw2.js') {
          return serve(res, {
            type: 'text/javascript',
            served: Buffer.from(`self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => { if (e.request.url.includes('viasw')) e.respondWith(fetch(e.request)) })`)
          })
        }
        if (name === 'worker.js') {
          return serve(res, { type: 'text/javascript', served: Buffer.from(workerJs) })
        }
        if (name.startsWith('slow-')) {
          // Headers first, then the body after `delay` ms, so a stream can start before the end.
          const fx = ALL[name.slice(5)]
          const wire = fx.gzip ? zlib.gzipSync(fx.served) : fx.served
          const headers = { 'content-type': fx.type, 'content-length': wire.length, 'cache-control': 'no-store' }
          if (fx.gzip) headers['content-encoding'] = 'gzip'
          res.writeHead(200, headers)
          res.flushHeaders()
          const half = Math.floor(wire.length / 2)
          res.write(wire.subarray(0, half))
          setTimeout(() => res.end(wire.subarray(half)), Number(url.searchParams.get('gap') ?? 500))
          return
        }
        const fx = ALL[name]
        if (fx) return serve(res, fx)
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
      }
      if (delay > 0) setTimeout(go, delay)
      else go()
    })
    server.listen(0, host, () => resolve({ server, log, origin: `http://${opts.label ?? host}:${server.address().port}` }))
  })

module.exports = { TEXT, SUB_ONLY, BIG, ALL, start }
```

### Harness: `main.cjs`

```js
// Scratch Electron harness for spike #1983. Run: electron main.cjs, with SPIKE_OUT and SPIKE_MODE.
const { app, BrowserWindow } = require('electron')
const { randomUUID } = require('crypto')
const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')
const fx = require('./fixtures.cjs')

const OUT = process.env.SPIKE_OUT
const MODE = process.env.SPIKE_MODE
const REPO = process.env.SPIKE_REPO
app.setPath('userData', path.join(OUT, `userdata-${MODE}-${process.pid}`))
if (MODE === 'protocol') app.commandLine.appendSwitch('remote-debugging-port', '0')

const LIMITS = { maxTotalBufferSize: 50e6, maxResourceBufferSize: 10e6 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms))])
const errText = (e) => (e && e.message) || String(e)

const storedBytes = ({ body, base64Encoded }) =>
  base64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body, 'utf8')

const nameOf = (url) => {
  try {
    return new URL(url).pathname.slice(1).replace(/^slow-/, '')
  } catch {
    return url
  }
}

const servedHexOf = (url) => fx.ALL[nameOf(url)]?.served.toString('hex')

const readStream = async (send, handle, sid) => {
  const parts = []
  const reads = []
  for (;;) {
    const r = await send('IO.read', { handle, size: 1 << 20 }, sid)
    reads.push({ base64Encoded: r.base64Encoded === true, length: r.data.length, eof: r.eof })
    parts.push(r.base64Encoded ? Buffer.from(r.data, 'base64') : Buffer.from(r.data, 'utf8'))
    if (r.eof) break
  }
  await send('IO.close', { handle }, sid).catch(() => {})
  return { bytes: Buffer.concat(parts), reads }
}

// ---------------------------------------------------------------- body paths
const FETCH_ALL = { patterns: [{ urlPattern: '*', requestStage: 'Response' }] }

const PATHS = {
  none: {},
  network: {
    onEvent: ({ method, params, sid, send, track, record }) => {
      if (method !== 'Network.loadingFinished') return
      const { requestId } = params
      track(
        send('Network.getResponseBody', { requestId }, sid).then(
          (r) => record({ requestId, sid, method: 'Network.getResponseBody', result: r }),
          (e) => record({ requestId, sid, method: 'Network.getResponseBody', error: errText(e) })
        )
      )
    }
  },
  durableEnable: {
    enableParams: { ...LIMITS, enableDurableMessages: true }
  },
  durableConfigure: {
    setup: (send, sid) => send('Network.configureDurableMessages', LIMITS, sid)
  },
  durableSmall: {
    setup: (send, sid) =>
      send(
        'Network.configureDurableMessages',
        {
          maxTotalBufferSize: Number(process.env.SPIKE_DURABLE_TOTAL),
          maxResourceBufferSize: Number(process.env.SPIKE_DURABLE_RESOURCE)
        },
        sid
      )
  },
  fetch: {
    setup: (send, sid) => send('Fetch.enable', FETCH_ALL, sid),
    onEvent: ({ method, params, sid, send, track, record, opts }) => {
      if (method !== 'Fetch.requestPaused') return
      const { requestId, networkId, responseStatusCode, request } = params
      track(
        (async () => {
          if (responseStatusCode !== undefined && !opts.skipBodies) {
            const t = Date.now()
            try {
              const r = await send('Fetch.getResponseBody', { requestId }, sid)
              record({ requestId: networkId, url: request.url, sid, method: 'Fetch.getResponseBody', result: r, ms: Date.now() - t })
            } catch (e) {
              record({ requestId: networkId, url: request.url, sid, method: 'Fetch.getResponseBody', error: errText(e) })
            }
          }
          await send('Fetch.continueRequest', { requestId }, sid).catch((e) =>
            record({ requestId: networkId, url: request.url, sid, method: 'Fetch.continueRequest', error: errText(e) })
          )
        })()
      )
    }
  },
  fetchStream: {
    setup: (send, sid) => send('Fetch.enable', FETCH_ALL, sid),
    onEvent: ({ method, params, sid, send, track, record }) => {
      if (method !== 'Fetch.requestPaused') return
      const { requestId, networkId, responseStatusCode, responseHeaders, request } = params
      track(
        (async () => {
          if (responseStatusCode === undefined || responseStatusCode >= 300) {
            await send('Fetch.continueRequest', { requestId }, sid).catch(() => {})
            return
          }
          try {
            const { stream } = await send('Fetch.takeResponseBodyAsStream', { requestId }, sid)
            const { bytes, reads } = await readStream(send, stream, sid)
            record({
              requestId: networkId,
              url: request.url,
              sid,
              method: 'Fetch.takeResponseBodyAsStream+IO.read',
              result: { body: bytes.toString('base64'), base64Encoded: true },
              reads
            })
            // The body is consumed, so the page only gets it if the client hands it back.
            const headers = (responseHeaders ?? []).filter(
              ({ name }) => !['content-encoding', 'content-length'].includes(name.toLowerCase())
            )
            await send(
              'Fetch.fulfillRequest',
              { requestId, responseCode: responseStatusCode, responseHeaders: headers, body: bytes.toString('base64') },
              sid
            )
          } catch (e) {
            record({ requestId: networkId, url: request.url, sid, method: 'Fetch.takeResponseBodyAsStream+IO.read', error: errText(e) })
            await send('Fetch.continueRequest', { requestId }, sid).catch(() => {})
          }
        })()
      )
    }
  },
  stream: {
    onEvent: ({ method, params, sid, send, track, record, state }) => {
      state.streams ??= new Map()
      const { streams } = state
      if (method === 'Network.responseReceived') {
        const { requestId } = params
        const entry = { requestId, sid, url: params.response.url, chunks: [], dataEvents: 0 }
        streams.set(requestId, entry)
        track(
          send('Network.streamResourceContent', { requestId }, sid).then(
            (r) => {
              entry.buffered = r.bufferedData
            },
            (e) => {
              entry.error = errText(e)
            }
          )
        )
      } else if (method === 'Network.dataReceived') {
        const entry = streams.get(params.requestId)
        if (entry) {
          entry.dataEvents += 1
          if (params.data !== undefined) entry.chunks.push(params.data)
        }
      } else if (method === 'Network.loadingFinished') {
        const entry = streams.get(params.requestId)
        if (entry) entry.finished = true
      }
    },
    finish: ({ state, record }) => {
      for (const entry of state.streams?.values() ?? []) {
        const { requestId, sid, url, buffered, chunks, error, dataEvents, finished } = entry
        if (error) {
          record({ requestId, url, sid, method: 'Network.streamResourceContent', error, dataEvents, chunks: chunks.length })
          continue
        }
        const bytes = Buffer.concat([
          Buffer.from(buffered ?? '', 'base64'),
          ...chunks.map((c) => Buffer.from(c, 'base64'))
        ])
        record({
          requestId,
          url,
          sid,
          method: 'Network.streamResourceContent',
          result: { body: bytes.toString('base64'), base64Encoded: true },
          bufferedLength: Buffer.from(buffered ?? '', 'base64').length,
          dataEvents,
          dataChunks: chunks.length,
          finished: finished === true
        })
      }
    }
  },
  loadNetworkResource: {
    after: async ({ send, record, requests }) => {
      for (const { url, frameId, requestId } of requests) {
        if (!fx.ALL[nameOf(url)]) continue
        try {
          const { resource } = await send('Network.loadNetworkResource', {
            frameId,
            url,
            options: { disableCache: true, includeCredentials: false }
          })
          if (!resource.success) {
            record({ requestId, url, method: 'Network.loadNetworkResource+IO.read', error: JSON.stringify(resource) })
            continue
          }
          const { bytes, reads } = await readStream(send, resource.stream, '')
          record({
            requestId,
            url,
            method: 'Network.loadNetworkResource+IO.read',
            result: { body: bytes.toString('base64'), base64Encoded: true },
            reads,
            httpStatusCode: resource.httpStatusCode
          })
        } catch (e) {
          record({ requestId, url, method: 'Network.loadNetworkResource+IO.read', error: errText(e) })
        }
      }
    }
  },
  pageResource: {
    after: async ({ send, record, requests }) => {
      let pageEnabled = false
      for (const { url, frameId, requestId } of requests) {
        if (!fx.ALL[nameOf(url)]) continue
        let r
        try {
          r = await send('Page.getResourceContent', { frameId, url })
        } catch (e) {
          if (!pageEnabled) {
            record({ requestId, url, method: 'Page.getResourceContent (no Page.enable)', error: errText(e) })
            await send('Page.enable')
            pageEnabled = true
          }
          try {
            r = await send('Page.getResourceContent', { frameId, url })
          } catch (e2) {
            record({ requestId, url, method: 'Page.getResourceContent', error: errText(e2), pageEnabled })
            continue
          }
        }
        record({
          requestId,
          url,
          method: 'Page.getResourceContent',
          result: { body: r.content, base64Encoded: r.base64Encoded },
          pageEnabled
        })
      }
    }
  }
}

PATHS.durableEnable.onEvent = PATHS.network.onEvent
PATHS.durableConfigure.onEvent = PATHS.network.onEvent
PATHS.durableSmall.onEvent = PATHS.network.onEvent

// ---------------------------------------------------------------- one render
const compact = (method, params, sid) => {
  const base = { method, sid }
  switch (method) {
    case 'Network.requestWillBeSent':
      return { ...base, requestId: params.requestId, url: params.request.url, type: params.type, frameId: params.frameId }
    case 'Network.responseReceived':
      return {
        ...base,
        requestId: params.requestId,
        url: params.response.url,
        mimeType: params.response.mimeType,
        charset: params.response.charset,
        status: params.response.status
      }
    case 'Network.dataReceived':
      return { ...base, requestId: params.requestId, dataLength: params.dataLength, encodedDataLength: params.encodedDataLength, hasData: params.data !== undefined }
    case 'Network.loadingFinished':
      return { ...base, requestId: params.requestId, encodedDataLength: params.encodedDataLength }
    case 'Network.loadingFailed':
      return { ...base, requestId: params.requestId, errorText: params.errorText, canceled: params.canceled, blockedReason: params.blockedReason, type: params.type }
    case 'Fetch.requestPaused':
      return { ...base, requestId: params.requestId, networkId: params.networkId, url: params.request.url, responseStatusCode: params.responseStatusCode, resourceType: params.resourceType }
    case 'Target.attachedToTarget':
      return { ...base, sessionId: params.sessionId, type: params.targetInfo.type, url: params.targetInfo.url, waiting: params.waitingForDebugger }
    default:
      return null
  }
}

const render = async (url, pathName, opts = {}) => {
  const p = PATHS[pathName]
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: `spike-${randomUUID()}`,
      backgroundThrottling: false,
      offscreen: true
    }
  })
  const wc = win.webContents
  if (opts.sessionSetup) await opts.sessionSetup(wc.session)
  const events = []
  const results = []
  const setupAnswers = []
  const pending = []
  const state = {}
  const requests = []
  const t0 = Date.now()
  const send = (m, params, sid) =>
    sid ? wc.debugger.sendCommand(m, params ?? {}, sid) : wc.debugger.sendCommand(m, params ?? {})
  const track = (promise) => pending.push(promise)
  const record = (r) => results.push({ at: Date.now() - t0, ...r })

  const childSetup = async (sessionId, type) => {
    const extra = p.setup && opts.childPath !== false ? [p.setup(send, sessionId)] : []
    const cmds = [
      send('Network.enable', p.enableParams ?? LIMITS, sessionId),
      send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId),
      ...extra
    ]
    const labelled = cmds.map((c, i) =>
      withTimeout(c, 2000, `child ${type} cmd ${i}`).then(
        () => 'ok',
        (e) => errText(e)
      )
    )
    if (type === 'service_worker') {
      const resume = send('Runtime.runIfWaitingForDebugger', {}, sessionId).then(() => 'ok', (e) => errText(e))
      setupAnswers.push({ sessionId, type, answers: await Promise.all(labelled), resume: await resume })
    } else {
      const answers = await Promise.all(labelled)
      const resume = await send('Runtime.runIfWaitingForDebugger', {}, sessionId).then(() => 'ok', (e) => errText(e))
      setupAnswers.push({ sessionId, type, answers, resume })
    }
  }

  wc.debugger.on('message', (_e, method, params, sessionId) => {
    const sid = sessionId || ''
    const c = compact(method, params, sid)
    if (c) events.push({ at: Date.now() - t0, ...c })
    if (method === 'Network.requestWillBeSent') {
      requests.push({ url: params.request.url, frameId: params.frameId, requestId: params.requestId, sid })
    }
    if (method === 'Target.attachedToTarget') {
      const { sessionId: child, targetInfo } = params
      if (['iframe', 'worker', 'service_worker'].includes(targetInfo.type)) {
        track(childSetup(child, targetInfo.type))
      } else {
        track(send('Runtime.runIfWaitingForDebugger', {}, child).catch(() => {}))
      }
    }
    if (p.onEvent) p.onEvent({ method, params, sid, send, track, record, state, opts })
  })

  wc.debugger.attach('1.3')
  await wc.loadURL('about:blank')
  const enable = await withTimeout(send('Network.enable', p.enableParams ?? LIMITS), 10000, 'Network.enable').then(
    () => 'ok',
    (e) => errText(e)
  )
  const autoAttach = await withTimeout(
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }),
    10000,
    'setAutoAttach'
  ).then(
    () => 'ok',
    (e) => errText(e)
  )
  const pathSetup = p.setup
    ? await withTimeout(p.setup(send, ''), 10000, 'path setup').then(
        () => 'ok',
        (e) => errText(e)
      )
    : 'none'
  if (opts.beforeLoad) await opts.beforeLoad(win)
  const tStart = Date.now()
  const loadResult = await withTimeout(wc.loadURL(url), 15000, 'loadURL').then(
    () => 'ok',
    (e) => errText(e)
  )
  const tLoaded = Date.now()
  let title = wc.getTitle()
  if (opts.waitDone) {
    const until = Date.now() + 15000
    while (title !== 'done' && !title.startsWith('error') && Date.now() < until) {
      await sleep(10)
      title = wc.getTitle()
    }
  }
  const tDone = Date.now()
  if (opts.duringPage) await opts.duringPage(win)
  await sleep(opts.settle ?? 500)
  const settled = await withTimeout(Promise.allSettled(pending), 10000, 'pending').then(
    () => 'ok',
    (e) => errText(e)
  )
  if (p.after) await p.after({ send, record, requests })
  if (p.finish) p.finish({ state, record })
  const pageText = await wc
    .executeJavaScript('document.body ? document.body.innerText.slice(0, 200) : null')
    .catch((e) => `error: ${errText(e)}`)
  if (opts.sessionTeardown) opts.sessionTeardown(wc.session)
  win.destroy()
  return {
    url,
    path: pathName,
    enable,
    autoAttach,
    pathSetup,
    loadResult,
    title,
    pageText,
    loadMs: tLoaded - tStart,
    doneMs: tDone - tStart,
    settled,
    setupAnswers,
    results: results.map((r) => {
      const url = r.url ?? requests.find((q) => q.requestId === r.requestId)?.url
      const served = servedHexOf(url)
      if (!r.result) return { ...r, url, servedHex: served && served.length <= 8192 ? served : undefined }
      const stored = storedBytes(r.result)
      const matchesServed = served === undefined ? null : stored.toString('hex') === served
      if (stored.length > 4096) {
        const sha = (b) => require('crypto').createHash('sha256').update(b).digest('hex')
        return {
          ...r,
          url,
          result: undefined,
          base64Encoded: r.result.base64Encoded,
          returnedLength: r.result.body.length,
          storedLength: stored.length,
          storedSha256: sha(stored),
          servedLength: served === undefined ? undefined : served.length / 2,
          servedSha256: served === undefined ? undefined : sha(Buffer.from(served, 'hex')),
          matchesServed
        }
      }
      return {
        ...r,
        url,
        result: undefined,
        base64Encoded: r.result.base64Encoded,
        returned: r.result.body,
        storedHex: stored.toString('hex'),
        servedHex: served,
        matchesServed
      }
    }),
    events
  }
}

// ---------------------------------------------------------------- modes
const write = (name, data) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2))

const MODES = {
  protocol: async () => {
    const port = fs.readFileSync(path.join(app.getPath('userData'), 'DevToolsActivePort'), 'utf8').split('\n')[0]
    const res = await fetch(`http://127.0.0.1:${port}/json/protocol`)
    const protocol = await res.json()
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
    write('protocol.json', { version, versions: process.versions, protocol })
  },
  paths: async () => {
    const main = await fx.start('127.0.0.1')
    const names = process.env.SPIKE_NAMES ? process.env.SPIKE_NAMES.split(',') : Object.keys(fx.TEXT)
    const sub = process.env.SPIKE_SUB !== '0'
    const pathNames = (process.env.SPIKE_PATHS ?? 'network,durableEnable,durableConfigure,fetch,fetchStream,stream,loadNetworkResource,pageResource').split(',')
    const runs = []
    for (const pathName of pathNames) {
      for (const n of names) {
        runs.push(await render(`${main.origin}/${n}`, pathName, { kind: 'document' }))
      }
      if (sub) runs.push(await render(`${main.origin}/host`, pathName, { waitDone: true, kind: 'subresource' }))
    }
    write(process.env.SPIKE_FILE ?? `paths.json`, { versions: process.versions, serverLog: main.log, runs })
    main.server.close()
  },
  slow: async () => {
    // Headers first, half the body, then the rest after a gap, so a stream can begin mid-response.
    const main = await fx.start('127.0.0.1')
    const runs = []
    for (const n of Object.keys(fx.TEXT)) {
      runs.push(await render(`${main.origin}/slow-${n}?gap=800`, 'stream', { settle: 1500 }))
    }
    write('slow.json', { versions: process.versions, serverLog: main.log, runs })
    main.server.close()
  },
  latency: async () => {
    const main = await fx.start('127.0.0.1')
    const n = Number(process.env.SPIKE_N ?? 50)
    const reps = Number(process.env.SPIKE_REPS ?? 7)
    const configs = [
      ['none', {}],
      ['network', {}],
      ['durableConfigure', {}],
      ['fetch', { skipBodies: true }],
      ['fetch', {}]
    ]
    const runs = []
    for (let r = 0; r < reps; r++) {
      for (const [pathName, o] of configs) {
        const run = await render(`${main.origin}/heavy?n=${n}`, pathName, { waitDone: true, settle: 300, ...o })
        runs.push({
          rep: r,
          path: pathName,
          skipBodies: o.skipBodies === true,
          loadMs: run.loadMs,
          doneMs: run.doneMs,
          title: run.title,
          paused: run.events.filter((e) => e.method === 'Fetch.requestPaused').length,
          requests: run.events.filter((e) => e.method === 'Network.requestWillBeSent').length,
          finished: run.events.filter((e) => e.method === 'Network.loadingFinished').length,
          bodies: run.results.filter((x) => x.returned !== undefined).length,
          bodyMs: run.results.filter((x) => x.ms !== undefined).map((x) => x.ms)
        })
      }
    }
    write('latency.json', { versions: process.versions, n, reps, runs })
    main.server.close()
  },
  consent: async () => {
    const main = await fx.start('127.0.0.1')
    const rq = createRequire(path.join(REPO, 'package.json'))
    const { ElectronBlocker } = rq('@ghostery/adblocker-electron')
    const list = '/spike-blocked.js\n'
    const runs = []
    let blocker
    for (const pathName of ['network', 'durableConfigure', 'fetch']) {
      runs.push(
        await render(`${main.origin}/consent`, pathName, {
          waitDone: true,
          sessionSetup: async (ses) => {
            blocker = ElectronBlocker.parse(list)
            blocker.enableBlockingInSession(ses)
          },
          sessionTeardown: (ses) => blocker.disableBlockingInSession(ses)
        })
      )
    }
    write('consent.json', { versions: process.versions, list, serverLog: main.log, runs })
    main.server.close()
  },
  pw: async () => {
    // Launched by pw.mjs through Playwright, which attaches its own CDP client to the app.
    const main = await fx.start('127.0.0.1')
    const runs = []
    for (const pathName of ['network', 'durableConfigure', 'fetch']) {
      global.pwDone = false
      global.pwResult = undefined
      const run = await render(`${main.origin}/host?round=${pathName}`, pathName, {
        waitDone: true,
        duringPage: async () => {
          const until = Date.now() + 20000
          while (!global.pwDone && Date.now() < until) await sleep(50)
        }
      })
      runs.push({ ...run, pwDone: global.pwDone, pwResult: global.pwResult })
    }
    write('pw.json', { versions: process.versions, serverLog: main.log, runs })
    main.server.close()
  },
  sw: async () => {
    const main = await fx.start('127.0.0.1')
    const runs = []
    for (const pathName of ['network', 'durableConfigure', 'fetch']) {
      runs.push(await render(`${main.origin}/sw-parent`, pathName, { waitDone: true, settle: 2000 }))
      runs.push(await render(`${main.origin}/swfetch-parent`, pathName, { waitDone: true, settle: 2000 }))
    }
    write('sw.json', { versions: process.versions, serverLog: main.log, runs })
    main.server.close()
  },
  oopif: async () => {
    let child
    const main = await fx.start('127.0.0.1', { childOrigin: () => child.origin })
    child = await fx.start('127.0.0.1', { label: 'localhost' })
    const runs = []
    for (const pathName of ['network', 'durableConfigure', 'durableEnable', 'fetch']) {
      runs.push(await render(`${main.origin}/frame-parent`, pathName, { settle: 2000 }))
    }
    // Fetch on the page's session only: does it see what runs in the child targets?
    runs.push({
      variant: 'fetch on the page session only',
      ...(await render(`${main.origin}/frame-parent`, 'fetch', { settle: 2000, childPath: false }))
    })
    write('oopif.json', { versions: process.versions, mainLog: main.log, childLog: child.log, runs })
    main.server.close()
    child.server.close()
  }
}

app.whenReady().then(async () => {
  try {
    await MODES[MODE]()
    console.log(`spike ${MODE}: done`)
  } catch (e) {
    console.error(`spike ${MODE}: failed`, e)
    process.exitCode = 1
  }
  app.exit(process.exitCode ?? 0)
})
app.on('window-all-closed', () => {})
```

### Playwright driver: `pw.mjs`

```js
// Launches main.cjs through Playwright's Electron driver, as the e2e suite launches the app, and
// evaluates a script in each hidden window while the harness holds it open.
import { createRequire } from 'module'
import { writeFileSync } from 'fs'
import { join } from 'path'

const [repo, out] = process.argv.slice(2)
const require = createRequire(join(repo, 'package.json'))
const { _electron } = require('@playwright/test')

const app = await _electron.launch({
  executablePath: join(repo, 'node_modules/electron/dist/electron'),
  args: [join(import.meta.dirname, 'main.cjs')],
  env: { ...process.env, SPIKE_MODE: 'pw', SPIKE_OUT: out }
})
const seen = new Set()
const log = []
const closed = new Promise((resolve) => app.process().on('exit', (code) => resolve(code)))
let exited = false
closed.then(() => (exited = true))
while (!exited && seen.size < 3) {
  for (const page of app.windows()) {
    if (seen.has(page)) continue
    let title
    try {
      title = await page.title()
    } catch {
      continue
    }
    if (title !== 'done' || !page.url().includes('/host')) continue
    seen.add(page)
    const evaluated = await page
      .evaluate(async () => {
        const r = await fetch('/w1252?pw')
        const bytes = new Uint8Array(await r.arrayBuffer())
        return { href: location.href, title: document.title, fetchedHex: [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('') }
      })
      .catch((e) => ({ error: String(e) }))
    log.push({ url: page.url(), evaluated })
    await app.evaluate((_electron, r) => {
      global.pwResult = r
      global.pwDone = true
    }, evaluated)
  }
  await new Promise((r) => setTimeout(r, 100))
}
const code = await closed
writeFileSync(join(out, 'pw-driver.json'), JSON.stringify({ windowsEvaluated: seen.size, log, exitCode: code }, null, 2))
console.log(`pw driver: evaluated ${seen.size} windows, app exit ${code}`)
```

### Results assembly: `assemble.cjs`

```js
// Joins the harness outputs into one results file. Run: node assemble.cjs <out dir> <target file>
const fs = require('fs')
const path = require('path')

const [out, target, e2eDir] = process.argv.slice(2)
const read = (name) => JSON.parse(fs.readFileSync(path.join(out, name), 'utf8'))
const short = (url) => (url ?? '').replace(/^http:\/\/[^/]+/, '')
const session = (sid) => (sid ? 'child' : 'page')

const row = (pathName, kind) => (r) => {
  const keep = { path: pathName, kind, url: short(r.url), session: session(r.sid), method: r.method }
  for (const k of [
    'base64Encoded',
    'returned',
    'storedHex',
    'servedHex',
    'returnedLength',
    'storedLength',
    'storedSha256',
    'servedLength',
    'servedSha256',
    'matchesServed',
    'error',
    'bufferedLength',
    'dataEvents',
    'dataChunks'
  ]) {
    if (r[k] !== undefined) keep[k] = r[k]
  }
  return keep
}

const rowsOf = (file) =>
  read(file).runs.flatMap((run) => {
    const kind = /\/host(\?|$)/.test(run.url) ? 'subresource' : 'document'
    return run.results
      .filter((r) => r.servedHex !== undefined || r.servedSha256 !== undefined || r.error !== undefined)
      .filter((r) => !/\/host(\?|$)/.test(r.url ?? ''))
      .map(row(run.path, kind))
  })

const targets = (run) => ({
  path: run.path,
  variant: run.variant,
  page: short(run.url),
  loadResult: run.loadResult,
  attached: run.events.filter((e) => e.method === 'Target.attachedToTarget').map((e) => e.type),
  setupAnswers: run.setupAnswers.map(({ type, answers, resume }) => ({ type, answers, resume })),
  paused: run.events
    .filter((e) => e.method === 'Fetch.requestPaused')
    .map((e) => ({ url: short(e.url), session: session(e.sid) })),
  bodies: run.results
    .filter((r) => r.servedHex !== undefined || r.error !== undefined)
    .map(row(run.path, 'subresource'))
})

const protocol = read('protocol.json')
const wanted = {
  Network: [
    'enable',
    'configureDurableMessages',
    'getResponseBody',
    'streamResourceContent',
    'loadNetworkResource',
    'getResponseBodyForInterception',
    'takeResponseBodyForInterceptionAsStream',
    'setRequestInterception'
  ],
  Fetch: ['enable', 'getResponseBody', 'takeResponseBodyAsStream', 'continueRequest', 'fulfillRequest'],
  IO: ['read', 'close'],
  Page: ['getResourceContent']
}
const commands = protocol.protocol.domains.flatMap(({ domain, commands: list }) =>
  (list ?? [])
    .filter(({ name }) => wanted[domain]?.includes(name))
    .map(({ name, experimental, deprecated, description, parameters }) => ({
      command: `${domain}.${name}`,
      experimental: experimental === true,
      deprecated: deprecated === true,
      description,
      parameters: (parameters ?? []).map((p) => ({
        name: p.name,
        experimental: p.experimental === true,
        description: p.description
      }))
    }))
)

const latency = read('latency.json')
const consent = read('consent.json')
const pw = read('pw.json')
const pwDriver = read('pw-driver.json')

const results = {
  spike: '#1983',
  runtime: read('paths.json').versions,
  browserVersion: protocol.version.Browser,
  protocolVersion: protocol.version['Protocol-Version'],
  commands,
  paths: rowsOf('paths.json'),
  pathsServerRequests: Object.entries(
    read('paths.json').serverLog.reduce((n, { url }) => ({ ...n, [url]: (n[url] ?? 0) + 1 }), {})
  ).map(([url, requests]) => ({ url, requests })),
  largeBodies: {
    networkEnableLimits: rowsOf('big.json'),
    durableLimits1e6Total1e6Resource: rowsOf('durable-small.json'),
    durableLimits50e6Total1e6Resource: rowsOf('durable-resource.json')
  },
  slowStream: rowsOf('slow.json'),
  consent: consent.runs.map((run) => ({
    path: run.path,
    title: run.title,
    events: run.events
      .filter(
        (e) =>
          /spike-blocked/.test(e.url ?? '') || e.method === 'Network.loadingFailed' || e.method === 'Fetch.requestPaused'
      )
      .map(({ method, url, errorText, canceled, blockedReason, responseStatusCode }) => ({
        method,
        url: short(url),
        errorText,
        canceled,
        blockedReason,
        responseStatusCode
      })),
    bodies: run.results.filter((r) => r.servedHex !== undefined).map(row(run.path, 'subresource'))
  })),
  consentServerLog: consent.serverLog.map(({ url }) => url),
  frames: read('oopif.json').runs.map(targets),
  framesServerRequests: Object.entries(
    [...read('oopif.json').mainLog, ...read('oopif.json').childLog].reduce(
      (n, { url }) => ({ ...n, [url]: (n[url] ?? 0) + 1 }),
      {}
    )
  ).map(([url, requests]) => ({ url, requests })),
  serviceWorkers: read('sw.json').runs.map(targets),
  latency: {
    subresources: latency.n * 3,
    reps: latency.reps,
    runs: latency.runs.map(({ rep, path: p, skipBodies, loadMs, doneMs, requests, paused, bodies }) => ({
      rep,
      path: p,
      skipBodies,
      loadMs,
      doneMs,
      requests,
      paused,
      bodies
    }))
  },
  playwright: {
    driver: pwDriver,
    runs: pw.runs.map((run) => ({
      path: run.path,
      enable: run.enable,
      autoAttach: run.autoAttach,
      pathSetup: run.pathSetup,
      title: run.title,
      evaluatedWhileHeld: run.pwDone,
      bodies: run.results.filter((r) => r.servedHex !== undefined).map(row(run.path, 'subresource'))
    }))
  }
}
const RENDER_FILES = ['paths.json', 'big.json', 'durable-small.json', 'durable-resource.json', 'slow.json', 'consent.json', 'oopif.json', 'sw.json']
results.renders = RENDER_FILES.flatMap((file) =>
  read(file).runs.map(({ path: p, url, enable, autoAttach, pathSetup, loadResult }) => ({
    file,
    path: p,
    url: short(url),
    enable,
    autoAttach,
    pathSetup,
    loadResult
  }))
)
results.hostEventCounts = read('paths.json')
  .runs.filter((run) => /\/host$/.test(run.url))
  .map((run) => ({
    path: run.path,
    counts: run.events.reduce((n, { method }) => ({ ...n, [method]: (n[method] ?? 0) + 1 }), {})
  }))
if (e2eDir) {
  results.e2eRenders = fs
    .readdirSync(e2eDir)
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(e2eDir, f), 'utf8')))
    .map(({ url, spikeSetup, spikeBodies }) => ({
      url: short(url),
      setup: spikeSetup,
      bodies: spikeBodies.map((b) => ({ ...b, url: short(b.url), sid: undefined, session: session(b.sid) }))
    }))
}
fs.writeFileSync(target, JSON.stringify(results, null, 2) + '\n')
console.log(`wrote ${target}`)
```

### Queries: `queries.sh`

```shell
#!/usr/bin/env bash
# The jq queries the spike page quotes, run against the committed results file.
set -u
J=docs/specs/2026-10-26-transaction-record-charset-spike-results.json
q() {
  echo "### $1"
  shift
  jq -r "$@" "$J"
  echo "exit=$?"
}
q runtime '.runtime | "electron \(.electron), chrome \(.chrome), node \(.node), v8 \(.v8)"'
q commands '.commands[] | [.command, "experimental=\(.experimental)", "deprecated=\(.deprecated)"] | @tsv'
q durable-params '.commands[] | select(.command == "Network.enable") | .parameters[] | select(.name == "enableDurableMessages") | .description'
q interception '.commands[] | select(.command | test("ForInterception|setRequestInterception")) | "\(.command): \(.description | split("\n")[0])"'
q bypath '.paths | group_by(.path) | .[] | [.[0].path, "rows=\(length)", "match=\(map(select(.matchesServed == true)) | length)", "differ=\(map(select(.matchesServed == false)) | length)", "error=\(map(select(.error != null)) | length)"] | @tsv'
q documents '.paths[] | select(.kind == "document" and (.path == "network" or .path == "durableConfigure")) | [.path, .url, .servedHex, "base64Encoded=\(.base64Encoded)", .storedHex, "match=\(.matchesServed)"] | @tsv'
q subtypes '.paths[] | select(.kind == "subresource" and (.url | test("css1252|js1252|png"))) | select(.path == "network" or .path == "durableConfigure" or .path == "fetch") | [.path, .url, "base64Encoded=\(.base64Encoded)", "match=\(.matchesServed)"] | @tsv'
q strings '.paths[] | select((.path | startswith("durable")) and .base64Encoded == false) | [.path, .kind, .url, (.returned | @json)] | @tsv'
q fetchreturns '[.paths[] | select(.path == "fetch" or .path == "fetchStream") | .base64Encoded] | group_by(.) | map("base64Encoded=\(.[0]) rows=\(length)") | .[]'
q others '[.paths[] | select(.path == "stream" or .path == "pageResource") | [.path, .kind, .method, (.error // (if .matchesServed then "matches" else "differs" end))] | join(" | ")] | group_by(.) | map("\(length) x \(.[0])") | .[]'
q slow '.slowStream[] | [.url, "bufferedLength=\(.bufferedLength)", "dataChunks=\(.dataChunks)", "match=\(.matchesServed)"] | @tsv'
q refetch '.pathsServerRequests[] | select(.url == "/w1252" or .url == "/w1252?sub" or .url == "/host") | [.url, .requests] | @tsv'
q large '.largeBodies | to_entries[] | .key as $k | .value[] | [$k, .path, .url, (.error // "base64Encoded=\(.base64Encoded) stored=\(.storedLength // (.storedHex | length / 2)) served=\(.servedLength // (.servedHex | length / 2)) match=\(.matchesServed)")] | @tsv'
q latency '.latency.runs | group_by("\(.path) \(.skipBodies)") | .[] | (map(.doneMs) | sort) as $d | [.[0].path, "skipBodies=\(.[0].skipBodies)", "runs=\(length)", "median=\($d[length / 2 | floor])", "min=\($d[0])", "max=\($d[-1])", "requests=\(map(.requests) | unique)", "paused=\(map(.paused) | unique)", "bodies=\(map(.bodies) | unique)"] | @tsv'
q consent '.consent[] | .path as $p | .events[] | [$p, .method, .url, (.errorText // ""), (.blockedReason // ""), (.responseStatusCode // "" | tostring)] | @tsv'
q consent-server '.consentServerLog | group_by(.) | map("\(.[0]) \(length)") | .[]'
q frames '.frames[] | "\(.path)\(if .variant then " (" + .variant + ")" else "" end): load=\(.loadResult) attached=\(.attached | join(",")) setup=\([.setupAnswers[] | "\(.type):\(.answers | join("/"))"] | join("; "))"'
q frame-bodies '.frames[] | (.path + (if .variant then " (page only)" else "" end)) as $p | .bodies[] | select(.servedHex != null) | [$p, .url, .session, "match=\(.matchesServed)"] | @tsv'
q frame-paused '.frames[] | select(.path == "fetch") | (.variant // "every frame session") as $v | [$v, ([.paused[] | "\(.url)@\(.session)"] | join(" "))] | @tsv'
q sw '.serviceWorkers[] | .page as $page | .path as $p | .bodies[] | select(.servedHex != null or .error != null) | [$p, $page, .url, .session, "match=\(.matchesServed)", (.error // "")] | @tsv'
q sw-setup '.serviceWorkers[] | [.path, .page, ([.setupAnswers[] | "\(.type):\(.answers | join("/")),resume=\(.resume)"] | join("; "))] | @tsv'
q playwright '.playwright.driver | "windowsEvaluated=\(.windowsEvaluated) exitCode=\(.exitCode)", (.log[] | "\(.url | sub("http://[^/]+"; "")) fetched \(.evaluated.fetchedHex)")'
q playwright-runs '.playwright.runs[] | [.path, "enable=\(.enable)", "autoAttach=\(.autoAttach)", "pathSetup=\(.pathSetup)", "held=\(.evaluatedWhileHeld)", "match=\(.bodies | map(select(.matchesServed == true)) | length)/\(.bodies | length)"] | @tsv'
q e2e '.e2eRenders[] | [.url, ([.setup[] | "\(.page // .type)=\(.a)"] | join(" ")), ([.bodies[] | "\(.url) base64Encoded=\(.base64Encoded) length=\(.length)"] | join(" "))] | @tsv'
q frames-server '.framesServerRequests[] | "\(.url) \(.requests)"'
q network-base64 '.paths[] | select(.path == "network" and .base64Encoded == true) | [.kind, .url, "match=\(.matchesServed)"] | @tsv'
q renders '.renders | group_by("\(.enable) \(.autoAttach) \(.loadResult)") | .[] | "Network.enable=\(.[0].enable) Target.setAutoAttach=\(.[0].autoAttach) loadURL=\(.[0].loadResult) renders=\(length)"'
q renders-setup '[.renders[] | select(.pathSetup != "none") | "\(.path) setup=\(.pathSetup)"] | group_by(.) | map("\(.[0]) renders=\(length)") | .[]'
q host-events '.hostEventCounts[] | select(.path == "network" or .path == "durableConfigure" or .path == "fetch") | [.path, (.counts | to_entries | map("\(.key)=\(.value)") | join(" "))] | @tsv'
```

### Scratch renderer change

Applied for row 13 and reverted after it. Never committed.

```diff
diff --git i/src/main/services/backgroundRenderer.ts w/src/main/services/backgroundRenderer.ts
index 79c918bb..48353a3d 100644
--- i/src/main/services/backgroundRenderer.ts
+++ w/src/main/services/backgroundRenderer.ts
@@ -509,6 +509,76 @@ export const renderPageInHiddenWindow: RenderPage = async (url, { timeoutMs }) =
     // it. Network-idle is tracked out-of-band via the session's webRequest API.
     wc.debugger.attach('1.3')
 
+    // SPIKE-1983 scratch, never committed: the durable-messages body path.
+    const spikeOut = process.env.BIRDBRAIN_SPIKE_OUT
+    const spikeBodies: Record<string, unknown>[] = []
+    const spikeUrls = new Map<string, string>()
+    const spikePending: Promise<unknown>[] = []
+    const spikeSetup: Record<string, unknown>[] = []
+    if (spikeOut) {
+      const limits = { maxTotalBufferSize: 50e6, maxResourceBufferSize: 10e6 }
+      const send = (m: string, p: object, sid: string) =>
+        sid ? wc.debugger.sendCommand(m, p, sid) : wc.debugger.sendCommand(m, p)
+      const answer = (p: Promise<unknown>) =>
+        p.then(
+          () => 'ok',
+          (e) => String(e)
+        )
+      wc.debugger.on('message', (_e, method, params, sessionId) => {
+        const sid = sessionId || ''
+        if (method === 'Network.requestWillBeSent') {
+          spikeUrls.set(params.requestId, params.request.url)
+        }
+        if (method === 'Target.attachedToTarget') {
+          const child = params.sessionId
+          const type = params.targetInfo.type
+          const auto = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }
+          const cmds = [
+            answer(send('Network.enable', limits, child)),
+            answer(send('Network.configureDurableMessages', limits, child)),
+            answer(send('Target.setAutoAttach', auto, child))
+          ]
+          if (type === 'service_worker') {
+            cmds.push(answer(send('Runtime.runIfWaitingForDebugger', {}, child)))
+            spikePending.push(Promise.all(cmds).then((a) => spikeSetup.push({ type, a })))
+          } else if (type === 'iframe' || type === 'worker') {
+            spikePending.push(
+              Promise.all(cmds).then(async (a) => {
+                const resume = await answer(send('Runtime.runIfWaitingForDebugger', {}, child))
+                spikeSetup.push({ type, a, resume })
+              })
+            )
+          } else {
+            spikePending.push(answer(send('Runtime.runIfWaitingForDebugger', {}, child)))
+          }
+        }
+        if (method === 'Network.loadingFinished') {
+          const { requestId } = params
+          spikePending.push(
+            send('Network.getResponseBody', { requestId }, sid).then(
+              (r) => {
+                const { body, base64Encoded } = r as { body: string; base64Encoded: boolean }
+                spikeBodies.push({ url: spikeUrls.get(requestId), sid, base64Encoded, length: body.length })
+              },
+              (e) => spikeBodies.push({ url: spikeUrls.get(requestId), sid, error: String(e) })
+            )
+          )
+        }
+      })
+      await wc.loadURL('about:blank')
+      spikeSetup.push({ page: 'Network.enable', a: await answer(send('Network.enable', limits, '')) })
+      spikeSetup.push({
+        page: 'Network.configureDurableMessages',
+        a: await answer(send('Network.configureDurableMessages', limits, ''))
+      })
+      spikeSetup.push({
+        page: 'Target.setAutoAttach',
+        a: await answer(
+          send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, '')
+        )
+      })
+    }
+
     // Neutralize consent/cookie-notice overlays before the page loads: the fresh
     // session guarantees every consent wall fires, and walls scroll-lock the page
     // (starving the lazy-load phase) and obscure the screenshot. Fail-soft — a
@@ -558,6 +628,14 @@ export const renderPageInHiddenWindow: RenderPage = async (url, { timeoutMs }) =
         NETWORK_IDLE_MS,
         clampPhaseMs(remainingMs(FINAL_ARTIFACT_RESERVE_MS), POST_SCROLL_NETWORK_IDLE_MAX_MS)
       )
+      if (spikeOut) {
+        await Promise.allSettled(spikePending)
+        const { writeFileSync } = await import('fs')
+        writeFileSync(
+          join(spikeOut, `render-${Date.now()}.json`),
+          JSON.stringify({ url, spikeSetup, spikeBodies }, null, 2)
+        )
+      }
       await sleep(Math.min(FINAL_SETTLE_MS, remainingMs(FINAL_ARTIFACT_RESERVE_MS)))
 
       const screenshot = await captureFullPageScreenshot(wc)
```
