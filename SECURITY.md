# Security Policy

## Supported versions

Birdbrain is beta software. Only the [latest release](https://github.com/thebristolsound/birdbrain-releases/releases/latest) is supported; older versions do not receive fixes.

## Reporting a vulnerability

Please do not report exploitable vulnerabilities in public issues.

- **Preferred:** GitHub private vulnerability reporting — the **Security** tab → **Report a vulnerability**.
- **Fallback:** email `mattddonovan@proton.me`.

This is a solo-maintained project; reports are handled on a best-effort basis, usually within a week. Non-sensitive hardening suggestions are welcome as ordinary issues.

## Scope and threat model

The forensic guarantees (hash chain, manifest signatures, RFC 3161 trusted timestamps) are specified in the [threat model](website/content/docs/threat-model.mdx), including what they deliberately do **not** defend against. Read it before reporting a finding about capture integrity — several apparent gaps are documented design limits.

Out of scope:

- An operator forging their own evidence. The manifest signing key lives on the operator's machine; a determined operator can mint an internally consistent chain. The external RFC 3161 timestamp is the anchor that constrains this — see the threat model.
- Attacks that require running code as the Birdbrain user on the same machine.
- Denial of service against the loopback capture server.

## Security architecture

- **Capture traffic never leaves the machine.** The capture server binds `127.0.0.1:19845` only, rejects requests whose `Host` header is not a loopback address (DNS-rebinding guard), and requires a per-installation random token on all mutating requests.
- **Renderer isolation.** The renderer runs with the Chromium sandbox and context isolation; Node integration is disabled. All renderer↔main communication goes through a typed `contextBridge` API — no raw `ipcRenderer` is exposed, and no IPC channel accepts arbitrary filesystem paths or shell commands from the renderer.
- **Secrets at rest.** The manifest signing key is encrypted with Electron `safeStorage` (DPAPI / Keychain / kwallet–libsecret). Where the OS provides no credential store (some headless or minimal Linux setups), it falls back to a plaintext file in the user-data directory — see Known limitations.
- **Extension.** The companion extension requests broad host permissions (`http://*/*`, `https://*/*`) because capture must work on arbitrary pages. It sends captures only to the loopback server, authenticates with the per-installation token, and its background handlers reject messages from other extensions.

## Network egress

The complete list of outbound connections Birdbrain can make:

1. **RFC 3161 timestamp authority** (default `http://timestamp.digicert.com`, configurable in Settings) — sends content hashes only, never captured content. Timestamp tokens are CMS-signed by the TSA, so their validity does not depend on the transport.
2. **The captured site itself** — after each HTTPS capture, a follow-up TLS connection to the captured origin records its current certificate chain as corroborating evidence. Your machine contacts the target a second time, outside the browser.
3. **Wayback Machine** (`web.archive.org`) — sends the capture's URL, only when you explicitly use the Wayback lookup/pin feature.
4. **Consent-banner filter lists** (`secure.fanboy.co.nz`, `ublockorigin.github.io`) — public cookie-banner filter lists, downloaded before a background recapture.
5. **GitHub releases** — update checks and downloads.

There is no telemetry, no account, and no other network activity. Captured evidence leaves the machine only when you export it. Note that items 2–4 disclose the captured or looked-up URL (or your interest in it) to a third party or to the target itself; if you investigate through a VPN or Tor, route the whole machine so these requests do not take your bare network path.

## Dependency advisories and distribution

Birdbrain is **not published to any npm registry**. Releases are desktop installers built by `.github/workflows/release.yml`. Two guards, with different reach:

- **`"private": true`** is the one that stops a real publish. npm raises `EPRIVATE` inside `libnpmpublish` before uploading anything. Note this is after the credential check, so an unauthenticated attempt fails on auth first.
- **A `prepublishOnly` hook** (`scripts/no-registry-publish.mjs`) makes the guard visible in a rehearsal: `npm publish --dry-run` never reaches the `EPRIVATE` check and otherwise reports success. The hook is a lifecycle script, so `npm publish --ignore-scripts` skips it — that bypasses only the rehearsal, not `private` itself.

`.github/workflows/security.yml` audits the app's dependency tree on pushes to `main` and on pull requests targeting `main`. Any **high** or **critical** advisory fails the build.

Most findings are cleared outright by a version override in `pnpm-workspace.yaml`; that is always the first choice, because it removes the vulnerable code rather than recording a decision about it. What an override cannot fix carries an entry in [`audit-exceptions.json`](audit-exceptions.json), which records the advisory, the package and tree it affects, why it is accepted (which shipped or reachable path it does *not* have), and an expiry date after which the build fails again until the call is re-made. Expiries are capped at 180 days and warn 21 days ahead. A failed audit (unreachable registry, for instance) fails the job rather than reading as a clean tree. Run the same check locally with `pnpm audit:check`.

## Known limitations

Pre-declared so they are not rediscovered as findings:

- **Release artifacts are unsigned.** There is currently no Authenticode signing or macOS notarization. Update integrity relies on electron-updater's SHA-512 hashes in the `latest*.yml` metadata served from GitHub releases over HTTPS. Expect OS installer warnings.
- **Renderer CSP allows `'unsafe-inline'`** for scripts and styles (build-tooling constraint), mitigated by sandboxing, context isolation, and the loopback-only `connect-src`.
- **`safeStorage` plaintext fallback.** On systems without an OS credential store, the signing key is stored unencrypted in the user-data directory.
- **Loopback GET endpoints are unauthenticated.** `/api/status`, `/api/cases`, and `/api/selectors/active` require no token, so any local process can read case names and selector patterns. Mutations require the token — but `/api/status` returns that token to origin-less requests (e.g. `curl`), which is how the extension pairs with the app, so a local process can obtain it and write captures. Defending against hostile code already running as the Birdbrain user is out of scope (see above).
