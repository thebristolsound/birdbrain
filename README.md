# Birdbrain

Birdbrain is an open source desktop app, with a companion Chromium extension, for capturing,
organizing, and verifying web evidence. It runs on Windows and Ubuntu and is in public beta.

[Download](https://github.com/thebristolsound/birdbrain-releases/releases) ·
[Documentation](https://docs.birdbrain.cc/docs) ·
[Threat model](https://docs.birdbrain.cc/docs/threat-model)

![A case in Birdbrain, showing the capture list, a saved page, and its chain of custody](website/content/images/screenshot-case.png)

## Overview

Each capture holds the page as MHTML, a full-page screenshot, and the extracted page text. The
extension sends the capture to the desktop app over `127.0.0.1`, and the app stores it in a
per-case archive on your machine. Birdbrain has no account and no telemetry. Captures leave
the machine only when you export them.

Birdbrain hashes the stored bytes of each capture with SHA-256 and appends a signed entry to the
case's hash-chained manifest. It also requests an RFC 3161 timestamp token for the content hash.
The capture's trusted time stays `pending` until the timestamp authority answers, for example
while you are offline.

You can check the manifest chain in the app. An exported evidence package includes a
`VERIFY.md` runbook that repeats the check with `sha256sum`, `openssl`, and `jq`, so the
recipient does not need Birdbrain installed.

A verified chain shows that nobody changed the record without the install's signing key. It
does not show that the page itself was genuine, and no court has tested the workflow. The
[threat model](https://docs.birdbrain.cc/docs/threat-model) lists what the controls defend
against and what they do not.

## Features

### Capture

- Capture the current page from the extension popup or the right-click menu. A capture records
  the MHTML, a stitched full-page screenshot, the page text, response headers, HTTP status, the
  final URL, and the browser, user-agent, and extension versions.
- Use scrolling capture for pages that load content as you scroll. It scrolls for up to two
  minutes and stops when the page stops growing.
- Select text on a page to create a selector, add a tag, or save a quote. Tagging or quoting a
  page the case does not hold yet captures it first.
- After a capture, a card on the page shows the SHA-256 hash and manifest position, and offers
  tagging, recapture, and a link to the capture in the app.
- Paste a list of URLs and the desktop app captures them in a hidden window. The app labels these
  captures as background captures, warns when a page shows a login wall, and blocks cookie
  banners using consent filter lists.
- Recapture one page or a selection. The new capture links to the one it replaces.
- Exclude URLs by substring, wildcard, or regular expression. Exclusions apply to all cases or
  to one case.
- Birdbrain removes its own page UI before taking the snapshot, and aborts the capture if it
  cannot.

### Cases

- Create a case with a wizard that offers starter selectors for email addresses, crypto
  addresses, IP addresses, domains, phone numbers, and usernames.
- The case overview shows changes since your last visit, recent captures, an activity timeline,
  an integrity summary, top sources, quick notes, tags, selectors, and a link map.
- Filter the capture list by text, format, date, tag, or favourite, and act on a selection in
  bulk: tag, favourite, recapture, export, or delete.
- View each capture as a screenshot, as the archived page with scripts turned off, as extracted
  text, or alongside Wayback Machine snapshots.
- Write notes in a rich-text editor. `@` links captures and notes, and `#` links selectors and
  tags.
- Annotate screenshots with rectangles, arrows, highlights, redactions, and numbered pins. The
  original screenshot stays unchanged, and exports can include the annotations.
- Birdbrain assigns exhibit numbers to captures and cites them in exports.
- Search the text of every capture in a case.

### Analysis

- Birdbrain extracts indicators from every capture and lists the captures each one appears in:
  - IPv4 (public only) and IPv6 addresses, domains, email addresses, MAC addresses, and ASNs
  - MD5, SHA-1, SHA-256, and SHA-512 hashes, and CVE identifiers
  - Bitcoin, Ethereum, and Monero addresses
  - Google Analytics, AdSense, Tag Manager, and Ads IDs, and Facebook Pixel IDs
  - X, Facebook, Instagram, LinkedIn, YouTube, GitHub, and Telegram accounts
  - `.onion` and `.i2p` addresses
- Selectors flag exact text or a regular expression across every capture in the case,
  including captures made before the selector existed. Matches export as CSV.
- The data explorer lists every file in a case with its properties, extracted text, headers,
  TLS details, and manifest entries, and verifies any branch of the tree. Local files can be
  staged and then added to the evidence record or discarded.
- Look up a page on the Internet Archive, pin snapshots to the case, and compare a snapshot side
  by side with your capture.

### Integrity

- Birdbrain hashes the MHTML, screenshot, and extracted text separately with SHA-256.
- Each case keeps an append-only, hash-chained manifest signed with an RSA-2048 key held in the
  operating system's credential store.
- RFC 3161 timestamps come from DigiCert by default. The authority is configurable, and
  timestamping can be turned off.
- After each capture, Birdbrain fetches the site's TLS certificate chain and records it in the
  signed entry as corroboration.
- Re-verify a capture, a branch of the case, or the whole manifest from inside the app.

### Export

- Export an evidence package as a full bundle, a court exhibit without notes, or a working copy
  that makes no evidentiary claims. Each preset can be adjusted, and an export can cover only
  selected captures.
- A package contains an HTML report, the captures and screenshots, the signed manifest, the
  public key, the timestamp tokens and authority chain, `VERIFY.md`, and a `verify.sh` script.
- Download a single capture as MHTML, a PDF report, or a PNG screenshot.
- Export a tag's captures as a ZIP or Markdown file.
- Move a case to another machine as a `.birdbrain` archive. Import verifies the archive first
  and always creates a new case.

### App

- Updates arrive on a stable or beta channel. Birdbrain never restarts on its own to install
  one.
- The command palette (`Ctrl+K`) switches and creates cases, replays the walkthrough, and opens
  a problem report.
- Choose a dark or light theme, one of three density settings, and reduced motion.
- First launch opens a guided tour, an extension setup guide, and a demo case. Exports from the
  demo case are marked as demo material.
- Problem reports stay local until you send them. The app also includes a log viewer and a
  capture pipeline self-test.
- Database tools cover backup and restore, snapshots before upgrades, vacuum, and search index
  rebuilds.

## Install

Download the Windows installer or the Ubuntu AppImage from the
[releases page](https://github.com/thebristolsound/birdbrain-releases/releases). Each release
includes `SHA256SUMS` and an SPDX software bill of materials. The Windows installer is not
code-signed, so SmartScreen warns the first time you run it. There is no macOS build.

The extension is not on the Chrome Web Store yet, so it loads unpacked:

1. On the Birdbrain dashboard, click **Open extension folder**.
2. In Chrome, open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder Birdbrain opened.

[Install and first capture](https://docs.birdbrain.cc/docs/tester-guide) covers each platform
and the first capture in detail.

## Limits

- You capture each page yourself. Automatic capture while you browse is turned off in this
  beta, and Birdbrain does not save video.
- A case belongs to one investigator on one machine. You can move a case to another machine as
  an archive file.
- Deleting a capture removes its files, but its URL, capture time, and hashes stay in the
  append-only manifest and appear in exports that include the audit trail.
- The extension runs in Chrome and Chromium only.
- The certification page in an evidence package carries draft legal wording.
- Data formats may change between beta releases. Keep your own backups and verify your exports.

## Network use

Birdbrain makes these outbound connections:

- the capture's hash, never its content, to the timestamp authority
- the captured site, once more, to record its TLS certificate
- the Internet Archive, when you ask for a lookup
- the filter list host, to download cookie-banner lists
- GitHub, to check for updates

[SECURITY.md](SECURITY.md) lists every host. If you work through a VPN or Tor, route the whole
machine through it.

## Roadmap

The issue tracker holds the full list. These are the larger pieces of work.

### In progress

- Shared cases: peer-to-peer collaboration in which each member signs their own chain. The
  schema, member records, and shared-case export and import are merged. Sync, invitations, the
  members screen, and timestamps on merges remain
  ([#1508](https://github.com/thebristolsound/birdbrain/issues/1508)).
- Personas: pseudonymous research identities with their own browser sessions. Creating a
  persona and importing its cookies is merged. Recording the persona on captures, recapturing
  through a persona session, and a persona browsing window remain
  ([#541](https://github.com/thebristolsound/birdbrain/issues/541)).
- Indicators get their own group in the data explorer
  ([#1683](https://github.com/thebristolsound/birdbrain/pull/1683)).

### Planned

- Redesigned dashboard, case overview, and export menu screens. Contrast and accessibility
  fixes ship alongside them
  ([#1546](https://github.com/thebristolsound/birdbrain/issues/1546),
  [#1547](https://github.com/thebristolsound/birdbrain/issues/1547),
  [#1555](https://github.com/thebristolsound/birdbrain/issues/1555)).
- Opt-in automatic capture, scoped per case
  ([#600](https://github.com/thebristolsound/birdbrain/issues/600)).
- Stronger evidence claims: timestamping the manifest entry itself, a second timestamp
  authority, anchoring the chain in a transparency log, a non-exportable signing key in the
  platform key store, clock error bounds, and a URL scheme that lets deletion remove sensitive URLs
  ([#583](https://github.com/thebristolsound/birdbrain/issues/583),
  [#585](https://github.com/thebristolsound/birdbrain/issues/585),
  [#586](https://github.com/thebristolsound/birdbrain/issues/586),
  [#587](https://github.com/thebristolsound/birdbrain/issues/587),
  [#588](https://github.com/thebristolsound/birdbrain/issues/588),
  [#798](https://github.com/thebristolsound/birdbrain/issues/798)).
- WACZ and HAR output, evaluated first as spikes
  ([#799](https://github.com/thebristolsound/birdbrain/issues/799),
  [#804](https://github.com/thebristolsound/birdbrain/issues/804)).
- Text and metadata extraction from PDFs and other documents, bulk image extraction from a
  capture, and redacted exports
  ([#1190](https://github.com/thebristolsound/birdbrain/issues/1190),
  [#1193](https://github.com/thebristolsound/birdbrain/issues/1193),
  [#1195](https://github.com/thebristolsound/birdbrain/issues/1195)).
- Passphrase-encrypted export archives
  ([#418](https://github.com/thebristolsound/birdbrain/issues/418)).
- Import from Hunchly cases, an image gallery with captions, search query tracking, and a
  per-case to-do list
  ([#1168](https://github.com/thebristolsound/birdbrain/issues/1168),
  [#47](https://github.com/thebristolsound/birdbrain/issues/47),
  [#44](https://github.com/thebristolsound/birdbrain/issues/44),
  [#41](https://github.com/thebristolsound/birdbrain/issues/41)).
- Notes that suggest related items and show where each note is mentioned
  ([#922](https://github.com/thebristolsound/birdbrain/issues/922)).
- A decision on code-signing the installers, and a Chrome Web Store listing at the first
  stable release ([#274](https://github.com/thebristolsound/birdbrain/issues/274),
  [#1248](https://github.com/thebristolsound/birdbrain/issues/1248)).

### Under discussion

- A capture engine in which the desktop app drives Chrome, Edge, Brave, or Firefox directly and
  records network transactions, TLS details, and a PDF, with the extension as a companion.
- A network egress setting for direct, proxy, or Tor connections that fails closed.
- A distributed standalone verifier and a plainer verification guide in each package.
- Later shared-case work: a reviewer role, corroboration across members, ownership transfer,
  and encryption at rest.
- A local API and MCP server for scripting and AI tools
  ([#547](https://github.com/thebristolsound/birdbrain/issues/547)).

## Development

Birdbrain builds on Node 20 with pnpm:

```bash
pnpm install
pnpm dev
```

`pnpm build:verifier` builds the standalone `birdbrain-verify` binary for the current platform.
[CONTRIBUTING.md](CONTRIBUTING.md) covers the full setup and the checks to run before a pull
request. Open an issue before starting a non-trivial change. Do not put a live investigation
subject in a bug report. Report security issues as described in [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE). Birdbrain is provided as is, without warranty. You are responsible
for using it lawfully and within the terms of service of the sites you capture.
