<p align="center">
  <img src="resources/icon_nobg.png" alt="Birdbrain" width="120" />
</p>

# Birdbrain

**Save the web. Prove you saved it.**

An open-source desktop tool for OSINT investigators. Every capture is fingerprinted, timestamped, and linked to the one before it — so months later, you (or anyone you hand the case to) can prove nothing was quietly edited.

<p align="center">
  <a href="https://github.com/thebristolsound/birdbrain/releases/latest"><img src="https://img.shields.io/github/v/release/thebristolsound/birdbrain?style=for-the-badge" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/status-alpha-orange.svg?style=for-the-badge" alt="Status: alpha" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg?style=for-the-badge" alt="Platform" />
  <a href="LICENSE"><img src="https://img.shields.io/github/license/thebristolsound/birdbrain.svg?style=for-the-badge" alt="License: MIT" /></a>
  <a href="https://github.com/thebristolsound/birdbrain/stargazers"><img src="https://img.shields.io/github/stars/thebristolsound/birdbrain.svg?style=for-the-badge" alt="Stars" /></a>
</p>

---

<p align="center">
  <img src="docs/assets/screenshot-case.png" alt="Birdbrain Case workspace" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/thebristolsound/birdbrain/releases/latest"><img src="https://img.shields.io/badge/Download-Windows-0078d4?style=for-the-badge&logo=windows&logoColor=white" alt="Download for Windows" /></a>
  <a href="https://github.com/thebristolsound/birdbrain/releases/latest"><img src="https://img.shields.io/badge/Download-macOS-000000?style=for-the-badge&logo=apple&logoColor=white" alt="Download for macOS" /></a>
  <a href="https://github.com/thebristolsound/birdbrain/releases/latest"><img src="https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Download for Linux" /></a>
</p>

---

## What it does

### Capture

Save any page from Chrome as MHTML, with a screenshot and the extracted page text alongside it. Captures stream into your local app over a loopback HTTP server — no cloud, no account, no telemetry.

### Annotate

Mark up screenshots with shapes and pinned comments. Write per-capture notes. Annotations are burned into exports, so the markup travels with the evidence.

### Find

Per-case full-text search across captures and notes. Define text or regex **Selectors** and Birdbrain runs them across every Capture in the Case — past and future — caching the matches for instant case-wide counts.

### Explore

Every capture is auto-mined for indicators: IoCs (IPs, domains, hashes, CVEs), tracking pixels (GA, GTM, Facebook Pixel), social handles, `.onion` and I2P hosts, emails, and more. Browse them in a column navigator — pivot from category to indicator to the pages it appeared on.

### Prove + Export

Every Capture is fingerprinted (SHA-256), timestamped, and chained to the one before it in a per-Case manifest. Verify the chain in-app. Export the Case as a self-contained HTML report with the manifest included — readable in any browser, verifiable without Birdbrain installed.

---

## Install

1. **Download Birdbrain** for your platform from the [latest release](https://github.com/thebristolsound/birdbrain/releases/latest) and install it.
2. **Open Birdbrain.** On the dashboard, click **Install Extension** — Birdbrain will open the extension folder for you.
3. **Load the extension in Chrome.** Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and point it at the folder Birdbrain just opened.

   <p align="center">
     <img src="docs/assets/install-extension.png" alt="Loading the unpacked extension in chrome://extensions" width="80%" />
   </p>

4. **Pin the Birdbrain extension** to your toolbar so it's one click away.
5. **Return to Birdbrain.** The dashboard will walk you through creating your first Case and capturing your first page.

Works with Chrome, Edge, and Brave. Full step-by-step (including Edge and Brave quirks) lives in [docs/install-extension.md](docs/install-extension.md).

---

## What Birdbrain doesn't do (yet)

This is an alpha tool built by one person. A few things to know before you commit:

- **Search is per-case.** No cross-case search.
- **Capture is page-level.** No element selection, no region screenshots, no PDF or video capture.
- **Capture is manual.** You trigger every save from the extension — there's no auto-capture-on-visit.
- **The extension isn't on the Chrome Web Store yet.** You'll install it as an unpacked extension (see Install above).
- **Single-user, single-machine.** No shared cases, no team sync, no cloud backup.

---

## Contributing

Birdbrain is open source under MIT. Bug reports and feature requests are welcome — please open an [issue](https://github.com/thebristolsound/birdbrain/issues). For non-trivial PRs, open an issue first so we can talk about shape.

---

## Acknowledgements

Birdbrain stands on top of a lot of good open source:

- [ioc-extractor](https://github.com/ninoseki/ioc-extractor) — powers the indicator catalog
- [Konva](https://konvajs.org/) — the screenshot annotation canvas
- [Hono](https://hono.dev/) — the local capture server
- [shadcn/ui](https://ui.shadcn.com/) + [Radix](https://www.radix-ui.com/) — UI primitives
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — the embedded database under every Case

---

## License

MIT — see [LICENSE](LICENSE).
