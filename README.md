# Birdbrain

Birdbrain is an open-source desktop app for web investigations. Save pages as you browse,
organize them into Cases, and connect what you find with searchable text, tags, notes, and
selectors. Export the saved material with a signed history and instructions for checking it
without installing Birdbrain.

[![Release](https://img.shields.io/github/v/release/thebristolsound/birdbrain?include_prereleases&label=release)](https://github.com/thebristolsound/birdbrain/releases)
[![CI](https://github.com/thebristolsound/birdbrain/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/thebristolsound/birdbrain/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Status: beta](https://img.shields.io/badge/status-beta-yellow)

The app stores your Cases on your machine. A companion Chrome extension sends captures to
it over a local connection. You need no account, and Birdbrain collects no telemetry.

**Birdbrain is in public beta and has one maintainer.** Use low-stakes material while you
try it, keep separate copies of anything you cannot afford to lose, and expect data formats
to change between beta releases.

[Download Birdbrain](https://github.com/thebristolsound/birdbrain/releases) ·
[Install and first capture](https://docs.birdbrain.cc/docs/tester-guide) ·
[Screenshot tour](https://docs.birdbrain.cc/docs/screenshots) ·
[Documentation](https://docs.birdbrain.cc)

## Get started

Choose a build from the [releases page](https://github.com/thebristolsound/birdbrain/releases).

| Platform | Build | Support |
| --- | --- | --- |
| Windows 10 / 11 | `.exe` installer | Supported; unsigned, so SmartScreen warns on first launch |
| Ubuntu | AppImage | Supported; needs FUSE 2 or `--appimage-extract-and-run` |
| Ubuntu | `.deb` | Best-effort; installing updates requires your system password |
| macOS 13 or later | `.dmg`, when available | Experimental; unsigned, not notarized, no in-app updates |

The [download guide](https://docs.birdbrain.cc/docs/download) covers installation and platform
limits. You do not need to build the app from source.

To capture from Chrome, load the bundled extension. It is not on the Chrome Web Store yet.

1. Open Birdbrain and choose **Open extension folder** on the dashboard.
2. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
3. Choose **Load unpacked** and select the folder Birdbrain opened.
4. Create a Case in Birdbrain, select it in the extension, and capture a page.

Keep Birdbrain open while capturing. After an app update, reload the extension in Chrome.
The [first-capture walkthrough](https://docs.birdbrain.cc/docs/tester-guide) includes pairing
and troubleshooting.

## Build an investigation

Save the page you are looking at through the extension popup or its right-click menu.
Birdbrain stores the archived page as MHTML, extracts its text, and takes a screenshot when
available. You can also paste URLs into the desktop app for background capture. Those
captures describe what the app loaded separately from what you witnessed in your browser.
Automatic capture while you browse is turned off in this beta.

Once you have captures in a Case, you can:

- Search their text and inspect the saved page, screenshot, links, and response details.
- Tag related captures and write notes that link back to them.
- Add selectors to find exact text or regular expressions across existing and future captures.
- Follow extracted indicators such as domains, email addresses, cryptocurrency addresses,
  and tracking codes to the captures where they appear.
- Annotate screenshots while keeping the originals unchanged.
- Recapture a URL as a new, linked capture while keeping the earlier one.
- Look up and compare Internet Archive snapshots. Each lookup sends the URL to archive.org.

The [feature reference](https://docs.birdbrain.cc/docs/features) describes capture limits and
the available investigation tools. It tracks the main branch; changes since the latest
release ship with the next one.

## Check what you saved

Birdbrain hashes stored capture files with SHA-256 and records them in each Case's Manifest,
a history whose entries link to their predecessors and carry the installation's signature.
Verification checks the stored bytes against that history and checks the chain and signatures.
Someone without the signing key cannot edit the signed history and produce valid signatures.
The person controlling the installation also controls its key and can create a new,
internally consistent history.

Trusted time answers a separate question. Birdbrain can request an RFC 3161 timestamp from
an external time-stamping authority, DigiCert by default. It sends a content hash, not the
captured page. An authenticated token establishes that the matching bytes existed no later
than the stamped time. It does not date or authenticate the surrounding Manifest chain.

Neither check establishes that a website's claims are true or that a capture contains
everything the site showed. Read the [threat model](https://docs.birdbrain.cc/docs/threat-model)
for the scope of these checks, signing-key protection, and historical format limits.

## Export or share a Case

An evidence package includes a report, saved capture files, signed Manifests, public keys,
and timestamp material. Its `VERIFY.md` explains how to check it with `sha256sum`, `openssl`,
and `jq`; `verify.sh` automates the checks. Authenticating timestamp tokens requires the
OpenSSL check described in that runbook.

A portable `.birdbrain` Case Archive lets you move your work into another Birdbrain
installation. Import verifies the archive before writing its contents and creates a new Case.
Keep exports somewhere separate from your live data. The app's database backup copies only
the database, not capture files.

For ongoing work with teammates, a Shared Case gives each member a full copy and a separately
signed history. Sync runs while both installations are open. Sharing is designed for small
groups and is unavailable on Intel Macs. Revoking a member stops their sync; it does not
delete the copy they already have.

## Know where your data goes

Birdbrain does not encrypt the database or capture files at rest. Use operating-system
full-disk encryption if you need to protect them on disk.

Captures travel from the extension to `127.0.0.1:19845` and stay in Case directories under
the app's configured storage location. Birdbrain also makes outbound connections for
capture and recapture, timestamp requests, certificate checks, consent-filter downloads,
Internet Archive lookups, and release updates.

Sharing sends Case data to teammates. Its transport connects through relays and directly to
members, and bypasses Birdbrain's proxy and Tor settings. Relays see your public IP address;
teammates can also learn your machine's interface addresses. Read
[network egress](SECURITY.md#network-egress) before sharing a sensitive Case.

Before handing an export to someone else, check its contents. Screenshot redaction boxes
hide material in the report, but evidence packages retain the original screenshot and saved
page. Captures can contain private text or reusable credentials. Deleting a capture removes
its files, but its URL, time, and hashes remain in the Manifest.

## Run from source

Use Node.js 20 and pnpm 10.28.2, as pinned in the repository. Newer Node.js majors can leave
Electron incompletely installed even when dependency installation appears to succeed.

```bash
git clone https://github.com/thebristolsound/birdbrain.git
cd birdbrain
pnpm install
pnpm build:extension
pnpm dev
```

Load `extension/dist` as an unpacked extension in Chrome. If you use mise, `mise exec --`
runs a command with the repository's pinned tools, for example `mise exec -- pnpm dev`.

The app uses Electron, React, and SQLite. The [architecture guide](docs/agents/architecture.md)
explains the desktop processes, extension, and data access. See
[CONTRIBUTING.md](CONTRIBUTING.md) for setup and review expectations and
[the testing guide](docs/agents/testing.md) for the test runners.

Use `pnpm check` between edits. Before submitting a change, commit it and run `pnpm preflight`
on the clean tree for lint, type checks, tests, build, and coverage checks.

## Help improve Birdbrain

[Report a bug](https://github.com/thebristolsound/birdbrain/issues) with steps to reproduce it.
Capture failures, lost or changed evidence, and misleading verification results are especially
useful reports. Keep private investigation data out of public issues.

Report exploitable security vulnerabilities privately through
[the security policy](SECURITY.md#reporting-a-vulnerability).
Discuss substantial changes in an issue before writing code. The project has one maintainer
and makes no response-time guarantee.

Birdbrain is released under the [MIT license](LICENSE).
