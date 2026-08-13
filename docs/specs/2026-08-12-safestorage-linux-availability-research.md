# Is Electron `safeStorage` available on the Linux targets we ship?

Date: 2026-08-12
Tracks: #287 (`wayfinder:research`, under map #284). Feeds: #289 (grilling — what Birdbrain
should *do* when safeStorage is unavailable).
Electron version pinned: **42.5.1** (`package.json` declares `^42.5.1`; `pnpm-lock.yaml` resolves
to 42.5.1), which bundles Chromium **148.0.7778.271** — Chromium citations below are pinned to
that tag rather than a moving branch.

Research only. This establishes what is available where; it does not propose a response.

## Answer in one paragraph

On a stock Ubuntu desktop session, source evidence indicates `safeStorage` **is expected to be
available** to both the `.deb` and the AppImage: Ubuntu's `XDG_CURRENT_DESKTOP` resolves to the
GNOME family, Chromium selects the `gnome_libsecret` backend, and gnome-keyring is present on a
default install. Source evidence indicates it **is expected not to be available** in a headless,
SSH or minimal-install context: the desktop environment is unrecognised, the backend resolves to
`basic_text`, and because Birdbrain never calls `safeStorage.setUsePlainTextEncryption()`,
`isEncryptionAvailable()` returns `false`. Both key paths then write plaintext. The availability
signal is honest — Birdbrain cannot end up writing something that *looks* encrypted but is
protected only by a hardcoded password — but it is silent, and it is decided once per process.

## How availability is decided

Two gates, in order.

**1. Electron's gate** —
[`shell/browser/api/electron_api_safe_storage.cc` @ v42.5.1](https://github.com/electron/electron/blob/v42.5.1/shell/browser/api/electron_api_safe_storage.cc):

```cpp
bool IsEncryptionAvailable() {
#if BUILDFLAG(IS_LINUX)
  if (!electron::Browser::Get()->is_ready())
    return false;
  return OSCrypt::IsEncryptionAvailable() ||
         (use_password_v10 &&
          static_cast<BrowserProcessImpl*>(g_browser_process)
                  ->linux_storage_backend() == "basic_text");
#else
  return OSCrypt::IsEncryptionAvailable();
#endif
}
```

`use_password_v10` is a file-scope `bool` initialised to `false` and set only by
`setUsePlainTextEncryption()`. **Birdbrain never calls it** — `grep -rn
"setUsePlainTextEncryption\|password-store" src/` returns nothing. So for our builds the second
clause is dead and the gate reduces to `is_ready() && OSCrypt::IsEncryptionAvailable()`.

The `is_ready()` term is not a live risk for us: both call sites are initialised inside
`app.whenReady()` — `initSettings` at `src/main/index.ts:302` and `initSigningKey` at
`src/main/index.ts:310`, under the `.whenReady()` at `src/main/index.ts:266`.

**2. Chromium's gate** —
[`components/os_crypt/sync/os_crypt_linux.cc`](https://github.com/chromium/chromium/blob/148.0.7778.271/components/os_crypt/sync/os_crypt_linux.cc):

```cpp
bool OSCryptImpl::IsEncryptionAvailable() {
  // IsEncryptionAvailable() actually means "is real encryption backed by the
  // system secret store available", which here means a v11 key is available,
  // as opposed to the hardcoded v10 obfuscation key.
  return DeriveV11Key();
}
```

`DeriveV11Key()` calls `KeyStorageLinux::CreateService(...)`; if no backend initialises it sets
`try_v11_ = false` and returns false. Two consequences worth noting:

- **The v10 "hardcoded password" path is below Electron's gate, not through it.** Chromium's
  `EncryptString` will happily fall back to `kV10Key` — PBKDF2 of the literal password
  `"peanuts"`, hardcoded in the source — but Electron refuses to call it unless
  `IsEncryptionAvailable()` already returned true. Electron's own docs warn that items "will be
  unprotected as they are encrypted via hardcoded plaintext password" and that you detect this
  via `getSelectedStorageBackend() === 'basic_text'`
  ([safe-storage.md @ v42.5.1](https://github.com/electron/electron/blob/v42.5.1/docs/api/safe-storage.md));
  that warning applies to apps that opt in with `setUsePlainTextEncryption(true)`. We have not,
  so it does not describe our builds.
- **`try_v11_ = false` is sticky for the life of the process.** Availability is computed once
  on first use and cached. A keyring that becomes available later in the session does not
  change the answer until restart.

## Which backend, on which desktop

From the typings shipped in the pinned tree
(`node_modules/electron/electron.d.ts`, `SafeStorage.getSelectedStorageBackend`) and confirmed
by [`key_storage_linux.cc`](https://github.com/chromium/chromium/blob/148.0.7778.271/components/os_crypt/sync/key_storage_linux.cc):

| Backend | Selected when |
| --- | --- |
| `gnome_libsecret` | desktop env is `X-Cinnamon`, `Deepin`, `GNOME`, `Pantheon`, `XFCE`, `UKUI`, `unity`, or `--password-store="gnome-libsecret"` |
| `kwallet` / `kwallet5` / `kwallet6` | desktop session is `kde4` / `kde5` / `kde6`, or the matching `--password-store` flag |
| `basic_text` | **the desktop environment is not recognised**, or `--password-store="basic"` |
| `unknown` | called before the `ready` event |

Selection is by *detected desktop environment*, via `base::nix::GetDesktopEnvironment(env)` —
i.e. environment variables (`XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`), not by probing whether a
Secret Service daemon is actually reachable. Detection and initialisation are separate steps:
`CreateServiceInternal` selects libsecret, calls `WaitForInitOnTaskRunner()`, and logs "OSCrypt
tried Libsecret but couldn't initialise" if that fails, returning `nullptr`. **So a recognised
desktop with no working keyring daemon still ends in the unavailable state** — via init failure
rather than backend selection.

## What our Linux targets actually get

We ship two (`package.json`, `build.linux.target`): **AppImage** and **deb**. The tester guide
names the `.deb` as preferred and the AppImage as the alternative, on Ubuntu
(`website/content/docs/tester-guide.mdx:42-56`), with Ubuntu 24.04 the reference version
(`tester-guide.mdx:139`).

**The `.deb`.** We set no `deb.depends` override, so electron-builder 26.15.3's defaults apply:
`libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1,
libsecret-1-0`
(`node_modules/.pnpm/app-builder-lib@26.15.3_.../out/targets/FpmTarget.js:315`). Note what that
list is and is not: `libsecret-1-0` is the **client library** for talking to a Secret Service
over D-Bus. It is not a provider. Nothing in our dependency list pulls in gnome-keyring, so
`apt install ./birdbrain_*.deb` guarantees the client, never the daemon.

**The AppImage.** Declares no dependencies at all — it is a self-contained image with no
package-manager contract. It gets whatever the host session provides.

**Stock Ubuntu 24.04.** `gnome-keyring` is a **Recommends** of `ubuntu-desktop`, not a Depends
([packages.ubuntu.com/noble/ubuntu-desktop](https://packages.ubuntu.com/noble/ubuntu-desktop)),
alongside `libpam-gnome-keyring` (the PAM module that unlocks the keyring at login). Because apt
installs Recommends by default, a normal desktop install has both, and `safeStorage` works for
either target. The gap is that "Recommends" is a weaker guarantee than it looks: an install made
with `--no-install-recommends`, a server image with a desktop added by hand, or a trimmed
container image can satisfy every declared dependency of our `.deb` and still have no Secret
Service provider.

## Login session vs headless / SSH / VM

This is where the answer changes, and it changes for a mundane reason: **there is no desktop
environment to detect.** Over SSH or in a headless VM, `XDG_CURRENT_DESKTOP` and
`DESKTOP_SESSION` are unset, `GetDesktopEnvironment` returns unrecognised, the backend is
`basic_text`, and — since we do not opt into plaintext encryption — `isEncryptionAvailable()` is
`false`.

A second, independent failure exists even where the desktop *is* recognised: libsecret talks to
gnome-keyring over the D-Bus **session** bus, and the keyring must be unlocked. An SSH login to a
machine that also has a graphical session does not join that session bus, and an auto-login or
passwordless-login setup can leave the keyring locked. Both surface identically to us: init
fails, `IsEncryptionAvailable()` is false.

The expected practical shape for a tester based on source analysis: run Birdbrain from the
desktop, encryption is expected to work; run the same build from `ssh -X` or a bare VM console,
source evidence indicates it will silently not work.

## Can we query which backend was chosen?

Yes — `safeStorage.getSelectedStorageBackend()`, Linux-only, returning one of the five strings in
the table above; it returns `'unknown'` before `ready`. **We do not call it anywhere**
(`grep -rn "getSelectedStorageBackend" src/` → no matches). It is the only way to distinguish
"unavailable because there is no desktop environment" (`basic_text`) from "unavailable because a
recognised backend failed to initialise" (`gnome_libsecret` + `isEncryptionAvailable() === false`)
— a distinction that matters for any operator-facing message, since the remedies differ.

## Does the same answer apply to the OpenRouter key?

Yes. Both paths share one gate and one shape:

| | Signing key | OpenRouter API key |
| --- | --- | --- |
| Wrap | `src/main/services/signingKey.ts:23-32` | `src/main/services/settings.ts:25-35` |
| Unwrap | `src/main/services/signingKey.ts:34-44` | `src/main/services/settings.ts:37-48` |
| Gate | `_safeStorage?.isEncryptionAvailable()` | identical |
| On unavailable, writing | returns the raw PEM — **plaintext on disk** | returns the raw key — **plaintext on disk** |
| On unavailable, reading an `enc:` blob | returns `null` → `initSigningKey` throws (`signingKey.ts:55-66`) | returns `null` → key reads as absent |

Two differences in consequence, not in mechanism:

- **Signing key fails closed on read.** `initSigningKey` refuses to regenerate, because silent
  rotation would invalidate every previously signed manifest entry (`signingKey.ts:56-65`). That
  is a startup-blocking throw.
- **The API key fails open on read** — `decryptApiKey` returning `null` looks like "no key
  configured". `updateSettings` guards the write side against erasing it: an update that does not
  explicitly set `openRouterApiKey` re-reads the raw stored value from disk and preserves it
  (`settings.ts:133-149`), so an unreadable blob is not destroyed by an unrelated settings change.

Both wrap paths swallow their exception (`catch { /* encryption not available */ }`,
`signingKey.ts:28-30`, `settings.ts:31-33`) and fall through to returning the plaintext. Nothing
is logged on either path, and nothing is surfaced to the renderer.

## Expected behavior on a headless Linux tester's machine (source-derived)

Source evidence indicates the following behavior is expected:

1. `initSettings` / `initSigningKey` run inside `whenReady`.
2. `isEncryptionAvailable()` is expected to return `false` (no desktop env → `basic_text` → no v11 key).
3. First run: a fresh keypair is generated and source evidence indicates the **private key is
   expected to be written to `userData/signing-key.pem` in the clear**, with no `enc:` prefix, no
   warning, no log line. An OpenRouter key entered later is expected to be written to
   `settings.json` in the clear the same way.
4. Every later run on that machine is expected to read the plaintext back happily —
   `unwrapPrivateKey` returns early for anything not prefixed `enc:` (`signingKey.ts:35`).
5. The state is expected to be invisible: no diagnostics field, no settings indicator, no log
   entry distinguishes it from a machine where encryption worked.

The mirror-image case is a machine that *had* a keyring and loses it (keyring uninstalled, or the
app launched over SSH after being set up on the desktop): the stored blob is `enc:`-prefixed,
step 2 is false, `unwrapPrivateKey` returns `null`, and source evidence indicates startup is
expected to throw the refuse-to-rotate error at `signingKey.ts:60-65`. Under these conditions the
same event is expected to be a hard failure in one direction and a silent downgrade in the other.

## Open / not verified

- **Not tested on real hardware.** Every claim here is from source, docs, packaging metadata or
  the archive — no Ubuntu install was run against a packaged build. The end-to-end walk-through
  above is derived, not observed. A ten-minute check on a 24.04 VM (desktop, then the same
  build over SSH, printing `isEncryptionAvailable()` and `getSelectedStorageBackend()`) would
  settle it.
- **`ubuntu-desktop-minimal`'s Recommends list** was truncated in the fetched page; I confirmed
  `gnome-keyring` is a Recommends of `ubuntu-desktop` but did not confirm it for
  `ubuntu-desktop-minimal`, which is what some installer paths select.
- **Snap/Flatpak confinement** is out of scope — we ship neither, but if that changes, portal
  mediation of the Secret Service is a separate question.
- **Whether Electron's official builds define `USE_LIBSECRET`** is inferred from the fact that
  `gnome_libsecret` is a documented return value of `getSelectedStorageBackend()`, not read off a
  build config for 42.5.1.
- **Other desktops we do not test** (Wayland-only sessions, Sway, i3) will land in `basic_text`
  by the detection table, but I did not enumerate what `XDG_CURRENT_DESKTOP` those set.
