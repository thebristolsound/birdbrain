# Birdbrain Tester Guide

Welcome, and thanks for testing Birdbrain — an open source web investigation and
capture tool. It pairs a desktop app with a Chrome extension: the extension captures
pages as you browse, and the app organizes those captures into investigations you can
annotate, search, and export with forensic integrity (hashes, timestamps, audit
manifests).

**This is beta software.** Expect rough edges, and export anything you can't afford to
lose (see [Known limitations](#known-limitations)).

## What we're looking for

Everything is fair game, but these are especially valuable:

- **Install friction** — anywhere you got stuck or confused getting to your first
  capture, even briefly
- **Capture reliability** — pages that fail to capture, capture incompletely, or look
  wrong in the viewer
- **Real-workflow fit** — you run an actual investigation with it: what's missing,
  what's awkward, what surprised you
- **Crashes and data issues** — anything lost, duplicated, or corrupted

Report in the tester chat — format at the bottom of this guide.

## Install the app

Download the latest release from
[github.com/thebristolsound/birdbrain/releases](https://github.com/thebristolsound/birdbrain/releases)
— current build: **v1.0.1-beta.11**.

### Windows

1. Download `Birdbrain.Setup.<version>.exe` and run it.
2. Windows SmartScreen will warn about an unrecognized app (our builds aren't
   code-signed yet). Click **More info → Run anyway**.
3. The installer finishes and launches Birdbrain.

### Ubuntu

Preferred — the `.deb`:

```bash
sudo apt install ./birdbrain_<version>_amd64.deb
```

Then launch **Birdbrain** from your app launcher, or run `birdbrain` in a terminal.

Alternative — the AppImage (no install needed):

```bash
chmod +x Birdbrain-<version>.AppImage
./Birdbrain-<version>.AppImage
```

## Install the Chrome extension

The extension isn't on the Chrome Web Store yet, so it loads in developer mode. The
app walks you through this on first launch (and under the extension install guide),
including an **Open extension folder** button that opens the right folder for you.

The short version:

1. Open `chrome://extensions` in Chrome.
2. Switch on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the extension folder — the one containing
   `manifest.json`. Use the app's **Open extension folder** button to find it, or
   unzip `birdbrain-extension.zip` from the release and select that folder.
4. The Birdbrain icon appears in your Chrome toolbar. Back in the app, the status
   should flip to **Extension connected**.

The desktop app must be running for the extension to work — it talks to the app
locally on `127.0.0.1:19845`. Nothing is sent to any external server.

## Your first capture

1. In the app, create an investigation (the first-run wizard prompts you; name it
   anything).
2. Browse to any page in Chrome.
3. Click the Birdbrain toolbar icon and hit **Capture this page**.
4. The capture appears in the app under your investigation's **Captures** tab, with
   provenance details (hashes, timestamps) attached.

From there, explore: annotate screenshots, add notes and tags, define selectors, try
full-text search on the Data page, and export the investigation when you're done.

## Updating

There's no auto-update yet. When a new beta ships we'll post in the tester chat —
download the new installer from the releases page and install over the old version.
Your data is kept: it lives in your user data directory, separate from the app.

If the extension changed in the release notes, also re-load it: `chrome://extensions`
→ click the reload icon on the Birdbrain card (or **Load unpacked** again if the
folder moved).

## Known limitations

- **Unsigned builds** — SmartScreen warnings on Windows are expected.
- **No auto-update** — watch the tester chat for new versions.
- **Extension is sideloaded** — Chrome may occasionally nag about developer-mode
  extensions.
- **Local-only data, no backup** — captures live only on your machine. Export
  anything you can't lose before updating or uninstalling.
- **Chrome/Chromium only** — no Firefox or Safari extension yet.

## Reporting a problem

Birdbrain keeps a local diagnostic log and can bundle it into a report for you:

1. Go to **Settings → Diagnostics → Report a problem**.
2. Fill in what you did, what you expected, and what happened.
3. Click **Create report**. Pick where to save it — Birdbrain writes a `.zip`
   there and opens the folder for you.

That zip is saved **only to your computer**. Birdbrain never uploads it or sends
it anywhere — attach it to the tester chat yourself, the same way you'd attach any
other file. It contains the diagnostic log, a few app/session facts (version,
platform, recent performance stats), and what you typed in the report form. It does
**not** contain your captures, your case database, or your OpenRouter API key.

If Birdbrain closed unexpectedly last time (a crash, a forced quit, a power loss),
it will offer to create a report automatically the next time you open it — click
**Create a report** on that prompt to file it the same way.

You can also open **Settings → Diagnostics → Log** any time to see recent log
entries in the app itself, filterable by level, with a button to reveal the raw
log file on disk.

## Reporting bugs

Post in the tester chat with:

1. **Version** — e.g. 1.0.1-beta.11 (the release you downloaded; check the installer
   filename if unsure)
2. **OS** — e.g. Windows 11 / Ubuntu 24.04
3. **What you did** — steps, in order
4. **What you expected**
5. **What happened** — plus a screenshot if it's visual

Use **Report a problem** (above) to attach a diagnostic bundle alongside your
description — good repro steps plus a report bundle is the single most useful
thing you can give us. Small, frequent reports beat one big write-up.
