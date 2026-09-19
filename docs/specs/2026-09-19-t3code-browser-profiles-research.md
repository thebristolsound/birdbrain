# t3code browser profiles and preview browser: research

Pinned note under map #541, feeding phase 3 of
[the persona cookie-import plan](../plans/2026-09-19-persona-cookie-import.md). Research only;
nothing here is a decision.

## Question

t3code (the coding harness by the T3 team, `pingdotgg/t3code`) added browser profiles to its
preview browser. How does it model a profile, where does profile state live on disk, how is a
browser started against a profile, how does the integrated preview browser work, and what of that
is reusable when Birdbrain considers launching a hardened per-persona Chromium profile instead of
rendering in an Electron partition?

## Sources read

All reads are primary source, done on 2026-09-19.

- Upstream `main` at commit
  [`b44c1ce5`](https://github.com/pingdotgg/t3code/commit/b44c1ce5d25ee0d5a5be82e380618a886c19ea96)
  (2026-09-19T16:46Z), read from a sparse shallow clone in `/tmp/t3code-head`. Every file link
  below is pinned to that commit.
- Pull request [#7254 "feat(desktop): browser profiles for the preview browser"](https://github.com/pingdotgg/t3code/pull/7254),
  merged 2026-09-02T21:56Z as commit `134d5109`. The PR body and its 40-file diff list are the
  design statement for the feature.
- The local clone at `/home/matt/dev/personal/t3code` is at `9842518c` (2026-08-30) and predates
  the profile commit, so it was used only to confirm the layout. Its
  `packages/client-runtime/src/connection/profileStore.ts` is a connection profile, unrelated.
- Installed runtime state under `/home/matt/.t3/` (`userdata/`, `tools/agent-device/0.20.10`,
  `runtime/`) and the global `t3` package at version 0.0.38 (`node_modules/t3/package.json`).
- Electron documentation for `session.fromPartition` and `ses.storagePath`, fetched through
  Context7 from `electron/electron` `docs/api/session.md`.

## How t3code models a profile

A profile is a small record in client settings, not a database row, and not a directory.

[`packages/contracts/src/browserProfile.ts`](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/packages/contracts/src/browserProfile.ts)
defines it:

```ts
export const BrowserProfile = Schema.Struct({
  id: BrowserProfileId,     // trimmed, non-empty, max 64 chars, no control characters
  name: BrowserProfileName, // trimmed, non-empty, max 48 chars
  kind: BrowserProfileKind, // "persistent" | "incognito"
});
```

The file header states the intent: "Each profile maps to its own Electron session partition, so
cookies and storage are isolated between them: a tab opened under "Work" cannot see
"Personal"'s logins. Profiles are client-local, like the other browser defaults, because the
Chromium guest they configure is desktop-local."

Two profiles are built in and "synthesized rather than stored, so they cannot be renamed out of
existence or deleted by editing the settings file by hand": `default` (persistent, keeps the
pre-profiles partition) and `incognito` (in-memory). User profiles are capped at
`BROWSER_PROFILE_MAX_COUNT = 24`. `resolveBrowserProfiles` returns built-ins first, drops entries
that collide with a built-in id or repeat an id ("First entry wins"), and forces `kind` to
`persistent` on anything that is not the built-in incognito, because, in its words, "persistence is keyed off
that one id" and nothing else.

The registry lives in the client settings schema,
[`packages/contracts/src/settings.ts` lines 341 to 347](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/packages/contracts/src/settings.ts#L341-L347):
`browserProfiles: Schema.Array(BrowserProfile)` defaulting to `[]`, and
`browserDefaultProfileId` defaulting to `"default"`. Client settings are a JSON file at
`<stateDir>/client-settings.json`, where `stateDir` is `~/.t3/userdata` in production
([`DesktopEnvironment.test.ts` lines 65 to 74](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/desktop/src/app/DesktopEnvironment.test.ts#L65-L74)).
That file is not present in this machine's `~/.t3/userdata`, which holds only server-side state.

Default resolution ([`apps/web/src/browser/browserDefaults.ts`](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/web/src/browser/browserDefaults.ts))
falls back to `default` when the configured id no longer exists and refuses incognito as a
default: "a profile that discards everything on close would leave every new tab signed out."

A tab keeps its profile for its whole life. The preview session snapshot carries `profileId`
with the note "Electron only honours a `<webview>`'s partition before attach, so switching would
require tearing the guest down and losing page state"
([`packages/contracts/src/preview.ts` lines 175 to 178](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/packages/contracts/src/preview.ts#L175-L178)).

### Where the cookies live

The profile record is only a name. The data is an Electron session partition derived in
[`apps/desktop/src/ipc/methods/preview.ts` lines 231 to 250](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/desktop/src/ipc/methods/preview.ts#L231-L250):

```ts
if (profileId === undefined || profileId === DEFAULT_BROWSER_PROFILE_ID) {
  return { scope: environmentId, persistent: true };
}
return {
  scope: JSON.stringify([environmentId, profileId]),
  persistent: profileId !== INCOGNITO_BROWSER_PROFILE_ID,
  namespace: "profile" as const,
};
```

and turned into a partition string in
[`apps/desktop/src/preview/BrowserSession.ts`](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/desktop/src/preview/BrowserSession.ts):
prefix `persist:t3code-preview-` (or `t3code-preview-ephemeral-` for incognito, which "deliberately
omit[s] the `persist:` prefix, which is what makes Chromium keep them in memory"), then the
literal `profile-` marker for non-default profiles, then the first 20 hex characters of a SHA-256
digest of the scope. So a user profile is
`persist:t3code-preview-profile-<20 hex>` and the default profile stays on the legacy
`persist:t3code-preview-<20 hex>` so that, as the comment puts it, "upgrading does not sign anyone out" on the way in. Lone UTF-16 surrogates
and backslashes in the scope are escaped before hashing so two distinct ids cannot share a
partition.

On disk, Electron persists any `persist:` partition under the app's `userData` directory and
exposes the exact path per session as `ses.storagePath` (Electron `docs/api/session.md`).
t3code's `userData` is `<appData>/t3code` (`<appData>/T3 Code (Alpha)` on installs that predate
the rename), set in
[`DesktopEnvironment.ts` lines 189 to 190](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/desktop/src/app/DesktopEnvironment.ts#L189-L190)
and applied by `electronApp.setPath("userData", ...)` in `DesktopApp.ts`. This is a different
tree from `~/.t3/userdata`, which holds settings, logs, and browser screenshot artifacts. t3code
does not document the per-partition path, and the PR notes that profiles created by an earlier
unmerged scheme "are not migrated from the collision-prone partition mapping" (PR body).

### Removing a profile

Removal clears data first and keeps the row if that fails.
[`IntegrationsSettings.tsx` lines 879 to 909](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/web/src/components/settings/IntegrationsSettings.tsx#L879-L909)
calls `clearCookies` and `clearCache` for the profile in every known environment, then removes it
from settings and reassigns the default. The comment: "Drop the partition's data too, otherwise a
removed profile's cookies stay on disk with nothing in the UI pointing at them."

The clear itself is `clearStorageData({ storages: ["cookies", "localstorage", "indexdb",
"serviceworkers"] })` plus `clearCache()` in `BrowserSession.ts`. One detail matters for anyone
copying this. The main-process side loads the session before clearing
([`preview.ts` lines 257 to 268](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/desktop/src/ipc/methods/preview.ts#L257-L268)):
"Loading the session is what puts the partition in the map the clear walks. Deriving the partition
string alone leaves nothing to match, so clearing a profile with no tab open this run, after a
restart, or when deleting a profile, would report success and delete nothing."

## How the launcher starts a browser

It does not start one. There is no external Chromium launch anywhere in the profile feature.

A grep of `apps/desktop`, `apps/server`, `apps/web`, `packages`, and `docs` at `b44c1ce5` for
`user-data-dir`, `remote-debugging`, `chromium.launch`, `launchPersistentContext`,
`connectOverCDP`, `puppeteer`, and `profile-directory` finds one hit outside tests:
[`apps/desktop/scripts/dev-electron.mjs` line 108](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/desktop/scripts/dev-electron.mjs#L108),
which passes `--remote-debugging-port` to the Electron dev build of t3code itself. The server's
`process/externalLauncher.ts` opens URLs and editors with the OS default handler; the desktop's
`openExternal` IPC is `shell.openExternal(url)`. Neither takes a profile.

A profile is "launched" by attaching a `<webview>` to its partition. `getPreviewConfig`
([`preview.ts` lines 272 to 287](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/desktop/src/ipc/methods/preview.ts#L272-L287))
resolves the scope, calls `manager.getBrowserSession(...)` so that `session.fromPartition` runs
in main and installs the permission handlers ("a guest that attached to an untouched partition
would run with Electron's default UA and Chromium's default permission behaviour"), and returns
`{ partition, webPreferences, preloadUrl }` to the renderer.

The word "Playwright" in the tree is
[`apps/desktop/src/preview/PlaywrightInjectedRuntime.ts`](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/desktop/src/preview/PlaywrightInjectedRuntime.ts),
which "Extracts Playwright's installed Node bundle for browser injection": it pulls the injected
script out of `playwright-core` and evaluates it inside the guest for semantic snapshots. No
Playwright browser is launched and no Playwright context or profile is created.

The separate `agent-device` tool (`/home/matt/.t3/tools/agent-device/0.20.10`, the `agent-device`
package at 0.20.10) drives iOS simulators and Android emulators through a pinned command-line tool
([`docs/internals/devices.md`](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/docs/internals/devices.md)).
Its package description lists "web" among platforms, but t3code's Device panel and `device_*`
tools are not wired to the preview browser or its profiles, and that path was not read further.

## The integrated preview browser

The preview browser is an Electron `<webview>` per tab in the renderer, with all listeners,
automation, and session policy in the main process. The desktop `Manager.ts` header: "Hosts
per-tab Chromium WebContents references (the actual <webview> elements live in the renderer; we
only attach listeners and forward state here)."

The tag is rendered in
[`HostedBrowserWebview.tsx` lines 290 to 302](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/web/src/browser/HostedBrowserWebview.tsx#L290-L302)
with `allowpopups`, `partition={config.partition}`, `webpreferences={config.webPreferences}`, and
`preload`. The preferences string is one constant,
[`WebviewPreferences.ts`](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/desktop/src/preview/WebviewPreferences.ts):
`"contextIsolation=false,sandbox=true,nodeIntegration=false"`. Context isolation is off on
purpose so the element-picker preload can read the React devtools hook from the page; the file
argues that `sandbox=true` is what keeps that from handing Node to the page.

Attach is gated in
[`DesktopWindow.ts` lines 513 to 525](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/desktop/src/window/DesktopWindow.ts#L513-L525):
`will-attach-webview` calls `event.preventDefault()` unless `params.partition` is a string the
`BrowserSession` prefix check admits, then force-sets `sandbox = true`, `nodeIntegration = false`,
`nodeIntegrationInSubFrames = false`, and `contextIsolation = false` on the live object.

Per-session policy is set once, when `getSession` first creates the partition
(`BrowserSession.ts`): a permission request handler and a permission check handler that both
allow only `clipboard-read`, `clipboard-sanitized-write`, `notifications`, and `geolocation`.
`local-fonts` is denied with the reason that "silently granting it would hand every page the
user's installed-font fingerprint" (comment in the allowlist). The user agent is left untouched, with a note that Birdbrain's
#545 probe should read: "Rewriting it in any form, even variants that keep the Electron token,
makes Cloudflare Turnstile fail its integrity check with error 600010 and recreate the challenge
every few seconds, so logins behind it never complete (#5002)."

Popups are allowed for `http(s)` `new-window` dispositions so OAuth libraries work
([`Manager.ts` lines 525 to 548](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/desktop/src/preview/Manager.ts#L525-L548)):
The reason given is that denying them "makes `window.open()` return `null`", which OAuth libraries report as a blocked popup.
The popup gets its own hardened options (`contextIsolation: true, nodeIntegration: false,
sandbox: true`) because "a popup is not a webview attach, so the `will-attach-webview` hardening
never sees it" (comment on the popup options), and the popup's own `window.open` is denied so that, in the comment's words, "the chain stops at the first one" of them.

Automation attaches Electron's debugger to the guest, `wcDebugger.attach("1.3")`, and enables
`Runtime`, `Accessibility`, `Network`, and `Log`
([`Manager.ts` lines 1350 to 1356](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/desktop/src/preview/Manager.ts#L1350-L1356)).
Screenshots and recording frames come from `wc.capturePage()` with retry, because "Cold guests can
reject `capturePage` with `UnknownVizError` or never settle it." Agents reach all of this through the
`preview_*` MCP toolkit
([`apps/server/src/mcp/toolkits/preview/tools.ts`](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/server/src/mcp/toolkits/preview/tools.ts):
`status`, `open`, `navigate`, `resize`, `set_appearance`, `snapshot`, `click`, `type`, `press`,
`scroll`, `evaluate`, `wait_for`, and recording start and stop), brokered from the server to whichever connected desktop owns
the tab. `preview_open` takes an optional `profileId`; "Omit to open under the client's configured
default profile."

### Cookie import into a profile

Added alongside profiles and documented in
[`docs/user/browser-import.md`](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/docs/user/browser-import.md):
"The desktop app can import cookies from another browser so you can reuse its signed-in sessions
in the preview browser." It reads the source browser's own cookie store, never an exported file.

[`BrowserImport/Sources.ts`](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/desktop/src/preview/BrowserImport/Sources.ts)
pins a user-data directory and credential-store coordinates per fork: Chrome, Edge, Brave,
Vivaldi, Opera, Arc, Helium (Chromium), Safari, and Firefox. The Windows row is deliberate: "No
Chromium fork is importable on Windows: since Chrome 127 their cookies are encrypted to the
browser's own identity (App-Bound Encryption), so no other process can read them. macOS and Linux
keep working." Helium is the exception because it retains the older DPAPI store.

[`ChromiumKeys.ts`](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/desktop/src/preview/BrowserImport/ChromiumKeys.ts)
derives the Chromium `OSCrypt` key per platform: the login keychain on macOS ("Reading it prompts the user,
which is the consent this feature is built around"), `libsecret` `v11` records or the hardcoded
`peanuts` passphrase (`v10`) on Linux, and DPAPI for legacy Windows stores. Both engines' SQLite
files are copied with `VACUUM INTO` into a scoped temp directory before reading, because "Both
engines keep the file open with WAL while the browser runs, so reading in place can observe a
torn write"
([`CookieDatabase.ts` lines 87 to 100](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/desktop/src/preview/BrowserImport/CookieDatabase.ts#L87-L100)).
Firefox needs no key: the `FirefoxCookies.ts` header says the browser stores cookies in the clear in `cookies.sqlite`.

Writes go through `session.cookies.set` on the profile's partition
([`BrowserImport.ts`, `writeCookies`](https://github.com/pingdotgg/t3code/blob/b44c1ce5d25ee0d5a5be82e380618a886c19ea96/apps/desktop/src/preview/BrowserImport/BrowserImport.ts)),
with the URL built as `${secure ? "https" : "http"}://${host}${path}` and one caveat worth
copying: `domain` is "Omitted for host-only cookies: Electron reads any `domain` as a domain
cookie and re-adds the leading dot, widening its scope." Partitioned (CHIPS) cookies are skipped.
The IPC handler derives the target partition "from the same helper the webview config uses, so
cookies land in exactly the partition the profile's tabs attach to."

## What transfers to Birdbrain

The plan's decision 5 (Electron partition primary) has direct precedent. t3code faced the same
choice for the same reason, a desktop-local Chromium guest, and chose a partition per profile with
cookie import into it rather than an external browser. Specific pieces that carry over:

- **The profile shape.** `{ id, name, kind }` with built-ins synthesized, ids validated against
  the delimiter they get folded into, and a resolver that removes duplicates. Birdbrain's `personas` table in
  phase 1 already has the same fields plus audit columns; the one idea to take is validating the
  id against every place it gets concatenated (partition string, IPC cache key).
- **Partition naming as a namespace.** t3code's `profile-` marker keeps user partitions disjoint
  from everything else and lets a single prefix check admit them. Birdbrain's
  [`webviewPolicy.ts`](../../src/main/webviewPolicy.ts) is an exact-match registry
  (`POLICIES` at line 143, `WEBVIEW_PARTITIONS` at line 150) and refuses anything unknown. The
  plan's phase 3 line "a persona partition entry that denies every guest load" needs a prefix rule
  or a dynamic lookup for `persist:persona-<id>`, because the ids are not known at build time.
  t3code's answer is `isPartition(prefix)`; Birdbrain's stricter shape can keep exact matching for
  the three viewer partitions and add one prefix rule that maps to a deny-all policy.
- **Session setup once, at creation.** `getSession` memoizes `session.fromPartition` and installs
  both permission handlers there. The plan already notes that `setPermissionRequestHandler` on a
  shared session is set once; t3code shows the same for `setPermissionCheckHandler`, which
  Birdbrain's [`backgroundRenderer.ts`](../../src/main/services/backgroundRenderer.ts) does not
  set today (line 452 sets the request handler only). A persistent persona session should set
  both.
- **Load before clear.** The "deriving the partition string alone leaves nothing to match" note
  applies to phase 1's delete step: call `session.fromPartition('persist:persona-<id>')` and clear
  on that object, never on a cached map that may not hold it after a restart. The storage list
  (`cookies`, `localstorage`, `indexdb`, `serviceworkers`) plus `clearCache()` is a reasonable
  floor; Birdbrain should decide whether `cachestorage` and `filesystem` belong in it too.
- **Cookie write mapping.** The plan's rule that `url` is derived from `domain` plus `secure` is what t3code does.
  The host-only `domain` omission and the IPv6 bracket handling in `cookieScope` are both bugs the
  plan's parsers would otherwise hit.
- **The Firefox `cookies.sqlite` path.** The plan lists it as later, pending a file-lock copy.
  `VACUUM INTO` on a read-only connection is that copy, and it works with Birdbrain's existing
  `better-sqlite3`.
- **User agent.** Do not rewrite it. The Turnstile 600010 note is the closest thing to a #545
  probe result that exists in either repo. Birdbrain records `wc.getUserAgent()` and does not
  rewrite, so this is a constraint to keep, not a change.
- **Popups in the sign-in window.** Phase 3's "Sign in as persona" window uses a visible
  `BrowserWindow`. If it copies `renderPageInHiddenWindow`'s `setWindowOpenHandler(() => deny)`
  (line 453), Google-style OAuth popups fail. t3code's allow-with-hardened-options plus deny on the
  child is the shape to use.

## What does not transfer

- **The hardened external Chromium question is unanswered by t3code.** There is no
  `--user-data-dir` launcher, no CDP connection to a real browser, and no Playwright context. The
  pinned alternative in the plan gets no model, flag set, or state layout from this codebase.
- **Everything about environments.** The scope hashed into the partition is
  `[environmentId, profileId]` because one desktop can attach to many servers. Birdbrain has one
  install and one renderer; `persist:persona-<id>` is enough, and hashing buys nothing when the
  id is already opaque.
- **The runtime.** Effect services and layers, the contracts package, the server and desktop
  split, the MCP broker, and the client settings store are t3code's own. None of it is a library
  Birdbrain could import.
- **`contextIsolation=false` on the guest.** t3code relaxes it for its element picker and leans
  on `sandbox`. Birdbrain's `sanitizeWebviewPreferences` (`webviewPolicy.ts` lines 205 to 224)
  forces `contextIsolation = true` and deletes any preload; that stays.
- **Reading Chromium cookie databases directly.** The plan rules this out ("Chrome `Cookies`
  SQLite: no"). t3code shows it is feasible on macOS and Linux with a keychain or `libsecret`
  prompt, and only impossible on Windows for App-Bound forks. Whether Birdbrain wants that is a
  product call outside this note; the plan's table row is accurate for Windows and too broad for
  the other two platforms.
- **Profiles in a settings JSON file.** Birdbrain needs frozen labels on historic captures and
  soft delete, which is why the plan has a table. t3code's settings-file registry cannot do
  either.

## Open questions

- Electron does not document the exact on-disk directory for a `persist:` partition beyond
  `ses.storagePath`. Phase 1 should log that path once per persona so the threat-model page
  (#546) can name where the cookie store sits on each OS.
- t3code does not say whether Chromium's cookie store inside an Electron partition is
  OS-key encrypted the way Chrome's is. Decision 8 in the plan assumes it is ("protected by the
  same OS key `safeStorage.isEncryptionAvailable()` reports on"). That assumption needs its own
  check against Electron, not t3code.
- Whether to add Chromium cookie-database import on macOS and Linux, given t3code's working
  reader. The plan's supported-format table would change.
- `agent-device`'s "web" platform was not examined. If it launches a real browser, that is the
  only place in the t3code toolchain where a `--user-data-dir` style profile could exist.
