# Persona cookies at rest: assessment

On this build, on Linux, Persona partition cookie values are not encrypted at rest: Chromium
wrote both marker cookies as plain text in the `value` column of the partition's `Cookies`
database and left `encrypted_value` empty.

**Date:** 2026-10-11

**Status:** Complete. A measurement on one Linux machine, not a decision.

**Audience:** The maintainer, and whoever writes the browser cookie import ADR or turns on
cookie encryption (#88).

This check tests one claim, made in three places: that the operating system key `safeStorage`
reports on protects a Persona's cookies on disk. The three places are ADR-0030's "No secrets
beyond the browser session" paragraph, decision 8 of the
[persona cookie import plan](../plans/2026-09-19-persona-cookie-import.md), and the comment
above `partitionForPersona`. The issue is #1824, under map #541. Line citations are to
`2598173f`, the commit built, and record a reading at that commit; the files this change
corrects are cited as they stood before it.

## Result

| Marker cookie   | Set by                                     | `value`              | `encrypted_value` length | Files holding the marker |
| --------------- | ------------------------------------------ | -------------------- | ------------------------ | ------------------------ |
| `atrest_import` | Cookie file import                         | `ATREST-IMPORT-7f3c` | 0                        | `Cookies`                |
| `session`       | `Set-Cookie` from the local sign-in page   | `ATREST-LOGIN-9b1e`  | 0                        | `Cookies`                |

Both rows come from the read-only query in step 12 of the commands below. For each marker,
the value sits in `value` and `encrypted_value` is empty. Both cookies are persistent
(`is_persistent` 1, step 13), the kind Chromium keeps on disk across restarts.
`grep` found each marker in the partition's `Cookies` database and in no other file under the
partition folder, the `Cookies-journal` and the HTTP cache included (step 11).

## Runtime

| Item                                                  | Value                                                                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Commit built                                          | `2598173fd170604ca7ec0df571f1e08bade2a8b1` (`origin/main`), unpackaged, built with `pnpm build`                                         |
| `process.versions.electron`                           | `44.5.1`                                                                                                                               |
| `process.versions.chrome`                             | `152.0.7977.130`                                                                                                                       |
| Linux distribution and kernel                         | Ubuntu 24.04.4 LTS under WSL2, kernel `6.18.33.2-microsoft-standard-WSL2`                                                              |
| Node for the build and the driver                     | `v20.20.2`                                                                                                                             |
| Launch method                                         | The run-birdbrain driver (`.claude/skills/run-birdbrain/driver.mjs`), which starts the app through Playwright 1.63.0's `_electron.launch`, under `xvfb-run` in `tmux` |
| Switch the launch adds                                | `--password-store=basic` (playwright-core 1.63.0, `lib/server/electron/loader.js:70`); the running app reported the switch value as `basic` (step 10) |
| `safeStorage.isEncryptionAvailable()`                 | `false`                                                                                                                                |
| `safeStorage.getSelectedStorageBackend()`             | `basic_text`                                                                                                                           |
| `EnableCookieEncryption` fuse of the binary that ran  | `Disabled`, read from `node_modules/electron/dist/electron`, the binary `process.execPath` names (steps 10 and 14)                      |
| Cookie database found                                 | `/tmp/birdbrain-driver-EnEfBN/Partitions/persona-d1d94c27-d97d-4edb-930b-3b394f861e59/Cookies`, that is `<user-data>/Partitions/persona-<id>/Cookies` |

## What the password-store switch changes

Playwright's Electron loader appends `--password-store=basic` to every launch. In this run
`safeStorage` reported the `basic_text` backend and `isEncryptionAvailable()` false, so Settings
would show the #414 warning.

The switch does not account for the plain text. It chooses which key store supplies a key. The
database holds no encrypted value at all, and the fuse that turns cookie encryption on reads
`Disabled` in the binary that ran, so no key took part. The `cookieEncryption` section of
Electron's [fuses documentation](https://github.com/electron/electron/blob/main/docs/tutorial/fuses.md)
gives the default as Disabled and says: "By default, the SQLite database that Chromium uses to
store cookies stores the values in plaintext." This run did not measure a launch without the
switch on a desktop with a working key store.

## The build Birdbrain ships

This run used the unpackaged build. The `build` block in `package.json` (`:55`) sets no
`electronFuses` and no `afterPack` or `afterSign` hook. electron-builder's `doAddElectronFuses`
returns without changing any fuse when `electronFuses` is unset (app-builder-lib 26.15.3,
`out/platformPackager.js:259-262`). A packaged build therefore keeps the `Disabled` state that
step 14 reads from the Electron binary. This check did not run the `pnpm package:linux` output,
and did not run on macOS or Windows.

## The Settings warning

Settings shows this warning when `safeStorage` reports no key
(`src/renderer/components/settings/PersonasSection.tsx:85`). Before this change it read
(`:95-97`):

> The operating system credential store is unavailable on this machine, so imported cookies sit
> on disk unprotected, readable by anything that can read this user's files.

Its implication, that imported cookies are protected when the credential store is available,
does not hold. The values are plain text because the build leaves cookie encryption off, and
Electron documents that cookie values are plain text whenever that fuse is off. The
[stage-2 capture engine spec](2026-10-10-capture-engine-launched-browser-design.md) raised this
doubt at `:708-711`. This change replaces the text with:

> Imported cookies sit on disk unencrypted, readable by anything that can read this user's
> files. This build of Birdbrain does not encrypt its cookie store.

The condition that shows the warning (`:85`) and the acknowledgement checkbox (`:99-107`) are
unchanged. On a machine where `safeStorage` reports a key, Settings shows no warning, although
with the fuse off Electron's documentation says the cookie values are still plain text.

## Other text that repeats the claim

The brief for #1824 limits this change to the three sentences and the warning. Four other
places still describe the cookie store as one the operating system key may protect, and stay as
they are:

- The import button's title while the storage state loads, "Checking whether the cookie store is
  protected" (`PersonasSection.tsx:248`), which `tests/components/PersonasSection.test.tsx:236`
  asserts.
- The import button's title while import is blocked, "Acknowledge the unprotected cookie store
  above to import" (`PersonasSection.tsx:250`).
- The comment above `PersonaStorageState` (`src/shared/types.ts:314-316`).
- The comment above `personaStorageStateQueryOptions` (`src/renderer/lib/api/personas.ts:10-12`).

## Corrections in this change

Each corrected sentence says that the cookie values sit unencrypted in the partition's `Cookies`
database under the user-data folder, that Electron's `EnableCookieEncryption` fuse is off in the
build Birdbrain ships, and that turning it on is #88.

- ADR-0030's "No secrets beyond the browser session" paragraph, with a dated line in the
  header that links this assessment.
- Decision 8 of the persona cookie import plan.
- The comment above `partitionForPersona` in `src/main/services/persona/personaSessions.ts`
  (comment lines only).
- The Settings warning's text, and `tests/components/PersonasSection.test.tsx` for the new text.

## Commands and output

Commands ran from the repository root unless they change directory. Shell variables:
`S=.claude/skills/run-birdbrain/send.sh`, `BIRDBRAIN_TMUX=bb-1824`,
`UD=/tmp/birdbrain-driver-EnEfBN` (printed by `launch`) and
`PERSONA=d1d94c27-d97d-4edb-930b-3b394f861e59` (printed by step 7).

Two commands differ from the ones #1824 lists. The driver ran in a `tmux` session named
`bb-1824` rather than `bb`, which `send.sh` reads from `BIRDBRAIN_TMUX`, so the run could not
type into another driver session. The `sqlite3` shell is not installed on this machine, so steps
12 and 13 run the query through Python's `sqlite3` module with `python3 -I` on a read-only
connection to the copy.

`send.sh` exits with the status of the `tail` that prints the pane, so its exit code 0 shows that
the pane was read, not that the driver command succeeded. The driver prints `ERROR:` when a
command fails (`driver.mjs:285-289`); no step printed it.

`send.sh` prints the pane, which repeats the command; the records leave that repeat out. Long
outputs are cut to their last lines, with `...` marking the cut.

The markers, the sign-in page, and its account (`atrest-tester`, password `not-a-real-password`)
are invented for this check. No real site, account, or cookie took part.

### 1. Commit, Node, and platform

```console
$ git rev-parse HEAD
2598173fd170604ca7ec0df571f1e08bade2a8b1
exit 0
$ node --version
v20.20.2
exit 0
$ grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release
PRETTY_NAME="Ubuntu 24.04.4 LTS"
VERSION_ID="24.04"
exit 0
$ uname -sr
Linux 6.18.33.2-microsoft-standard-WSL2
exit 0
```

### 2. Install and build

```console
$ bash scripts/setup-worktree.sh
...
[setup-worktree] vale 3.17.1
[setup-worktree] ready
exit 0
$ pnpm build
> electron-vite build
...
✓ built in 4.81s
exit 0
```

### 3. Write the cookie file

The file goes to a scratch folder outside the repository. The expiry, `1798761600`, is
2027-01-01 00:00:00 UTC.

```console
$ mkdir -p /tmp/ce-ar /tmp/ce-ar-server && printf '# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t1798761600\tatrest_import\tATREST-IMPORT-7f3c\n' > /tmp/ce-ar/cookies.txt && cat -A /tmp/ce-ar/cookies.txt
# Netscape HTTP Cookie File$
127.0.0.1^IFALSE^I/^IFALSE^I1798761600^Iatrest_import^IATREST-IMPORT-7f3c$
exit 0
```

### 4. Start the local sign-in page

`/tmp/ce-ar-server/server.py`, outside the repository, serves a sign-in form on
`127.0.0.1:18431` and answers its POST with the session cookie:

```python
# Local sign-in page for the Persona cookies-at-rest check. Invented account, loopback only.
from http.server import BaseHTTPRequestHandler, HTTPServer

FORM = b"""<!doctype html><html><body><h1>At-rest test sign-in</h1>
<form id="signin" method="post" action="/login">
<input name="username" value="atrest-tester"><input name="password" type="password" value="not-a-real-password">
<button type="submit">Sign in</button></form></body></html>"""
DONE = b"<!doctype html><html><body><h1>Signed in</h1></body></html>"


class Handler(BaseHTTPRequestHandler):
    def _send(self, body, cookie=None):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send(FORM)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        print("POST", self.path, self.rfile.read(length).decode(), flush=True)
        self._send(DONE, "session=ATREST-LOGIN-9b1e; Path=/; Max-Age=86400; HttpOnly")


HTTPServer(("127.0.0.1", 18431), Handler).serve_forever()
```

```console
$ tmux new-session -d -s ce-ar-http -c /tmp/ce-ar-server 'python3 -I /tmp/ce-ar-server/server.py 2>&1 | tee /tmp/ce-ar-server/http.log'
exit 0
$ for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18431/ && break; done
200
exit 0
```

### 5. Start the driver and launch

```console
$ tmux new-session -d -s bb-1824 -x 200 -y 50 -c /tmp/birdbrain-wt/brief-1824
exit 0
$ tmux send-keys -t bb-1824 'xvfb-run -a node .claude/skills/run-birdbrain/driver.mjs' Enter
exit 0
$ $S launch 60 30 10
...
birdbrain driver - "help" for commands, "launch" to start
driver> launch
exit 0
$ timeout 90 bash -c 'until tmux capture-pane -t bb-1824 -p | grep -v "^$" | tail -1 | grep -qx "driver>"; do sleep 1; done'
exit 0
$ tmux capture-pane -t bb-1824 -p | grep -v '^$' | tail -3
launched in 834ms. userData: /tmp/birdbrain-driver-EnEfBN
url: file:///tmp/birdbrain-wt/brief-1824/out/renderer/index.html
driver>
exit 0
```

`send.sh` returned before `launch` finished: its loop stops when the pane's current command is
not `xvfb-run`, `sh` or `node`, and the pane still ran the shell when it first looked. The
`until` loop waits for the `driver>` prompt instead.

### 6. Record the runtime

```console
$ $S 'eval-main return { versions: process.versions, backend: electron.safeStorage.getSelectedStorageBackend(), available: electron.safeStorage.isEncryptionAvailable(), sessionData: electron.app.getPath("sessionData") }' 30 60
{
  "versions": {
    "node": "24.21.0",
    "acorn": "8.18.0",
    "ada": "4.0.0",
    "amaro": "1.1.11",
    "ares": "1.34.8",
    "brotli": "1.2.0",
    "cldr": "48.0",
    "icu": "78.2",
    "llhttp": "9.4.3",
    "merve": "1.2.2",
    "modules": "149",
    "napi": "10",
    "nbytes": "0.1.4",
    "ncrypto": "0.0.1",
    "nghttp2": "1.70.0",
    "nghttp3": "",
    "ngtcp2": "",
    "openssl": "0.0.0",
    "simdjson": "4.6.7",
    "simdutf": "7.7.0",
    "sqlite": "3.53.4",
    "tz": "2025c",
    "undici": "7.29.1",
    "unicode": "17.0",
    "uv": "1.52.1",
    "uvwasi": "0.0.23",
    "v8": "15.2.124.28-electron.0",
    "zlib": "1.3.2.1-motley",
    "zstd": "1.6.0",
    "electron": "44.5.1",
    "chrome": "152.0.7977.130"
  },
  "backend": "basic_text",
  "available": false,
  "sessionData": "/tmp/birdbrain-driver-EnEfBN"
}
driver>
exit 0
```

`sessionData` equals the user-data folder in this run, so the partition folder is
`$UD/Partitions/persona-<id>` (`personaSessions.ts:121-123`).

### 7. Create a Persona

```console
$ $S "eval window.birdbrain.persona.create({ label: 'At-rest check' })" 30 14
{
  "id": "d1d94c27-d97d-4edb-930b-3b394f861e59",
  "label": "At-rest check",
  "notes": "",
  "createdAt": "2026-10-11T19:29:32.870Z",
  "lastImportAt": null,
  "lastImportCount": null
}
driver>
exit 0
```

### 8. Import the cookie file

The stub replaces the native file dialog, as `e2e/case-archive.spec.ts:67-71` does.

```console
$ $S "eval-main electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['/tmp/ce-ar/cookies.txt'] }); return true" 30 4
true
driver>
exit 0
$ $S "eval window.birdbrain.persona.import('$PERSONA')" 30 10
{
  "accepted": 1,
  "rejected": [],
  "importedAt": "2026-10-11T19:29:37.269Z"
}
driver>
exit 0
```

### 9. Sign in through the partition

```console
$ $S 'eval-main const p = "persist:persona-d1d94c27-d97d-4edb-930b-3b394f861e59"; const w = new electron.BrowserWindow({ show: false, webPreferences: { partition: p } }); await w.loadURL("http://127.0.0.1:18431/"); const next = new Promise((r) => w.webContents.once("did-finish-load", r)); await w.webContents.executeJavaScript(`document.getElementById("signin").submit()`); await next; const ses = electron.session.fromPartition(p); await ses.cookies.flushStore(); const names = (await ses.cookies.get({})).map((c) => c.name); const url = w.webContents.getURL(); w.destroy(); return { url, names }' 30 12
{
  "url": "http://127.0.0.1:18431/login",
  "names": [
    "atrest_import",
    "session"
  ]
}
driver>
exit 0
$ cat /tmp/ce-ar-server/http.log
127.0.0.1 - - [11/Oct/2026 12:26:52] "GET / HTTP/1.1" 200 -
127.0.0.1 - - [11/Oct/2026 12:29:45] "GET / HTTP/1.1" 200 -
POST /login username=atrest-tester&password=not-a-real-password
127.0.0.1 - - [11/Oct/2026 12:29:45] "POST /login HTTP/1.1" 200 -
exit 0
```

The first `GET` in the log is the `curl` probe from step 4.

### 10. Record the binary and the switch

```console
$ $S 'eval-main return { execPath: process.execPath, passwordStore: electron.app.commandLine.getSwitchValue("password-store"), argv: process.argv }' 30 20
{
  "execPath": "/tmp/birdbrain-wt/brief-1824/node_modules/.pnpm/electron@44.5.1/node_modules/electron/dist/electron",
  "passwordStore": "basic",
  "argv": [
    "/tmp/birdbrain-wt/brief-1824/node_modules/.pnpm/electron@44.5.1/node_modules/electron/dist/electron",
    ".",
    "--user-data-dir=/tmp/birdbrain-driver-EnEfBN",
    "--ozone-platform=x11"
  ]
}
driver>
exit 0
$ readlink -f node_modules/electron/dist/electron
/tmp/birdbrain-wt/brief-1824/node_modules/.pnpm/electron@44.5.1/node_modules/electron/dist/electron
exit 0
```

`argv` does not list `--password-store=basic` because Playwright's loader appends it to
Chromium's command line inside the process (`loader.js:92-95`); `getSwitchValue` reads it there.

### 11. Find the database, search for the markers, copy the folder

```console
$ find "$UD/Partitions/persona-$PERSONA" -type f -name Cookies
/tmp/birdbrain-driver-EnEfBN/Partitions/persona-d1d94c27-d97d-4edb-930b-3b394f861e59/Cookies
exit 0
$ grep -a -r -l -e ATREST-IMPORT-7f3c -e ATREST-LOGIN-9b1e "$UD/Partitions/persona-$PERSONA"
/tmp/birdbrain-driver-EnEfBN/Partitions/persona-d1d94c27-d97d-4edb-930b-3b394f861e59/Cookies
exit 0
$ grep -a -r -l -e ATREST-IMPORT-7f3c "$UD/Partitions/persona-$PERSONA"
/tmp/birdbrain-driver-EnEfBN/Partitions/persona-d1d94c27-d97d-4edb-930b-3b394f861e59/Cookies
exit 0
$ grep -a -r -l -e ATREST-LOGIN-9b1e "$UD/Partitions/persona-$PERSONA"
/tmp/birdbrain-driver-EnEfBN/Partitions/persona-d1d94c27-d97d-4edb-930b-3b394f861e59/Cookies
exit 0
$ rm -rf /tmp/ce-ar-copy && mkdir -p /tmp/ce-ar-copy && cp -a "$UD/Partitions/persona-$PERSONA" /tmp/ce-ar-copy/
exit 0
```

The copy keeps the database after `quit` deletes `$UD` (`driver.mjs:257-259`).

### 12. Read the copy

```console
$ python3 -I -c '
import sqlite3, sys
con = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)
q = "SELECT host_key, name, value, length(encrypted_value) AS enc_len, hex(substr(encrypted_value, 1, 3)) AS enc_prefix FROM cookies ORDER BY host_key, name;"
cur = con.execute(q)
print("|".join(d[0] for d in cur.description))
for row in cur:
    print("|".join(str(c) for c in row))
print("sqlite", sqlite3.sqlite_version)
' /tmp/ce-ar-copy/persona-d1d94c27-d97d-4edb-930b-3b394f861e59/Cookies
host_key|name|value|enc_len|enc_prefix
127.0.0.1|atrest_import|ATREST-IMPORT-7f3c|0|
127.0.0.1|session|ATREST-LOGIN-9b1e|0|
sqlite 3.53.1
exit 0
```

### 13. Confirm the cookies are persistent

```console
$ python3 -I -c '
import sqlite3, sys
con = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)
cur = con.execute("SELECT host_key, name, is_persistent, is_httponly, expires_utc FROM cookies ORDER BY host_key, name;")
print("|".join(d[0] for d in cur.description))
for row in cur: print("|".join(str(c) for c in row))
for row in con.execute("SELECT key, value FROM meta ORDER BY key;"): print("meta", *row)
' /tmp/ce-ar-copy/persona-d1d94c27-d97d-4edb-930b-3b394f861e59/Cookies
host_key|name|is_persistent|is_httponly|expires_utc
127.0.0.1|atrest_import|1|0|13443235200000000
127.0.0.1|session|1|1|13436306985476896
meta last_compatible_version 24
meta mmap_status -1
meta version 24
exit 0
```

### 14. Read the fuse from the binary that ran

```console
$ bash -c 'node "$(ls -d node_modules/.pnpm/@electron+fuses@*/node_modules/@electron/fuses | head -1)/dist/bin.js" read --app node_modules/electron/dist/electron'
Analyzing app: electron
Fuse Version: v1
  RunAsNode is Enabled
  EnableCookieEncryption is Disabled
  EnableNodeOptionsEnvironmentVariable is Enabled
  EnableNodeCliInspectArguments is Enabled
  EnableEmbeddedAsarIntegrityValidation is Disabled
  OnlyLoadAppFromAsar is Disabled
  LoadBrowserProcessSpecificV8Snapshot is Disabled
  GrantFileProtocolExtraPrivileges is Enabled
  undefined is Enabled
exit 0
```

The `undefined` line is the ninth fuse, which `@electron/fuses` 1.8.0 has no name for.

### 15. Quit

```console
$ $S quit 30 4
...
driver> quit
quit
exit 0
$ ls -d /tmp/birdbrain-driver-EnEfBN
ls: cannot access '/tmp/birdbrain-driver-EnEfBN': No such file or directory
exit 2
```

The `ls` shows that `quit` deleted the user-data folder, as `driver.mjs:257-259` says.
