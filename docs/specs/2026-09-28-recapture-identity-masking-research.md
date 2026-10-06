# Recapture identity masking: research

Date: 2026-09-28. Point-in-time reading at commit `c2d730c8` on `main`, Electron `44.4.5`
(`package.json` declares `^44.4.5`; `pnpm-lock.yaml` resolves to 44.4.5). Electron source and
documentation citations are pinned to the `v44.4.5` tag. File and line citations into this
repository describe that commit and are not maintained.

Research only. This note answers what the sources say and ends with a recommendation on the
Persona ADR's exclusion ([ADR-0030](../adr/0030-persona-is-a-provenance-axis-beside-operator.md),
line 47). Nothing here is a decision, and nothing here describes shipped behavior except where it
cites the code.

## Question

How should a background Recapture protect the Operator's identity (IP address, user agent,
browser fingerprint) during an investigation, following the operational-security practice of
Michael Bazzell? Five parts:

1. What Bazzell recommends for network isolation and for browser fingerprint and user-agent
   handling, and how that advice changed across editions.
2. How comparable tools handle egress masking and user-agent presentation.
3. What Electron supports: per-session proxy, SOCKS5 and Tor, bypass rules, DNS behavior,
   user-agent override and its effect on `Sec-CH-UA`, and `setPermissionCheckHandler`.
4. How masked egress or a changed user agent should appear in capture provenance.
5. Whether to amend ADR-0030's exclusion, treating routing, removing the app's own name and
   version from the user agent, and full fingerprint impersonation separately.

## Answer in one paragraph

Every source that speaks to investigator practice treats **network routing** as ordinary
hygiene, not evasion: Bazzell sells a VPN-behind-a-firewall setup and builds his OSINT virtual
machine on a VPN-protected host, the Berkeley Protocol tells investigators to "use VPNs, proxies
or other software to mask their computers' IP addresses" (para. 101), and SWGDE recommends VPNs
or proxies and says to document the "access IP address, browser" of each acquisition (21-F-001
v1.1, sections 4.1 and 7.5). Electron can route one session through an HTTP or SOCKS5 proxy, with
proxy-side DNS for SOCKS5 and fail-closed behavior when no `direct://` fallback is listed, but
Birdbrain's own post-capture TLS re-fetch opens a direct socket to the target from the Operator's
IP, so routing the render alone does not hide the Operator. **Removing Birdbrain's name and version
from the user agent** is different from impersonation (RFC 9110 asks senders to avoid
"needlessly fine-grained detail"), but the only primary measurement of that exact change found it
breaks Cloudflare Turnstile on Electron 41. **Full fingerprint impersonation** fails the same
check even with matching client-hint metadata, and every vendor that offers it describes it as
cosmetic. The recommendation is to amend ADR-0030 to allow routing with a Manifest record, keep
the app-token change excluded until it is re-measured on Electron 44, and keep impersonation
excluded.

## Method and sources read

All reads were done on 2026-09-28 from primary sources. Where a page was fetched with `curl`
and converted to text, the quotes below are from that text.

- **IntelTechniques first-party pages:** the home page, the OSINT and Extreme Privacy book pages,
  the VPN and firewall guides, the blog archive (191 posts, including podcast show notes for
  episodes 151 to 306), and the public OSINT VM build files for the tenth and eleventh editions,
  including the Firefox profile template each one downloads.
- **UNREDACTED Magazine** issues 001 to 007, the free PDFs at `unredactedmagazine.com/issues/`.
- **Vendor documentation:** Hunchly (knowledge base, dark-web guide PDF, evidence guide PDF),
  Maltego (docs and first-party blog), Authentic8 support articles, Kasm documentation,
  SpiderFoot source at commit `0f815a20`, Tor Project manual pages and design document.
- **Electron:** `docs/api/session.md`, `app.md`, `web-contents.md`, `net.md`, and
  `structures/proxy-config.md` at `v44.4.5`, plus the C++ source files that implement
  `setUserAgent` and the default user agent. Chromium's `net/docs/proxy.md` from the GitHub
  mirror of `main` (head `04d364ec` at fetch time).
- **Standards:** the Berkeley Protocol on Digital Open Source Investigations (OHCHR, 2022), SWGDE
  21-F-001 "Best Practices for Acquiring Online Content" version 1.1 (2024-03-15), and RFC 9110.
- **Third-party measurements** already cited by the bot-detection spike, re-read in full:
  `pingdotgg/t3code#7110` and `stablyai/orca#18749`.
- **This repository:** ADR-0030, ADR-0004, the persona bot-detection spike, issue #541,
  `CONTEXT.md`, and the files named below under "Birdbrain's other egress."

Sources that could not be read are listed under "Could not verify."

## Confirming the name

The brief spelled the name "Michael Bazzelle." The first-party sources spell it Michael Bazzell
and tie him to both books:

- The IntelTechniques home page title reads "IntelTechniques by Michael Bazzell"
  ([inteltechniques.com](https://inteltechniques.com/)).
- The book store describes Extreme Privacy with "Michael Bazzell has helped hundreds of
  celebrities, billionaires, and everyday citizens disappear completely from public view"
  ([inteltechniques.com/books.html](https://inteltechniques.com/books.html)).
- The eleventh-edition OSINT VM build file carries "Copyright 2026 Michael Bazzell" and points to
  the OSINT book page ([osintbook11/linux.txt](https://inteltechniques.com/osintbook11/linux.txt),
  header).
- UNREDACTED Magazine issue 002 (June 2022), page 33, carries an article "By Michael Bazzell"
  that opens "If you have my OSINT book (Open Source Intelligence Techniques, 9th Edition)"
  ([issue 002](https://unredactedmagazine.com/issues/002.pdf)).
- Google Books lists the 2024 edition as "OSINT Techniques: Resources for Uncovering Online
  Information," by Michael Bazzell and Jason Edison, Inteltechniques.com, 590 pages
  ([Google Books](https://books.google.com/books?id=uEsJ0QEACAAJ)). The eleventh edition therefore
  has a co-author; the blog post announcing it thanks "an incredibly talented co-author"
  ([2024-11-10 post](https://inteltechniques.com/blog/posts/2024-11-10-osint-techniques-11th-edition-now-available.html)).

## 1. Bazzell's practice

### What could and could not be read

The books themselves are sold, not free. The eleventh edition's chapter list is public and
includes chapter 1 ("Why Virtual Machines?"), chapter 9 ("OSINT VM Web Browsers"), and chapter 45
("Methodology & Workflow") ([book1.html](https://inteltechniques.com/book1.html)), but Google Books
reports no preview for any edition, so the text of those chapters was not read. The podcast is
audio; only the show notes are online. Older IntelTechniques pages cannot be recovered from the
Internet Archive: the Wayback Machine's CDX endpoint returns HTTP 403 with
`x-archive-wayback-runtime-error: AdministrativeAccessControlException: Blocked Site Error` for
`inteltechniques.com`. The findings below come from what Bazzell publishes for free, and they
describe his tooling more than his reasoning.

### Network isolation

- **VPN at the network edge, not only in the browser.** The IntelTechniques VPN page recommends
  Proton VPN "for secure VPN access on desktop, mobile, and within a pfSense firewall," and ends
  "No VPN is 100% bulletproof" ([vpn.html](https://inteltechniques.com/vpn.html), undated,
  fetched 2026-09-28). The firewall guide "assumes you want to create a firewall which protects
  all devices on your network with a VPN," and its 2026 revision says "we now highly recommend
  the Wireguard protocol instead of OpenVPN" ([firewall/](https://inteltechniques.com/firewall/)).
- **The VPN sits on the host; the VM inherits it.** The eleventh-edition build file installs Proton
  VPN in its "macOS HOST CONFIGURATION" section (`brew install --cask protonvpn`, line 33) and
  has no VPN step inside the VM
  ([osintbook11/linux.txt](https://inteltechniques.com/osintbook11/linux.txt), "Updated: April
  4, 2026"). The tenth-edition file has no VPN step at all
  ([osintbook10/linux.txt](https://inteltechniques.com/osintbook10/linux.txt), "Updated:
  December 16, 2023").
- **Dedicated virtual machines.** Both build files construct a single-purpose Linux VM for
  investigations. In UNREDACTED issue 003 (Q3 2022), page 58, a reader asks how to keep privacy
  under an institution's mandatory software. The "Reader Q&A" section is credited to "UNREDACTED
  Staff," though the answer speaks of "my book": "The short answer is virtual machines, a good
  VPN, a masked mailing address" ([issue 003](https://unredactedmagazine.com/issues/003.pdf)).
- **Tor as a separate browser, not a route for everything.** Both build files install Tor
  Browser alongside the investigation browser (tenth edition: `torbrowser-launcher` from source,
  lines 155 to 160; eleventh edition: the Flathub `org.torproject.torbrowser-launcher`, line 99).
- **VPN costs.** Episode 183, "The Trouble With VPNs" (2020-08-14), lists "VPN Blocks,"
  "Captchas," "Blocked Account Creation," and "OSINT Account Creation" among its segments
  ([show notes](https://inteltechniques.com/blog/posts/2020-08-14-the-privacy-security-osint-show-episode-183.html)).
  Episode 255 (2022-03-25) covers "the benefits of a dedicated VPN IP address"
  ([show notes](https://inteltechniques.com/blog/posts/2022-03-25-the-privacy-security-osint-show-episode-255.html)).
  The show notes give topics only; the audio was not reviewed.

### Browser fingerprint and user agent

- **Blend in with a common, stock environment.** In UNREDACTED issue 003, page 59, under "BOOK
  UPDATES, By Michael Bazzell," he explains why his OSINT virtual machines stay on Ubuntu: "stock Ubuntu is
  much more popular than Pop!_OS and I like to fit in with the masses when I am conducting an
  investigation. Submitting queries from a Pop!_OS VM may look too unique for my threat model,
  but this is probably unjustified caution." Episode 296 (2023-05-12) is titled "The Argument for
  a Stock Browser" and described as "an argument supporting the use of an untouched stock browser
  with no privacy and security hardening"
  ([show notes](https://inteltechniques.com/blog/posts/2023-05-12-the-privacy-security-osint-show-episode-296.html)).
- **A user-agent switcher is in the kit, as a manual tool.** Both editions' Firefox profile
  templates ([tenth](https://inteltechniques.com/data/osintbook10/ff-template.zip),
  [eleventh](https://inteltechniques.com/data/osintvm/ff-template.zip)) contain the same 14 add-ons
  at the same versions, including "User-Agent Switcher and Manager" 0.5.0, uBlock Origin 1.55.0,
  SingleFile, and Firefox Multi-Account Containers (read from each template's `extensions.json`).
  The template ships no stored settings for the switcher that I found, so it presents Firefox's
  own user agent until the investigator changes it by hand. Why Bazzell includes it is explained
  in chapter 9 of the book, which I could not read.
- **No global anti-fingerprinting setting.** The template's `prefs.js` sets DNS over HTTPS in
  strict mode (`network.trr.mode` 3 against `https://firefox.dns.nextdns.io/`) and enables
  containers. It does not set `privacy.resistFingerprinting`.

### How the advice changed

| Period | Evidence | What changed |
| --- | --- | --- |
| Up to 2019 | Hunchly's dark-web guide (PDF dated 2019-02-12), page 10: "Buscador, an OSINT-focused virtual machine by David Westcott and Michael Bazzell," downloaded from `inteltechniques.com/buscador/`, configured "to automatically allow you to browse both Tor and I2P by default" ([PDF](https://www.hunch.ly/resources/Hunchly-Dark-Web-Setup.pdf)) | A prebuilt, downloadable VM. Bazzell's own pages from this period are blocked from the Wayback Machine, so this is a third party's first-hand description. |
| Ninth edition, 2022 | UNREDACTED 002, page 33: the book used Ubuntu 20.04; Ubuntu 22.04 moved Firefox to Snap and broke "the steps in the book to download and apply a Firefox profile with customized add-ons, bookmarklets, and settings" | Build-your-own Ubuntu VM with a Firefox profile template. |
| Tenth edition, late 2022 | `osintbook10/linux.txt`: Ubuntu 22.04, Snap Firefox removed in favor of the Mozilla PPA (line 128 onward), Chromium as a secondary browser (line 152), Tor Browser launcher | Same template, Chromium added. |
| Eleventh edition, November 2024 | Book page: "We will no longer seek pre-built virtual machines; we will create and configure our own." `osintbook11/linux.txt`: Debian 13, Firefox ESR with the same template, Brave replacing Chromium (lines 93 to 95), Tor Browser from Flathub, Proton VPN on the host | Self-built Debian VM; prebuilt virtual machines explicitly abandoned. |
| 2026 | Firewall guide: WireGuard preferred, old pfSense configuration files "obsolete" | Network edge moves to WireGuard. |

The reading that follows from this is limited to what the free material shows: Bazzell isolates
the investigation in a disposable VM, masks the network at the host or firewall, keeps the
browser close to stock, and carries a user-agent switcher for occasional manual use. I found no
free Bazzell text that recommends automated or full fingerprint spoofing, and no text that forbids
it.

## 2. Comparable tools

| Tool | Egress | User agent and fingerprint | What it records | Source |
| --- | --- | --- | --- | --- |
| Hunchly | None of its own. Captures happen in the investigator's Chrome. The dark-web guide proxies Chrome through Tor Browser's SOCKS port with `--proxy-server="socks5://localhost:9150" --host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE localhost"` (pages 7 to 8), or routes a Buscador VM through a Whonix gateway (page 10). | Whatever the investigator's Chrome sends. The guide says "This guide is NOT a guide on how to remain hidden, anonymous or how to perform undercover operations online" (page 4). | The 2018 evidence guide describes MHTML headers, SHA-256 hashes, and GPG signing. I found no field for the collecting IP address, proxy, or user agent in it. | [Dark-web guide](https://www.hunch.ly/resources/Hunchly-Dark-Web-Setup.pdf); [KB article](https://support.hunch.ly/article/91-using-hunchly-on-the-dark-web-tor); [Evidence guide](https://hunch.ly/resources/Hunchly%20Evidence%20Guide.pdf) |
| Maltego | Transforms run through Maltego's Commercial Transform Application Server: "target networks only recognize that Maltego is initiating such communications." In Normal mode the desktop client fetches site icons and images directly, and "a computer's IP might be exposed in the target's traffic log"; Stealth mode blocks those fetches. The Standard Transforms are "only available to legacy users" as of 2026-01-21. | Not addressed. | Not addressed. | [Stealth Mode post, 2020-08-24](https://www.maltego.com/blog/conduct-maltego-investigations-under-stealth-mode/); [Standard Transforms](https://docs.maltego.com/en/support/solutions/articles/15000041468-introduction-to-maltego-standard-transforms) |
| Authentic8 Silo for Research | Cloud-hosted Chromium; egress node types are data center, ISP, wireless carrier, fixed wireless, and a "Dark Web Interconnect Node" into Tor. | Administrators can set user agent, platform, language, and time zone; defaults are "the native Linux operating system, along with the language and time zone of the selected egress node." The vendor states "the intent of these features is not to guarantee complete misattribution in all scenarios" but "to pass a cursory review of web logs," and that "a browser mismatch can be detected with websites that employ an advanced browser detection measure." | Session logs carry `egress_ip`, `egress_location`, `user_agent_label`, and `user_agent_value` (sample: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/125.0.0.0"). | [Fingerprint management, modified 2025-07-07](https://support.authentic8.com/support/solutions/articles/16000027930-silo-for-research-browser-fingerprint-management); [Egress node types, 2025-06-23](https://support.authentic8.com/support/solutions/articles/16000189447-egress-node-connection-types); [Logs reference](https://support.authentic8.com/support/solutions/articles/16000033259-silo-logs-reference-guide) |
| Kasm Workspaces | Egress Gateways "tunnel all of a Workspace's network traffic" over OpenVPN or WireGuard, including a managed PureVPN provider; the user picks a gateway at launch. | "additional settings like language and timezone may need to be configured in your Profile settings to match your use case." Shared VPN IPs "can lead to websites, such as Google, imposing extra verification steps." | Banners can display the current provider, gateway, and country. | [Egress, Kasm 1.17.0 docs](https://www.kasmweb.com/docs/latest/guide/egress.html) (marked outdated by Kasm; the current site renders client-side and could not be read as text) |
| SpiderFoot | SOCKS4, SOCKS5, HTTP, or `TOR`; `TOR` maps to `socks5h://` (proxy-side DNS) while plain SOCKS5 uses `socks5://`, with a TODO noting "local DNS lookup: socks5:// and socks4://" (`sfscan.py` lines 137 to 149). Default Tor port 9050. | Default `_useragent` is a fixed Firefox 62 string; prefixing `@` picks one at random per request from a file (`sf.py` lines 59 and 78). | Not addressed. | [`sf.py`](https://github.com/smicallef/spiderfoot/blob/0f815a203afebf05c98b605dba5cf0475a0ee5fd/sf.py), [`sfscan.py`](https://github.com/smicallef/spiderfoot/blob/0f815a203afebf05c98b605dba5cf0475a0ee5fd/sfscan.py) |
| Tor Browser | Tor, with proxy obedience enforced by preferences and patches, including WebRTC disabled at compile time and DNS patched "to prevent any browser or addon DNS resolution" (design doc 4.1). | Uniformity, not randomization. The user agent is standardized per OS family ("All Windows appear as Windows 10 ... All other systems ... reported as 'Linux running X11'"), users cannot choose an OS, and "Inconsistencies in these values can trigger anti-bot and anti-fraud systems into categorizing Tor users as a bot." The Tor Project states "perfectly spoofing across all browser contexts is not possible." | Not applicable. | [Fingerprinting protections](https://tb-manual.torproject.org/anti-fingerprinting/); [Design document, 2018-06-15 draft](https://2019.www.torproject.org/projects/torbrowser/design/), "Strategies for Defense: Randomization versus Uniformity" |

The Tor Project also states: "We strongly recommend against using Tor in any browser other than
Tor Browser," because other browsers can reveal "Your real IP address, through DNS leaks or
WebRTC" and "Your operating system details, fonts, and plugins"
([Using Tor with other browsers](https://support.torproject.org/tor-browser/security/using-tor-with-other-browsers/)).
An Electron render over Tor hides the IP address from the target and nothing else.

Pattern across the table: every tool that masks egress does it at the network layer and, where
it records anything, records the egress point. The one vendor that offers user-agent control
(Authentic8) logs the value it sent and disclaims anything beyond a cursory check.

## 3. What Electron supports

### Routing one session

- `ses.setProxy(config)` takes a `ProxyConfig` with `mode` (`direct`, `auto_detect`,
  `pac_script`, `fixed_servers`, `system`), `pacScript`, `proxyRules`, and `proxyBypassRules`.
  `proxyRules` accepts `socks5://host:port` and `socks4://host`. The method note says "You may
  need `ses.closeAllConnections` to close currently in flight connections to prevent pooled
  sockets using previous proxy from being reused by future requests"
  ([session.md](https://github.com/electron/electron/blob/v44.4.5/docs/api/session.md#sessetproxyconfig),
  [proxy-config.md](https://github.com/electron/electron/blob/v44.4.5/docs/api/structures/proxy-config.md)).
  The Recapture partition is fresh per job (`backgroundRenderer.ts` line 393), so a proxy set
  before the first navigation has no pooled sockets to inherit.
- **Tor.** The Tor manual gives the `SocksPort` default as 9050
  ([tor manual](https://2019.www.torproject.org/docs/tor-manual.html.en)); Tor Browser's bundled
  Tor listens on 9150 (the port Hunchly's guide uses). `proxyRules: 'socks5://127.0.0.1:9050'`
  is the Electron form.
- **DNS.** Chromium's proxy documentation: "In Chrome when a proxy's scheme is set to SOCKSv5,
  name resolution is always done proxy side," and for SOCKSv4 "name resolution for target hosts
  is always done client side"
  ([net/docs/proxy.md](https://github.com/chromium/chromium/blob/main/net/docs/proxy.md#socksv5-proxy-scheme)).
  Use SOCKS5, never SOCKS4, for anything meant to hide the Operator.
- **Fail closed.** With a proxy list and no `direct://` entry, "if the proxy server was
  unreachable all requests would fail with `ERR_PROXY_CONNECTION_FAILED`" (same document, manual
  settings). A configuration that appends `direct://` silently falls back to the Operator's IP.
  The Berkeley Protocol asks for the same property from VPNs: "a fail-safe mechanism to ensure
  that, if the connection drops, their IP address is not exposed" (para. 98).
- **Bypass rules.** `proxyBypassRules` is a comma-separated host, suffix, IP, or CIDR list, with
  `<local>` for loopback. Chromium also applies implicit bypass rules for localhost and link-local
  addresses, which `<-loopback>` subtracts (proxy.md, "Implicit bypass rules").
- **UDP does not go through the proxy.** "In Chrome SOCKSv5 is only used to proxy TCP-based URL requests. It
  cannot be used to relay UDP traffic" (proxy.md). WebRTC is the UDP path that matters:
  `webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` "Does not expose public or
  local IPs" ([web-contents.md](https://github.com/electron/electron/blob/v44.4.5/docs/api/web-contents.md#contentssetwebrtciphandlingpolicypolicy)).
  `backgroundRenderer.ts` does not set a policy today, so it runs on `default`, which "Exposes
  user's public and local IPs." That is harmless while traffic is direct and a leak once a proxy
  is added.
- **No per-job Tor circuit through credentials.** Tor's `IsolateSOCKSAuth` flag isolates
  circuits by SOCKS credentials, but "No authentication methods are supported for SOCKSv5 in
  Chrome" (proxy.md). Separate circuits per Recapture would need separate `SocksPort`s.
- **Only the session's traffic is routed.** `ses.fetch` and `net.fetch` use "Chromium's network
  stack. This differs from Node's `fetch()`, which uses Node.js's HTTP stack"
  ([session.md](https://github.com/electron/electron/blob/v44.4.5/docs/api/session.md#sesfetchinput-init)).
  Node `fetch` and `tls.connect` in the main process ignore `setProxy`.

### Birdbrain's other egress

Four main-process paths leave the machine outside the Recapture session. The probe named three;
the fourth touches the target.

| Path | Code | Contacts | What it reveals |
| --- | --- | --- | --- |
| TLS certificate re-fetch after every Capture | `captureLifecycle.ts` line 280 calls `fetchCertChain(params.url)`; `tlsCertChain.ts` line 141 opens a raw `tls.connect` with local DNS | **The target origin** | The Operator's IP, to the target, seconds after the Capture. A routed render followed by this call exposes the Operator anyway. |
| Wayback lookup | `waybackMachine.ts` line 69, Node `fetch` to `web.archive.org/cdx/search/cdx` | Internet Archive | The URL under investigation, tied to the Operator's IP. |
| RFC 3161 timestamp | `timestamp.ts` line 50, Node `fetch` to the TSA | The TSA | A content hash only; the TSA learns that this IP timestamps something. |
| Consent filter lists | `consentBlocker.ts` line 47, `ElectronBlocker.fromLists(fetch, ...)` against `secure.fanboy.co.nz` and `ublockorigin.github.io` | List hosts | That this IP started a background render, not what it rendered. |

Only the first path contacts the target. Any routing feature has to route the TLS re-fetch the
same way as the render, or skip it and record that it was skipped. The other three are
third-party exposures that a proxy setting could cover by moving them to `ses.fetch` on the same
session, which is a design choice for the spec, not something this note settles.

### User agent

- **APIs.** `ses.setUserAgent(userAgent[, acceptLanguages])` "Overrides the `userAgent` and
  `acceptLanguages` for this session" and "doesn't affect existing `WebContents`";
  `contents.setUserAgent` overrides one page; `app.userAgentFallback` "is the user agent that
  will be used when no user agent is set at the `webContents` or `session` level"
  ([session.md](https://github.com/electron/electron/blob/v44.4.5/docs/api/session.md#sessetuseragentuseragent-acceptlanguages),
  [app.md](https://github.com/electron/electron/blob/v44.4.5/docs/api/app.md#appuseragentfallback)).
- **Where `birdbrain/1.0.1-beta.21` comes from.** `GetApplicationUserAgent()` builds
  `"<name>/<version> Chrome/<version> Electron/<version>"` from the app's name and version, and
  omits the first token only when the name is literally `Electron`
  ([`shell/common/application_info.cc`](https://github.com/electron/electron/blob/v44.4.5/shell/common/application_info.cc),
  lines 36 to 51). No configuration drops it short of an override.
- **What an override does to `Sec-CH-UA`: nothing.** Every `WebContents` applies its session's
  user agent at creation (`SetUserAgent(GetBrowserContext()->GetUserAgent())`,
  `electron_api_web_contents.cc` lines 871 and 1145), and `WebContents::SetUserAgent` always
  attaches `ua_metadata_override = embedder_support::GetUserAgentMetadata()` for a non-empty
  string (lines 3398 to 3405). The metadata is Chromium's default, whatever the string says. The
  brand list therefore stays `"Not?A_Brand";v="24", "Chromium";v="152"` after any override, and
  the missing hints on navigation requests that the probe measured stay missing. Electron has no
  API to change the metadata; the proposal to add one
  ([electron/electron#53519](https://github.com/electron/electron/pull/53519)) was still open on
  2026-09-28.
- **What the only measurements say.** `pingdotgg/t3code#7110` (merged 2026-09-12) ran Electron
  41.5.0 against `dash.cloudflare.com/login` in fresh sessions and reports:

  | User agent presented | Turnstile |
  | --- | --- |
  | native (`... <app>/0.0.0 Chrome/146... Electron/41.5.0 ...`) | passes |
  | `setUserAgent()` with the unchanged native string | passes |
  | app token stripped, `Electron/...` kept | fails (600010 loop) |
  | `Electron/...` stripped | fails (600010 loop) |

  The PR states "Across every case `userAgentData` is identical and no `Sec-CH-UA*` headers are
  sent at all, so the UA string is the only variable," and that "Turnstile is closed, so I don't
  claim the exact discriminator." `stablyai/orca#18749` (Electron 43) found that a Chrome-shaped
  user agent failed even with "CDP `userAgentMetadata` matching headers," and only "Stock Electron
  UA" cleared both test pages. Both are third-party measurements, not Cloudflare statements.

### Permission checks

`ses.setPermissionCheckHandler(handler)` answers the check that most APIs run before a request:
"you must also implement `setPermissionRequestHandler` to get complete permission handling. Most
web APIs do a permission check and then make a permission request if the check is denied"
([session.md](https://github.com/electron/electron/blob/v44.4.5/docs/api/session.md#sessetpermissioncheckhandlerhandler)).
The renderer sets only the request handler (`backgroundRenderer.ts` line 452), so checks for
`notifications` and `geolocation` report `granted` while every request is refused. A check
handler that returns `false` makes the page see what the request handler already enforces. That
is a consistency fix, not spoofing: it makes the render report its real policy. The t3code PR
lists "pre-granted permission handlers" among the causes it ruled out for Turnstile, so the fix
is not expected to change challenge outcomes.

## 4. Recording masking in provenance

### What the standards ask for

- **Berkeley Protocol**
  ([OHCHR, 2022](https://www.ohchr.org/sites/default/files/2024-01/OHCHR_BerkeleyProtocol.pdf)):
  - Para. 101, connection camouflage: "Open source investigators should seek to use VPNs,
    proxies or other software to mask their computers' IP addresses."
  - Para. 102, machine camouflage: with a virtual machine, "investigators have a system to vary
    the browser, user agent, software, opened ports, operating system and other information about
    the machine in order to appear as a different subject each time they go online."
  - Para. 38, transparency: anonymity and non-attribution "can be important for security
    reasons," but investigators "should be aware of the potential negative ramifications of
    misrepresentation," including "contaminating the information collected."
  - Para. 154: "Any alterations, transformations or conversions caused by the collection process
    should be documented."
  - Para. 155(g), collection data: "the name of the collector, the IP address of the machine used
    to collect the information, the virtual identity used, if any, and a time stamp."
  - Para. 156: for automated collection, "a technical report should be produced that includes the
    above information."
- **SWGDE 21-F-001 v1.1**
  ([PDF](https://www.swgde.org/wp-content/uploads/2024/04/2024-03-15-SWGDE-Best-Practices-for-Acquiring-Online-Content-21-F-001-1.1.pdf)):
  - Section 3.4 lists as contamination risks "access to the content from a known network" and
    "allowing the target site to identify browser strings."
  - Section 4.1: "The device should be configured to mimic its target audience," using regional
    settings whose examples include "browser agent strings, IP address." It adds that "the use of
    Virtual Private Networks ('VPNs') or proxy servers is recommended for the purpose of
    presenting a profile and location consistent with the goals of the investigation."
  - Section 7.5: "Document physical location, access IP address, browser, dates, timestamps, and
    local time zone of website access."
  - Section 6.2: dynamic sites depend on "visitor credentials, browser, location, date, and time,"
    so the egress and user agent are part of what the page showed.
- **RFC 9110, section 10.1.5**
  ([rfc-editor.org](https://www.rfc-editor.org/rfc/rfc9110#section-10.1.5)): "A user agent SHOULD
  NOT generate a User-Agent header field containing needlessly fine-grained detail ... Overly long
  and detailed User-Agent field values increase ... the risk of a user being identified against
  their wishes ('fingerprinting')." And: "implementations are encouraged not to use the product
  tokens of other implementations in order to declare compatibility with them, as this circumvents
  the purpose of the field."
- **NIST.** The Berkeley Protocol points to the NIST Computer Security Resource Center for browser
  guidance (footnote 116) and for hash standards (footnote 142). I did not find a NIST
  publication on identity masking during web acquisition.

Both investigation standards endorse masking and require the record. Neither treats a VPN or a
varied user agent as a defect in the evidence, provided the collection record says what was used.

### What Birdbrain records today

- The capture row stores `userAgent` (`src/shared/schemas.ts` line 102), stamped from
  `wc.getUserAgent()` for background renders (`backgroundRenderer.ts` line 532).
- The signed `capture` Manifest Entry does **not** carry the user agent or any network fact
  (`src/main/services/manifest.ts`, `ManifestEntryInput`, lines 279 to 327). The row is
  hand-editable, which is why duplication re-reads anchored facts from the chain rather than the
  row (comment at line 205).
- `consentSuppression` is the precedent for rendering-session context: an optional field
  "OMITTED when absent so pre-existing entries' canonical bodies ... are unchanged"
  (manifest.ts line 319).

### What a record would need

Following that precedent, a routing feature would add optional fields to `capture` entries for
`background` and `persona-window` methods, omitted for direct egress so every existing chain hash
is unchanged:

- the route (`proxy` or `tor`) and the proxy scheme, with the host recorded as a label the Operator
  chose rather than a credential;
- whether each main-process path that contacts the target (today, the TLS re-fetch) used the same
  route, was skipped, or went direct;
- the exact user-agent string sent, moved into the signed entry, since it is observation context
  under ADR-0004 and SWGDE 7.5 whether or not it changes.

The claim has to stay narrow. A route setting records what Birdbrain asked Chromium to do; it
does not prove which IP address the target saw. Recording the observed exit address would take an
extra request to an address-echo service through the same route, which is itself egress to a third
party. The spec should say which of the two it records. ADR-0030's sequencing rule applies: the
verifier is strict, so the release that teaches it the new fields ships before any build writes
them.

## Reconciling ADR-0030 and the bot-detection spike

ADR-0030 line 47 says "Fingerprint or user-agent spoofing stays excluded: it is evasion, and the
research also shows it breaks Cloudflare challenges." The spike's Cloudflare row rests on the two
third-party reports above and says so ("Those are third-party reports, not Cloudflare
statements"). Reading the full reports adds two facts the spike did not quote:

- t3code measured the minimal variant, stripping only the app token and keeping `Electron/`, and
  it also failed. So the ADR's claim covers even the smallest user-agent change, not only
  Chrome impersonation, for Turnstile on the pages tested.
- Orca measured the maximal variant, a Chrome user agent with matching client-hint metadata set
  through the Chrome debugging protocol, and it also failed.

Neither was measured on Electron 44 or against Birdbrain. The spike's "Out of scope" line puts
all user-agent changes under one exclusion. RFC 9110 separates them: dropping needless detail from
your own product token is recommended; using another product's tokens "circumvents the purpose of
the field." The ADR's single word "spoofing" covers both.

Routing is not in the ADR's exclusion at all. Issue #541 lists "Any anti-detection /
fingerprint-spoofing work" as out of scope and says persona mode "is about attribution and
isolation, not evasion." A proxy changes where the Operator appears to be, which Berkeley para. 101
and SWGDE 4.1 describe as standard practice, and it changes nothing the browser claims about
itself.

## 5. Recommendation

Three separate decisions, ranked by how well the evidence supports them.

**Routing (proxy and Tor): amend ADR-0030 to allow it.** Recommended. Masking the IP address is
what Bazzell, Berkeley, SWGDE, Authentic8, and Kasm all do, and none of them treats it as evasion.
Conditions the spec should carry:

1. SOCKS5 or HTTP only, never SOCKS4, and no `direct://` fallback, so a dead proxy fails the
   Recapture instead of exposing the Operator.
2. `disable_non_proxied_udp` on every routed `WebContents`.
3. The TLS re-fetch follows the same route or is skipped, and the entry says which.
4. The route is recorded in the signed `capture` entry, with the verifier shipping first.
5. Tor is described to users as IP masking only, quoting the Tor Project's warning against other
   browsers. Challenge rates over Tor and shared VPN addresses are higher (Kasm's CAPTCHA note;
   Bazzell episode 183), and a hidden window cannot answer a challenge, so the capture will
   contain the interstitial. The Capture must not be presented as a failure to reach the page
   when it is a faithful record of a challenge.

The host time zone and `Accept-Language` still leak the Operator's region through a proxy.
Aligning them with the exit location is what Authentic8 does by default and what Kasm tells
administrators to configure, but it is impersonation of a location, so it belongs with the third
decision, not this one. The docs should state the leak.

**Removing `birdbrain/<version>` from the user agent: keep it excluded for now, and reword the ADR
so it is excluded for the measured reason rather than as "evasion."** Removing detail from your
own product token is what RFC 9110 asks for, and the token tells every site that a Birdbrain
Recapture, at a specific beta version, is looking at it. But the one primary measurement of this
exact change broke Turnstile, and the change buys little: `Electron/44.4.5` stays in the string,
and the `Chromium`-only brand list and missing navigation hints identify an embedded Chromium
regardless. Re-measure on Electron 44 in the Birdbrain renderer against the two pages Orca used
before revisiting it. Until then, the published docs should say that background Recapture names
Birdbrain and its version to the site, and that the Chrome extension in the Operator's own
hardened browser (Bazzell's model) is the path for targets that must not see that.

**Full fingerprint impersonation: keep it excluded.** Every source points the same way. Tor
Project: perfect spoofing "is not possible" and inconsistencies read as bots. Authentic8, the
vendor that sells it: it passes "a cursory review of web logs" only. Orca: a Chrome user agent
with matching metadata still failed Turnstile. Electron: no API for the metadata. Berkeley para.
38: misrepresentation can contaminate the collection. The ADR-0004 obligation to record observation
context would also force every impersonated field into the Manifest, which is correct but makes
the evidence describe a browser that did not exist.

Two findings from this research need no ADR change, because neither alters what the browser
claims: add a deny-all permission check handler so checks report the real policy, and set a WebRTC
policy as part of any routing work.

## Could not verify

- **The text of Bazzell's books.** OSINT Techniques (all editions) and Extreme Privacy are
  sold, not free, and have no Google Books preview. Chapter 9 ("OSINT VM Web Browsers") presumably
  explains the user-agent switcher; I did not read it.
- **Podcast audio.** Episodes 183, 255, and 296 are cited by title and show notes only.
- **Bazzell's pre-2020 web pages.** `inteltechniques.com` is blocked from the Wayback Machine
  ("Blocked Site Error"), so the Buscador era is documented here only through Hunchly's guide.
- **Turnstile on Electron 44 with the app token removed.** The t3code measurement is on Electron
  41.5.0. The exact test: the four-row matrix above, in `renderPageInHiddenWindow`'s
  configuration, against `dash.cloudflare.com/login` and
  `scrapingcourse.com/cloudflare-challenge`.
- **Chromium side channels under a proxy.** Speculative DNS resolution, early connections, and QUIC behavior
  with a SOCKS5 proxy set were not measured. The Chromium document covers name resolution only for
  requests that go through the proxy.
- **Kasm current documentation.** The current Kasm docs site renders client-side; the 1.17.0 page
  quoted above is marked outdated by Kasm.
- **A NIST publication on identity masking during web acquisition.** None found.

## Sources

Bazzell and IntelTechniques:

- [IntelTechniques home](https://inteltechniques.com/)
- [OSINT Techniques, eleventh edition](https://inteltechniques.com/book1.html)
- [Book store](https://inteltechniques.com/books.html)
- [VPN recommendations](https://inteltechniques.com/vpn.html)
- [Firewall guide](https://inteltechniques.com/firewall/)
- [OSINT VM build steps, eleventh edition](https://inteltechniques.com/osintbook11/linux.txt)
- [OSINT VM build steps, tenth edition](https://inteltechniques.com/osintbook10/linux.txt)
- [Firefox template, eleventh edition](https://inteltechniques.com/data/osintvm/ff-template.zip)
- [Firefox template, tenth edition](https://inteltechniques.com/data/osintbook10/ff-template.zip)
- [Eleventh edition announcement, 2024-11-10](https://inteltechniques.com/blog/posts/2024-11-10-osint-techniques-11th-edition-now-available.html)
- [Episode 183, 2020-08-14](https://inteltechniques.com/blog/posts/2020-08-14-the-privacy-security-osint-show-episode-183.html)
- [Episode 255, 2022-03-25](https://inteltechniques.com/blog/posts/2022-03-25-the-privacy-security-osint-show-episode-255.html)
- [Episode 296, 2023-05-12](https://inteltechniques.com/blog/posts/2023-05-12-the-privacy-security-osint-show-episode-296.html)
- [UNREDACTED issue 002, June 2022](https://unredactedmagazine.com/issues/002.pdf)
- [UNREDACTED issue 003, Q3 2022](https://unredactedmagazine.com/issues/003.pdf)
- [Google Books record, 2024 edition](https://books.google.com/books?id=uEsJ0QEACAAJ)

Comparable tools:

- [Hunchly dark-web guide](https://www.hunch.ly/resources/Hunchly-Dark-Web-Setup.pdf)
- [Hunchly: using Hunchly on the dark web](https://support.hunch.ly/article/91-using-hunchly-on-the-dark-web-tor)
- [Hunchly evidence guide](https://hunch.ly/resources/Hunchly%20Evidence%20Guide.pdf)
- [Maltego Stealth Mode](https://www.maltego.com/blog/conduct-maltego-investigations-under-stealth-mode/)
- [Maltego Standard Transforms](https://docs.maltego.com/en/support/solutions/articles/15000041468-introduction-to-maltego-standard-transforms)
- [Authentic8: browser fingerprint management](https://support.authentic8.com/support/solutions/articles/16000027930-silo-for-research-browser-fingerprint-management)
- [Authentic8: egress node connection types](https://support.authentic8.com/support/solutions/articles/16000189447-egress-node-connection-types)
- [Authentic8: Silo logs reference](https://support.authentic8.com/support/solutions/articles/16000033259-silo-logs-reference-guide)
- [Kasm: Egress (1.17.0)](https://www.kasmweb.com/docs/latest/guide/egress.html)
- [SpiderFoot `sf.py` at `0f815a20`](https://github.com/smicallef/spiderfoot/blob/0f815a203afebf05c98b605dba5cf0475a0ee5fd/sf.py)
- [SpiderFoot `sfscan.py` at `0f815a20`](https://github.com/smicallef/spiderfoot/blob/0f815a203afebf05c98b605dba5cf0475a0ee5fd/sfscan.py)
- [Tor Browser: fingerprinting protections](https://tb-manual.torproject.org/anti-fingerprinting/)
- [Tor Browser design document](https://2019.www.torproject.org/projects/torbrowser/design/)
- [Tor: using Tor with other browsers](https://support.torproject.org/tor-browser/security/using-tor-with-other-browsers/)
- [Tor manual](https://2019.www.torproject.org/docs/tor-manual.html.en)

Electron and Chromium:

- [session.md at v44.4.5](https://github.com/electron/electron/blob/v44.4.5/docs/api/session.md)
- [app.md at v44.4.5](https://github.com/electron/electron/blob/v44.4.5/docs/api/app.md)
- [web-contents.md at v44.4.5](https://github.com/electron/electron/blob/v44.4.5/docs/api/web-contents.md)
- [net.md at v44.4.5](https://github.com/electron/electron/blob/v44.4.5/docs/api/net.md)
- [proxy-config.md at v44.4.5](https://github.com/electron/electron/blob/v44.4.5/docs/api/structures/proxy-config.md)
- [`application_info.cc` at v44.4.5](https://github.com/electron/electron/blob/v44.4.5/shell/common/application_info.cc)
- [`electron_api_web_contents.cc` at v44.4.5](https://github.com/electron/electron/blob/v44.4.5/shell/browser/api/electron_api_web_contents.cc)
- [`electron_api_session.cc` at v44.4.5](https://github.com/electron/electron/blob/v44.4.5/shell/browser/api/electron_api_session.cc)
- [electron/electron#53519 (open)](https://github.com/electron/electron/pull/53519)
- [Chromium `net/docs/proxy.md`](https://github.com/chromium/chromium/blob/main/net/docs/proxy.md)

Third-party measurements:

- [pingdotgg/t3code#7110](https://github.com/pingdotgg/t3code/pull/7110)
- [stablyai/orca#18749](https://github.com/stablyai/orca/pull/18749)

Standards:

- [Berkeley Protocol on Digital Open Source Investigations](https://www.ohchr.org/sites/default/files/2024-01/OHCHR_BerkeleyProtocol.pdf)
- [SWGDE 21-F-001 v1.1, Best Practices for Acquiring Online Content](https://www.swgde.org/wp-content/uploads/2024/04/2024-03-15-SWGDE-Best-Practices-for-Acquiring-Online-Content-21-F-001-1.1.pdf)
- [RFC 9110, section 10.1.5](https://www.rfc-editor.org/rfc/rfc9110#section-10.1.5)

Repository:

- [ADR-0030](../adr/0030-persona-is-a-provenance-axis-beside-operator.md)
- [ADR-0004](../adr/0004-adopt-osint-assurance-baseline.md)
- [Persona bot-detection spike](2026-09-19-persona-bot-detection-spike.md)
- [#541 Persona / alias identity model](https://github.com/thebristolsound/birdbrain/issues/541)
- `src/main/services/backgroundRenderer.ts`, `captureLifecycle.ts`, `tlsCertChain.ts`,
  `waybackMachine.ts`, `timestamp.ts`, `consentBlocker.ts`, `manifest.ts`, and
  `src/shared/schemas.ts` at `c2d730c8`
