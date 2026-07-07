<p align="center">
  <img src="resources/icon_nobg.png" alt="Birdbrain" width="110" />
</p>

<h1 align="center">Birdbrain</h1>

<p align="center">
  Local-first web evidence capture for OSINT investigations.<br />
  Every capture is hashed, timestamped, and chained into a verifiable audit manifest.
</p>

<p align="center">
  <a href="https://github.com/thebristolsound/birdbrain/releases/latest"><img src="https://img.shields.io/github/v/release/thebristolsound/birdbrain" alt="Latest release" /></a>
  <a href="https://github.com/thebristolsound/birdbrain/actions/workflows/ci.yml"><img src="https://github.com/thebristolsound/birdbrain/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform" />
  <a href="LICENSE"><img src="https://img.shields.io/github/license/thebristolsound/birdbrain" alt="License" /></a>
  <img src="https://img.shields.io/badge/status-beta-yellow" alt="Status: beta" />
</p>

---

Birdbrain is an open-source desktop application with a companion Chrome extension for capturing, organizing, and verifying web evidence. Pages are saved as MHTML with a full-page screenshot and extracted text, streamed to the desktop app over a loopback HTTP server, and stored on your machine in per-case archives. There is no cloud, no account, and no telemetry — captures never leave your computer unless you export them.

<p align="center">
  <img src="docs/assets/screenshot-case.png" alt="Birdbrain case workspace" width="100%" />
</p>

## Why Birdbrain exists

The tools independent investigators rely on keep getting absorbed into enterprise investigation platforms. Capture tools that cost a hundred dollars a year become line items in plans that cost thousands, tethered to accounts and license servers. Open-source projects get acquired and quietly stop shipping. The people who most need evidence-grade tooling — independent researchers, journalists, activists, students — are the least able to pay enterprise prices for it, and the least able to accept a phone-home dependency in software that handles their evidence.

Birdbrain is a commitment that the capture-and-prove workflow — an approach pioneered by [Hunchly](https://hunch.ly/), which inspired this project — stays available to everyone. It is MIT-licensed and local-first: no account, no license server, no telemetry. Everything it does runs on your machine, so if this project ever stops shipping, fork it and keep working.

## Features

### Capture

Save any page from Chrome as MHTML with a screenshot and the extracted page text. Captures are triggered from the extension and stream into the desktop app over `127.0.0.1` — nothing transits the network beyond your own machine.

### Annotate

Mark up screenshots with shapes and pinned comments. Write per-capture notes. Annotations are burned into exports, so markup travels with the evidence.

### Search

Per-case full-text search across captures and notes (SQLite FTS5). Define text or regex **Selectors** and Birdbrain runs them against every capture in the case — past and future — caching matches for case-wide counts.

### Recon

Every capture is mined for indicators as it lands: IoCs (IPs, domains, hashes, CVEs), tracking pixels (GA, GTM, Facebook Pixel), social handles, `.onion` and I2P hosts, and email addresses. Browse them in a column navigator and pivot from category to indicator to the pages it appeared on — passive recon over everything you visit during an investigation.

### Verify + Export

Every capture is fingerprinted with SHA-256, timestamped, and chained to the previous capture in a per-case manifest. Verify the chain in-app at any time. Export a case as a self-contained HTML report with the manifest included — readable in any browser, verifiable without Birdbrain installed.

<!-- Screenshots section: drop assets into docs/assets/ and uncomment, including the heading. One shot per feature claim:

## Screenshots

<p align="center">
  <img src="docs/assets/screenshot-annotate.png" alt="Annotating a capture screenshot" width="100%" />
  <em>Annotation editor — shapes and pinned comments, burned into exports</em>
</p>
<p align="center">
  <img src="docs/assets/screenshot-recon.png" alt="Indicator column navigator" width="100%" />
  <em>Recon — pivot from indicator category to the pages it appeared on</em>
</p>
<p align="center">
  <img src="docs/assets/screenshot-verify.png" alt="Manifest chain verification" width="100%" />
  <em>Verify — per-case hash chain checked in-app</em>
</p>
<p align="center">
  <img src="docs/assets/screenshot-export.png" alt="Exported HTML report" width="100%" />
  <em>Export — self-contained HTML report, verifiable without Birdbrain</em>
</p>
-->

## Use cases

- **OSINT investigators** — case-organized capture with search, selectors, and indicator pivoting
- **Journalists, researchers, and activists** — evidence that can survive scrutiny, on hardware you control, at no cost
- **Pentesters and red teamers** — passive recon artifacts from every page you touch, plus engagement evidence with a documented chain of custody
- **CTI analysts** — automatic indicator extraction from captured pages, exportable alongside the source evidence

## Install

1. Download Birdbrain for your platform from the [latest release](https://github.com/thebristolsound/birdbrain/releases/latest) and install it.
2. Open Birdbrain. On the dashboard, click **Install Extension** — Birdbrain opens the extension folder for you.
3. Load the extension in Chrome: open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the folder Birdbrain opened.
4. Pin the Birdbrain extension to your toolbar.
5. Return to Birdbrain. The dashboard walks you through creating your first case and capturing your first page.

Works with Chrome, Edge, and Brave. The extension is not on the Chrome Web Store yet, so it installs unpacked (see above).

## Current limitations

Beta software, built by one person. Know before you commit:

- **Search is per-case.** No cross-case search.
- **Capture is page-level.** No element selection, region screenshots, PDF, or video capture.
- **Capture is manual.** Every save is triggered from the extension — no auto-capture-on-visit.
- **Single-user, single-machine.** No shared cases, no team sync, no cloud backup.

## Contributing

Bug reports and feature requests are welcome — open an [issue](https://github.com/thebristolsound/birdbrain/issues). For non-trivial PRs, open an issue first to discuss the shape.

## Acknowledgements

Birdbrain is built on good open source:

- [ioc-extractor](https://github.com/ninoseki/ioc-extractor) — indicator extraction
- [Konva](https://konvajs.org/) — screenshot annotation canvas
- [Hono](https://hono.dev/) — local capture server
- [shadcn/ui](https://ui.shadcn.com/) + [Radix](https://www.radix-ui.com/) — UI primitives
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — the embedded database under every case

## Disclaimer

Birdbrain is beta software, provided as-is and without warranty of any kind. Data formats may change between releases, and the evidence workflow has not been tested in court. Do not rely on Birdbrain as your only copy of evidence that matters — verify exports and keep backups.

Birdbrain is intended for lawful investigation and research. You are solely responsible for how you use it, including compliance with applicable laws and the terms of service of any site you capture. The authors and contributors accept no liability for misuse.

## License

MIT — see [LICENSE](LICENSE).
