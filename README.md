# Birdbrain

Birdbrain is a local-first, open source desktop app, with a companion Chromium extension, for
OSINT investigators and journalists who need to capture web pages as evidence, organize them
into cases, and show later that the record has not changed. It runs on Windows and Ubuntu, has
an experimental macOS build, and is in public beta.

[![Release](https://img.shields.io/github/v/release/thebristolsound/birdbrain-releases?include_prereleases&label=release)](https://github.com/thebristolsound/birdbrain-releases/releases)
[![CI](https://github.com/thebristolsound/birdbrain/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/thebristolsound/birdbrain/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Status: beta](https://img.shields.io/badge/status-beta-yellow)

[Download](https://docs.birdbrain.cc/docs/download) ·
[Install and first capture](https://docs.birdbrain.cc/docs/tester-guide) ·
[Screenshot tour](https://docs.birdbrain.cc/docs/screenshots) ·
[Features and limits](https://docs.birdbrain.cc/docs/features) ·
[Threat model](https://docs.birdbrain.cc/docs/threat-model)

![A case in Birdbrain, showing the capture list, a saved page, and its chain of custody](website/content/images/screenshot-case.png)

## How it works

1. **Capture.** Click the extension on a page. Birdbrain saves the page as MHTML, a full-page
   screenshot, and the extracted page text. The extension sends the capture to the desktop app
   over `127.0.0.1`, and the app stores it in a per-case folder on your machine.
2. **Record.** Birdbrain hashes the stored bytes with SHA-256 and appends a signed entry to the
   case's hash-chained manifest. It also requests an RFC 3161 timestamp token for the content
   hash. The capture's trusted time stays `pending` until the timestamp authority answers, for
   example while you are offline.
3. **Verify.** You can check the manifest chain in the app. An exported evidence package
   includes a `VERIFY.md` runbook that repeats the check with `sha256sum`, `openssl`, and `jq`,
   so the recipient does not need Birdbrain installed.

Birdbrain has no account and no telemetry. Captures leave the machine only when you export
them.

A verified chain shows that nobody changed the record without the install's signing key. It
does not show that the page itself was genuine, and no court has tested the workflow. The
[threat model](https://docs.birdbrain.cc/docs/threat-model) lists what the controls defend
against and what they do not.

## Get it

Builds are on the [releases page](https://github.com/thebristolsound/birdbrain-releases/releases),
in a separate public repository that holds releases only. You need no GitHub account to
download one. The Windows installer and the Ubuntu AppImage are supported; the macOS build is
experimental. The extension is not on the Chrome Web Store yet, so it loads unpacked, and the
app's **Setup Guide** walks you through that.

[Download](https://docs.birdbrain.cc/docs/download) has the platform notes and the published
hashes. [Install and first capture](https://docs.birdbrain.cc/docs/tester-guide) has the steps.

## Before you rely on it

This is beta software with one maintainer. Use synthetic or low-stakes material where you can,
and export anything you cannot afford to lose. The
[features page](https://docs.birdbrain.cc/docs/features) says what Birdbrain does, what it does
not do yet, and which hosts it connects to. The larger pieces of planned work, such as shared
cases ([#1508](https://github.com/thebristolsound/birdbrain/issues/1508)) and automatic capture
([#600](https://github.com/thebristolsound/birdbrain/issues/600)), are tracked as issues.

## Reporting a problem

Report bugs as an issue on the
[releases repository](https://github.com/thebristolsound/birdbrain-releases/issues).
**Settings → Diagnostics → Report a problem** builds a diagnostic bundle to attach. The bundle
excludes your captures and your case database, but it carries your installation identifier,
which also appears in every evidence package you export. Do not put a live investigation
subject in a bug report.

Report security vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## Development

Birdbrain is an Electron app written in strict TypeScript. It builds on Node 20 with pnpm:

```bash
pnpm install
pnpm dev
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers the full setup and the checks to run before a pull
request. Open an issue on this repository before starting a non-trivial change.

## License

MIT. See [LICENSE](LICENSE). Birdbrain is provided as is, without warranty. You are responsible
for using it lawfully and within the terms of service of the sites you capture.
