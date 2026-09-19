# Persona bot-detection spike

Feasibility read for [#545](https://github.com/thebristolsound/birdbrain/issues/545), part of the persona map [#541](https://github.com/thebristolsound/birdbrain/issues/541). Point-in-time reading at commit `f302737e` on 2026-09-19; the file and line citations below describe that commit and are not maintained.

This is a feasibility read only. It contains no anti-detection or fingerprint-spoofing recommendations, and it was written without logging in to any platform.

## Question

Does an Electron `webContents` on a persistent partition, logged in by hand and seeded with cookies exported from Chrome, survive bot detection on Facebook, Instagram, X, LinkedIn, Telegram Web, and a Cloudflare-fronted site well enough to support authenticated background capture? Output: a go or no-go per platform for option (b) on the mechanism ticket, with a confidence level and the evidence behind it.

## Method

1. Read `src/main/services/backgroundRenderer.ts` end to end and inventoried the observable fingerprint the current hidden-window render presents. Confirmed that nothing under `src/main` calls `setUserAgent` or sets `app.userAgentFallback`; the only `userAgent` reference in the renderer is the `wc.getUserAgent()` read at line 532 that stamps the value onto the capture.
2. Ran an unauthenticated smoke probe. A throwaway Electron main script (deleted after the run) reproduced the `BrowserWindow` configuration from `renderPageInHiddenWindow` (`show: false`, `sandbox`, `contextIsolation`, no `nodeIntegration`, a fresh `recapture-<uuid>` partition, `backgroundThrottling: false`, `offscreen: true`, `setFrameRate(30)`, deny-all `setPermissionRequestHandler`, deny `setWindowOpenHandler`, audio muted) and pointed it at a local `http` echo server on `127.0.0.1`. The server recorded the request headers of the navigation and of a second same-origin `fetch` issued after an `Accept-CH` response header, and the page recorded `navigator`, `screen`, `window`, permission, and WebGL facts. The probe did not attach `wc.debugger` and did not enable the consent blocker; both are noted in the inventory where they matter. The app directory used `name: "birdbrain"` so the product token in the user agent matches what the packaged app sends (`package.json` `name` is `birdbrain`; the packaged version token is `1.0.1-beta.21` where the probe shows `0.0.0-probe`).
3. Ran the same page in windowed Google Chrome `150.0.7871.181` under the same `Xvfb` display as a baseline, so every "differs from Chrome" row below is a measured difference, not an assumption. Both browsers ran with `--no-sandbox` under `xvfb-run --auto-servernum`; WebGL context creation returned `null` in both, so the WebGL row is undetermined rather than measured.
4. Sent one unauthenticated `HEAD` request per target host with a Chrome-shaped user agent and recorded the `server` header, to establish which targets sit behind Cloudflare.
5. Read primary sources only: Electron documentation and source pull requests, Chromium developer documentation, Cloudflare's developer documentation, and each platform's published terms and help pages. Where a page could not be rendered (the Instagram Terms of Use returned an error page to a plain `curl`; two X help pages returned a Cloudflare interstitial) the claim is marked as unverified in the text.

Runtime under test: Electron `44.3.0` on Chromium `152.0.7977.78` (`process.versions` reported by the probe).

## Fingerprint inventory of the current renderer

Values in the "Electron OSR" column are what the probe measured. The "Chrome baseline" column is windowed Google Chrome on the same display. "Trips?" is a judgement about whether a detector that compares against ordinary Chrome would notice the row, not a claim that any named platform checks it.

| Surface | Electron OSR (measured) | Chrome baseline (measured) | Trips? | Anchor |
| --- | --- | --- | --- | --- |
| `User-Agent` header and `navigator.userAgent` | `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) birdbrain/0.0.0-probe Chrome/152.0.7977.78 Electron/44.3.0 Safari/537.36` | `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36` | Yes. Two extra product tokens, `birdbrain/<version>` and `Electron/44.3.0`, and an unreduced Chrome version. No override anywhere in `src/main`; `session.getUserAgent()`, `webContents.getUserAgent()`, and `app.userAgentFallback` all returned the same string. | `renderPageInHiddenWindow`, line 376; `wc.getUserAgent()`, line 532. Electron documents the fallback as "the user agent that will be used when no user agent is set at the `webContents` or `session` level" ([app.userAgentFallback](https://www.electronjs.org/docs/latest/api/app)). |
| `Sec-CH-UA` brand list (`navigator.userAgentData.brands`) | `"Not?A_Brand";v="24", "Chromium";v="152"` | `"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"` | Yes, if the detector expects a `Google Chrome` brand. Electron's fix for empty hints deliberately sends only `Chromium`: "the `brands` field does not contain `Electron`, only `Chromium`" ([electron/electron#34481](https://github.com/electron/electron/pull/34481)). | Probe. |
| Client Hints on the first (navigation) request | None. No `sec-ch-ua*` header at all; `sec-fetch-*` headers present. | Low-entropy hints on every request; Chrome documents that "by default, the browser returns the browser brand, significant / major version, platform, and an indicator if the client is a mobile device" ([User-Agent Client Hints](https://developer.chrome.com/docs/privacy-security/user-agent-client-hints)). | Yes. A Chrome-versioned UA with no hints on the first request is the inconsistency Electron users hit in [electron/electron#34762](https://github.com/electron/electron/issues/34762): "low entropy hints are working from the second request (after receiving header 'Accept-CH' in the server response)." | Probe. |
| Client Hints after `Accept-CH` | Low-entropy only: `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`. No `arch`, `bitness`, `full-version-list`, `platform-version`, or `model` despite the server asking. | All requested high-entropy hints sent. | Yes. Matches the open report that "high entropy hints aren't working at all" ([electron/electron#34762](https://github.com/electron/electron/issues/34762)). An override API for hint metadata is proposed but unmerged ([electron/electron#53519](https://github.com/electron/electron/pull/53519)). | Probe. |
| `navigator.userAgentData.getHighEntropyValues()` (page-side) | Returns values (`architecture: x86`, `bitness: 64`, full version list with `Chromium` only). | Returns values including the `Google Chrome` brand. | Partly. The JavaScript API answers while the headers stay silent, which is itself an inconsistency between the two channels. | Probe. |
| `navigator.webdriver` | `false` | `false` | No. | Probe. |
| `navigator.plugins` / `mimeTypes` | 5 plugins (`PDF Viewer`, `Chrome PDF Viewer`, `Chromium PDF Viewer`, `Microsoft Edge PDF Viewer`, `WebKit built-in PDF`), 2 MIME types | Identical | No. | Probe. |
| `window.chrome` | `object` with no own keys | `object` with keys `loadTimes`, `csi`, `app` | Yes. The object exists but is empty; a detector that reads `window.chrome.app` or `window.chrome.csi` finds nothing. | Probe. |
| `HeadlessChrome` token | Absent | Absent | No. OSR is not Chromium's headless mode; the render is a real compositor writing to an offscreen surface ([Offscreen rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)). | Probe; `offscreen: true`, line 395. |
| `screen.width` / `screen.height` | `1280 x 900` (equal to the viewport) | `1280 x 1024` (the X display) | Yes. Under OSR the reported screen is the window. `availWidth`/`availHeight` match exactly, with no taskbar deduction. | Probe; `VIEWPORT`, line 14. |
| `window.outerWidth/Height` vs `innerWidth/Height` | outer `1280 x 900`, inner `1280 x 900` | outer `1280 x 900`, inner `1280 x 757` | Yes. Zero browser chrome, which ordinary desktop Chrome never reports. | Probe. |
| `document.hasFocus()` | `false` | `true` | Yes, weakly. A hidden window never has focus. | Probe. |
| `document.visibilityState` | `visible` | `visible` | No. OSR keeps the page visible to itself, which is why `IntersectionObserver` and `requestAnimationFrame` fire (the comment block at line 377 explains the choice). | Probe. |
| Permission state (`notifications`) | `permissions.query` = `granted`, `Notification.permission` = `granted` | `prompt` / `default` | Yes. The renderer sets a deny-all `setPermissionRequestHandler` (line 452) but no `setPermissionCheckHandler`, and Electron notes "you must also implement `setPermissionRequestHandler` to get complete permission handling. Most web APIs do a permission check and then make a permission request if the check is denied" ([session.setPermissionCheckHandler](https://www.electronjs.org/docs/latest/api/session)). The result is a page that reads as pre-granted for notifications without ever prompting. | Probe; line 452. |
| `Accept-Language` / `navigator.languages` | `en-US`; `["en-US", "en", "en"]` | `en-US,en;q=0.9`; `["en-US", "en"]` | Yes, weakly. No quality values and a duplicated `en`. | Probe. |
| `hardwareConcurrency`, `deviceMemory`, `platform`, time zone | `4`, `16`, `Linux x86_64`, host time zone | Identical | No. Real host values leak through, as in Chrome. | Probe. |
| WebGL vendor/renderer | `null` (no context under `Xvfb`) | `null` (same) | Undetermined. Not measurable on this display; a GPU host would need a re-run. | Probe. |
| Chrome Devtools Protocol artifacts (`cdc_` global variables, `Error.stack` getter invoked by `console.debug`) | None found | None found | Not tripped in the probe, but the probe did not attach the debugger. The real render attaches `wc.debugger` for the whole job (line 468) and never enables `Runtime` or other event domains (comment at line 465), which is the condition under which the `console.debug` serialization tell fires. Untested with the debugger attached. | Probe; line 468. |
| Cookies and storage | Fresh in-memory partition per job (`recapture-<uuid>`, line 393): no cookies, no `localStorage`, nothing persists. | Profile on disk | Yes, for any site that treats a cookie-less first visit as a new visitor. Cloudflare says "the first request from a new client to your website or application will generally not have JavaScript Detections data." ([JavaScript detections](https://developers.cloudflare.com/bots/additional-configurations/javascript-detections/)). A `persist:` partition changes this row; see the per-platform table. | Line 393; Electron: "If `partition` starts with `persist:`, the page will use a persistent session" ([session.fromPartition](https://www.electronjs.org/docs/latest/api/session)). |
| Request cancellation by the consent blocker | Cancels requests matching two cookie-consent filter lists via `onBeforeRequest`; main-frame requests are never cancelled (the `@ghostery/adblocker-electron` `onBeforeRequest` handler returns early for `isMainFrame()`). | None | Weakly. Cloudflare lists "ad blockers" among the "legitimate reasons a user might not have passed a JavaScript Detection challenge" ([JavaScript detections](https://developers.cloudflare.com/bots/additional-configurations/javascript-detections/)). The lists here are consent-manager rules only, not ad or tracker lists (`consentBlocker.ts`, `CONSENT_FILTER_LISTS`), so the exposure is narrower than a full ad blocker's. | `enableBlockingInSession`, line 482. |
| Scroll behaviour | Programmatic one-viewport steps with `behavior: 'instant'`, 500 ms pauses, until the page stops growing or reaches the pixel budget. | Human | Yes, for behavioural scoring. Not measured; noted because Cloudflare's machine-learning engine scores "request features (headers, session characteristics, and browser signals)" ([Bot detection engines](https://developers.cloudflare.com/bots/concepts/bot-detection-engines/)). | `scrollToLoadLazyContent`, line 215. |
| WebSocket handling | Ignored by the idle tracker (line 73); connections are otherwise unrestricted. | n/a | No. Relevant only because Telegram Web runs over WebSocket. | Line 73. |

Summary of the inventory: the render is consistent with Chromium and inconsistent with Chrome. Nothing in it says "headless" or "automation" in the words detectors historically keyed on (`navigator.webdriver`, `HeadlessChrome`, empty plugin lists). What it does say, on every request, is "Electron, not Chrome": the two extra UA tokens, the missing `Google Chrome` brand, the missing hints on the first request, the missing high-entropy hints on every request, the empty `window.chrome`, and a screen that is exactly the viewport.

## Per-platform go/no-go

Verdict values: **Go** means the primary sources give no reason to expect the current render to be refused and the platform's terms do not forbid the use. **Conditional** means the render layer is expected to work but a documented account-level or policy condition applies. **No-go** means either primary evidence of refusal or an explicit terms prohibition on automated access to the logged-in service. Confidence is about the evidence, not the outcome: "low" means the platform's detection is unpublished and no probe was run against it.

| Platform | Fronted by | Verdict | Confidence | Evidence |
| --- | --- | --- | --- | --- |
| Facebook | Meta's own edge (no `server` header returned to the probe `HEAD`) | **No-go** for authenticated background capture | Medium on terms, low on detection | Meta Terms of Service section 3.2, effective January 1, 2025: "You may not access or collect data from our Products using automated means (without our prior permission) or attempt to access data you do not have permission to access, regardless of whether such automated access or collection is undertaken while logged-in to a Facebook account." ([Meta Terms of Service](https://www.facebook.com/terms/)). The Automated Data Collection Terms, effective October 7, 2024, define the term to include "user-agents, and other automated or programmatic mechanisms designed to access, collect, or retrieve data or content directly from web pages" and require "Meta's express written permission" ([Automated Data Collection Terms](https://www.facebook.com/legal/automated_data_collection_terms)). A scheduled, unattended render is that. Detection internals are not published; Facebook does document alerts and security-code prompts for logins from unrecognized browsers ([Get alerts about unrecognized logins](https://www.facebook.com/help/162968940433354)), which a first login on the Electron partition will look like. |
| Instagram | Meta's own edge (same as above) | **No-go** for authenticated background capture | Medium on terms, low on detection | Instagram's own Terms of Use could not be fetched for this spike: `help.instagram.com/581066165581870` and its Facebook mirror returned an error page to an unauthenticated `curl`. The Automated Data Collection Terms apply to "Meta Company Products" and carry the prohibition quoted above ([Automated Data Collection Terms](https://www.facebook.com/legal/automated_data_collection_terms)). Instagram's terms are reported by the search index to say the same ("accessing or collecting information in an automated way without our express permission.") That wording is unverified here. |
| X (Twitter) | Cloudflare (`server: cloudflare` and a `cf-ray` header on `x.com`; `help.x.com` returned a "Just a moment..." interstitial to `curl`) | **No-go** for authenticated background capture | Medium-high on terms, medium on the Cloudflare layer, low on X's own detection | X Terms of Service as published on `x.com/en/tos` are headed Effective: October 9, 2026. Users may not access the Services "by any means (automated or otherwise) other than through our currently available, published interfaces," and "crawling or scraping the Services in any form, for any purpose without our prior written consent is expressly prohibited" (fetched by `curl`, 2026-09-19). The Cloudflare layer by itself is not the blocker: see the Cloudflare row below. X documents locking accounts for "suspicious automated behavior" with phone, email, or reCAPTCHA verification ([Locked or restricted X accounts](https://help.x.com/en/managing-your-account/locked-and-limited-accounts)); that page could not be rendered for this spike and the wording is from the search index. |
| LinkedIn | Cloudflare (`server: cloudflare`, `cf-ray` on `www.linkedin.com`) | **No-go** for authenticated background capture | Medium-high on terms, medium on the Cloudflare layer, low on LinkedIn's own detection | User Agreement effective November 3, 2025, section 8.2: do not "use bots or other unauthorized automated methods to access the Services," do not "develop, support or use software, devices, scripts, robots or any other means or processes (such as crawlers, browser plugins and add-ons)" to scrape, and do not "override any security feature or bypass or circumvent any access controls or use limits of the Services" ([LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement)). LinkedIn's help page says members using such tools "risk having their accounts restricted or shut down" ([Prohibited software and extensions](https://www.linkedin.com/help/linkedin/answer/a1341387)). Sign-in from "an unfamiliar location or device" triggers a push prompt, email code, or CAPTCHA ([Security verification when signing in](https://www.linkedin.com/help/linkedin/answer/a1339220)). |
| Telegram Web | Telegram's own edge (`server: nginx/1.30.1` on `web.telegram.org`) | **Conditional go** | Medium | Telegram Web K and Web A are official Telegram applications ([Telegram apps](https://telegram.org/apps)); loading `web.telegram.org/k/` in Electron runs Telegram's own client code with Telegram's own `api_id` (`VITE_API_ID=1025907` in the [Telegram-web-k `.env`](https://github.com/TelegramOrg/Telegram-web-k/blob/master/.env)), speaking Telegram's own wire protocol over WebSocket (`VITE_MTPROTO_HAS_WS=1`, same file). Telegram's API terms welcome third-party clients and forbid "making actions on behalf of the user without the user's knowledge and consent" ([Telegram API Terms of Service](https://core.telegram.org/api/terms)); a capture the user scheduled is not that. Two conditions. First, there is no cookie to seed: the client keeps session state in `localStorage` (`account1..account4: AccountSessionData` and the older `dc1_auth_key` keys in [`src/lib/sessionStorage.ts`](https://github.com/morethanwords/tweb/blob/master/src/lib/sessionStorage.ts)), so the "cookies from a cookie file" premise does not apply and the login must happen inside the persistent partition. Second, each client session sends `device_model`, `system_version`, and `app_version` in [`initConnection`](https://core.telegram.org/method/initConnection) and appears in the account's active sessions; what the web client fills those from was not verified here. Telegram also states that "all accounts that log in using unofficial Telegram API clients are automatically put under observation" ([Obtaining `api_id`](https://core.telegram.org/api/obtaining_api_id)); the official web client on the official `api_id` should not count, but Telegram decides that, not this document. |
| Generic Cloudflare-fronted site | Cloudflare | **Conditional go** at the render layer | Medium | Cloudflare's JavaScript Detections engine "identifies headless browsers and other malicious fingerprints" ([Bot detection engines](https://developers.cloudflare.com/bots/concepts/bot-detection-engines/)); the render is not headless Chrome and carries none of its historical markers (inventory above). Two independent Electron apps report that the stock Electron user agent clears Turnstile and managed challenges while a Chrome-shaped UA without hints does not: "a Chrome UA that ships no client hints reads as a spoof and Turnstile returns 600010" and "the same binary on the same IP clears every challenge with its stock UA" ([stablyai/orca#18749](https://github.com/stablyai/orca/pull/18749)); a minimal reproduction found "Native UA: passes," "Stripping Electron token: fails (600010 loop)" ([pingdotgg/t3code#7110](https://github.com/pingdotgg/t3code/pull/7110)). Those are third-party reports, not Cloudflare statements. Conditions: Bot Management scores of 1 to 29 are "likely automated" ([Bot scores](https://developers.cloudflare.com/bots/concepts/bot-score/)) and where a site's rules act on them the outcome depends on that site's plan and rules; a Managed Challenge that needs interaction cannot be solved in a hidden window and the capture will contain the interstitial; and `cf_clearance` "is securely tied to the specific visitor and device it was issued to, preventing reuse across machines." ([Clearance](https://developers.cloudflare.com/cloudflare-challenges/concepts/clearance/)), so a clearance cookie exported from Chrome will not carry over and the partition has to earn its own. |

Reading the table as a whole: for the four social platforms the blocker is the terms, not the fingerprint. Even if the render passed every check, an unattended authenticated capture is the conduct each platform names. The persona map's fallback, "persona mode is label + session context only, with real Chrome profiles doing the browsing" ([#541](https://github.com/thebristolsound/birdbrain/issues/541)), is the option this evidence supports for those four. Telegram Web and ordinary Cloudflare-fronted sites are where the Electron partition is worth building.

## Maintainer ruling (2026-09-19)

The maintainer read the table above and ruled that terms-of-service exposure on a sock account
is the user's risk to accept, not a reason for the tool to refuse a platform. The verdicts
therefore split by mechanism, and the terms rows above stay as the disclosure the tester guide
carries:

| Platform | Unattended render on the persona partition (#1499) | Persona window, human present (#1505, phase 3b) |
| --- | --- | --- |
| Facebook, Instagram | Unknown until probed authenticated; the fingerprint rows above are the risk | Go: the user clears any checkpoint by hand |
| X, LinkedIn | Unknown; Cloudflare layer expected to pass on the stock UA, platform detection unpublished | Go |
| Telegram Web | Conditional go as above | Go, and the only way to log in, since state is `localStorage` |
| Cloudflare-fronted site | Conditional go as above | Go; a managed challenge is answered in the window |

No fingerprint spoofing follows from this ruling. The persona window is the path for the four
social platforms; the unattended render is measured against them once #1499 exists.

## What trips detection versus what does not

Split as the ticket asked: (a) fires on any Electron render regardless of login, (b) account-level, (c) policy.

### (a) Heuristics that fire on any Electron render

- **The user agent names the app and the framework.** `birdbrain/<version>` and `Electron/44.3.0` are on every request. Any allowlist of browser families reads this as "not Chrome." Google documents exactly that policy for its own sign-in: browsers "embedded in a different application" or "being controlled through software automation rather than a human" are refused with "This browser or app may not be secure." ([Google Account Help](https://support.google.com/accounts/answer/7675428)). That matters here because a persona account that signs in with "Continue with Google" cannot complete that flow inside the partition.
- **Client Hints do not match the UA.** No hints on the first request, low-entropy only after `Accept-CH`, no `Google Chrome` brand. Any detector that cross-checks `User-Agent` against `Sec-CH-UA` sees a Chromium build that is not Chrome. Measured in the probe and consistent with [electron/electron#34762](https://github.com/electron/electron/issues/34762).
- **`window.chrome` is empty** where Chrome exposes `loadTimes`, `csi`, and `app`. Measured.
- **Screen equals viewport and outer equals inner.** An OSR window reports no monitor and no browser chrome. Measured.
- **Permission checks answer `granted` without a prompt** because only the request handler is set. Measured; the Electron docs quoted in the inventory explain why.
- **The page never has focus.** Measured.
- **Every job today is a first-time visitor** with no cookies or storage (`recapture-<uuid>`). This is the one row a `persist:` partition fixes outright.
- **Scrolling is mechanical.** Fixed-size instant steps at fixed intervals. Not measured against any scorer; listed because behavioural scoring is in scope for Cloudflare's machine-learning engine.

### What does not trip

- `navigator.webdriver` is `false`, the plugin and MIME lists are identical to Chrome's, and there is no `HeadlessChrome` token. The renderer is not Chromium's headless mode and does not run under WebDriver.
- No `cdc_` global variables and no `Error.stack` serialization tell in the probe. The real render does attach the Devtools debugger, and that condition was not probed; the comment in the renderer records that no CDP event domains are enabled.
- Host facts (`hardwareConcurrency`, `deviceMemory`, `platform`, time zone) are real, not synthetic.
- TLS and HTTP/2 come from Chromium's own network stack. One of the third-party reports asserts the resulting fingerprints are "identical to authentic Chromium" ([stablyai/orca#18749](https://github.com/stablyai/orca/pull/18749)); that was not measured here.

### (b) Account-level

See the next section.

### (c) Policy

See "Out of scope."

## Account-level risk

Three mechanisms, in the order they bite.

**A first login on the partition is a new-device login.** Facebook ([unrecognized login alerts](https://www.facebook.com/help/162968940433354)), LinkedIn ("an unfamiliar location or device," [Security verification when signing in](https://www.linkedin.com/help/linkedin/answer/a1339220)), and X (new-device login alerts, per the search index; page not rendered) all document a challenge or notification on a login from an unrecognized browser. The map already plans "a visible login window on that partition (user completes 2FA/captcha by hand)" ([#541](https://github.com/thebristolsound/birdbrain/issues/541)), which is the right shape: the challenge is expected and a human answers it once. The risk is not the first challenge but the second: whether the platform keeps treating the Electron partition as recognized, or re-challenges on each render because the fingerprint keeps scoring as unusual. No platform publishes that policy, and this spike did not test it.

**Cookies exported from Chrome and replayed in Electron arrive with a different user agent and a different Client Hints set.** Whether Meta, LinkedIn, or X bind a session cookie to the user agent or the hint set is not published, and this spike makes no claim either way. The one binding that is published is Cloudflare's: `cf_clearance` "is securely tied to the specific visitor and device it was issued to." ([Clearance](https://developers.cloudflare.com/cloudflare-challenges/concepts/clearance/)). Expect a replayed clearance to be ignored and a fresh challenge to run. For Telegram Web the question is moot: there is no cookie to replay, only `localStorage`.

**Automated-behaviour locks are account-level, not render-level.** X documents locking accounts that show "suspicious automated behavior" (per the search index; page not rendered), LinkedIn documents restriction for members using prohibited tools ([Prohibited software and extensions](https://www.linkedin.com/help/linkedin/answer/a1341387)), and Telegram documents observation of accounts on unofficial clients ([Obtaining `api_id`](https://core.telegram.org/api/obtaining_api_id)). The account at stake is the persona's, which for the round-1 testers is a sock account they have invested in. Losing it is the cost of a false positive.

## Out of scope

One line each, as the ticket asked.

- **Legal.** Whether a terms-of-service breach is unlawful, and the state of the scraping case law, is a legal question outside this spike; the terms quoted above are what the platforms assert, not a statement of what a court would hold.
- **Anti-detection.** Overriding the user agent, adding a `Google Chrome` brand, populating `window.chrome`, or faking screen metrics are all excluded by [#541](https://github.com/thebristolsound/birdbrain/issues/541) and by the evidence baseline in [ADR-0004](../adr/0004-adopt-osint-assurance-baseline.md): a capture that lies about its browser lies in the Manifest too.
- **Live account probes.** No login to any platform was attempted. Every "low" confidence in the table is a place where only a live probe with a disposable account would raise it, and that decision belongs to the maintainer.

## Sources

Electron:

- [app.userAgentFallback](https://www.electronjs.org/docs/latest/api/app)
- [session.setUserAgent, session.fromPartition, session.setPermissionCheckHandler](https://www.electronjs.org/docs/latest/api/session)
- [webContents.setUserAgent, getUserAgent](https://www.electronjs.org/docs/latest/api/web-contents)
- [Offscreen rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)
- [electron/electron#30201 Possibly broken user agent client hint](https://github.com/electron/electron/issues/30201)
- [electron/electron#34481 fix: make navigator.userAgentData non-empty](https://github.com/electron/electron/pull/34481)
- [electron/electron#34762 Missing user agent client hints](https://github.com/electron/electron/issues/34762)
- [electron/electron#53519 feat: support overriding user agent metadata (open)](https://github.com/electron/electron/pull/53519)

Chromium:

- [User-Agent Client Hints](https://developer.chrome.com/docs/privacy-security/user-agent-client-hints)
- [Chrome's new headless mode](https://developer.chrome.com/docs/chromium/new-headless)

Cloudflare:

- [Bot scores](https://developers.cloudflare.com/bots/concepts/bot-score/)
- [Bot detection engines](https://developers.cloudflare.com/bots/concepts/bot-detection-engines/)
- [JavaScript detections](https://developers.cloudflare.com/bots/additional-configurations/javascript-detections/)
- [Turnstile](https://developers.cloudflare.com/turnstile/)
- [Challenge clearance](https://developers.cloudflare.com/cloudflare-challenges/concepts/clearance/)
- [Cloudflare cookies](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/)

Third-party Electron reports on Turnstile:

- [stablyai/orca#18749](https://github.com/stablyai/orca/pull/18749)
- [pingdotgg/t3code#7110](https://github.com/pingdotgg/t3code/pull/7110)

Platform terms and help:

- [Meta Terms of Service](https://www.facebook.com/terms/)
- [Meta Automated Data Collection Terms](https://www.facebook.com/legal/automated_data_collection_terms)
- [Facebook: get alerts about unrecognized logins](https://www.facebook.com/help/162968940433354)
- [Instagram Terms of Use](https://help.instagram.com/581066165581870) (not rendered for this spike)
- [X Terms of Service](https://x.com/en/tos)
- [X: locked or restricted accounts](https://help.x.com/en/managing-your-account/locked-and-limited-accounts) (not rendered for this spike)
- [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement)
- [LinkedIn: prohibited software and extensions](https://www.linkedin.com/help/linkedin/answer/a1341387)
- [LinkedIn: security verification when signing in](https://www.linkedin.com/help/linkedin/answer/a1339220)
- [Telegram apps](https://telegram.org/apps)
- [Telegram API Terms of Service](https://core.telegram.org/api/terms)
- [Telegram: obtaining `api_id`](https://core.telegram.org/api/obtaining_api_id)
- [Telegram: `initConnection`](https://core.telegram.org/method/initConnection)
- [Telegram Web K `.env`](https://github.com/TelegramOrg/Telegram-web-k/blob/master/.env)
- [Telegram Web K `sessionStorage.ts`](https://github.com/morethanwords/tweb/blob/master/src/lib/sessionStorage.ts)
- [Google: "This browser or app may not be secure"](https://support.google.com/accounts/answer/7675428)

Repository:

- `src/main/services/backgroundRenderer.ts` at `f302737e`
- `src/main/services/consentBlocker.ts` at `f302737e`
- [#541 Persona / alias identity model](https://github.com/thebristolsound/birdbrain/issues/541)
- [#545 this spike](https://github.com/thebristolsound/birdbrain/issues/545)
