---
name: run-birdbrain
description: Build, run, and drive the Birdbrain Electron desktop app headless. Use when asked to start or launch the app, take a screenshot of it, click through its UI, seed a case or capture, check a renderer or main-process change in the running app, or run its unit tests.
---

Birdbrain is an Electron app. An agent drives it through the Playwright REPL at
`.claude/skills/run-birdbrain/driver.mjs`, run under `xvfb-run` inside `tmux`, with
`.claude/skills/run-birdbrain/send.sh` sending one command at a time. Paths are relative to the
repository root.

## Prerequisites

Node 20 (`.mise.toml` pins it; `node --version` should print `v20.x`) and `Xvfb`. On Arch:

```bash
sudo pacman -S --needed xorg-server-xvfb
```

That package ships `xvfb-run`. CI's Ubuntu runner already has `Xvfb` (`.github/workflows/ci.yml`).
Electron's own headless mode is not an alternative; see Gotchas.

## Build

```bash
pnpm build   # electron-vite -> out/, about 6 seconds
```

The driver runs `out/`, not the source. Rebuild after every source change. A new worktree
without `node_modules` needs `scripts/setup-worktree.sh` first (see `CLAUDE.md`).

## Run (agent path)

```bash
tmux new-session -d -s bb -x 200 -y 50
tmux send-keys -t bb 'xvfb-run -a node .claude/skills/run-birdbrain/driver.mjs' Enter
S=.claude/skills/run-birdbrain/send.sh
$S launch 60
$S 'size 1440 900'
$S 'new-case Smoke case'
$S 'capture first-page'
$S 'case-view captures'
$S 'click-text Capture first-page'
$S 'ss capture-detail'
$S quit
```

`send.sh <command> [timeout-seconds] [lines]` types the command into the `bb` session (override
with `BIRDBRAIN_TMUX`), waits for the `driver>` prompt, and prints the last lines of the pane.
Open screenshots with the Read tool; they land in `/tmp/birdbrain-shots/` (override with
`SCREENSHOT_DIR`). Launch takes under a second after the build.

Every `launch` gets a new temporary user-data folder with an operator name and a signing key
already in place, so the app opens straight to the dashboard. `quit` deletes that folder.

| command | what it does |
|---|---|
| `launch` | Start the app and wait for `[data-testid="app-ready"]`. Prints the user-data path. |
| `launch fresh` | Start as a first install: no `settings.json`, so the app seeds the demo case and opens the onboarding tour (`click-text skip tour` closes it). |
| `size [w h]` | Resize the window (default 1440 900). The default window is 900x571. |
| `ss [name]` | Screenshot to `/tmp/birdbrain-shots/<name>.png`. Includes `<webview>` content. |
| `new-case [name]` | Create a case through the New Case form and remember its id. |
| `capture [slug]` | Post a manual capture with a small valid MHTML to the capture server (`127.0.0.1:19845`) for the case from `new-case`, the same route the extension uses. Prints the server's JSON. |
| `case-view <tab>` | Go to `/cases/<id>/<tab>`: `overview`, `captures`, and so on. |
| `goto <route>` | Set the hash route, for example `goto /cases/new`. |
| `click <css>` / `click-text <text>` / `click-role <role> <name>` | Playwright clicks, 10 second timeout. |
| `fill <css> <text>` / `type <text>` / `press <key>` | Keyboard input. |
| `wait <css>` / `text [css]` / `testids` | Wait for an element, print `innerText`, list every `data-testid` on screen. |
| `eval <js>` | Evaluate in the renderer and print JSON. |
| `eval-main <body>` | Run an async function body in the main process with `electron` in scope, for example `eval-main return electron.app.getVersion()`. |
| `windows` | List the app's windows. |
| `quit` | Close the app, delete the user-data folder, exit the driver. |

Set `DRIVER_STDERR=1` before `xvfb-run` to echo Electron's `stderr` into the pane.

## Run (human path)

`pnpm dev` starts `electron-vite` with hot reload and opens a window on the desktop. It is no use
headless; this skill does not cover it.

## Test

```bash
pnpm test tests/main/services/csvEscape.test.ts   # one file; no `--`
env -u ELECTRON_RUN_AS_NODE -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 \
  xvfb-run --auto-servernum npx playwright test e2e/cases.spec.ts   # after pnpm build
```

The e2e fixture (`e2e/fixtures/electronApp.ts`) passes no ozone flag, so on a Wayland desktop
the `env` prefix is what keeps its windows on `Xvfb`; CI needs no prefix. Most main-process
changes are covered faster by a unit test than by the driver. The full verify block is
`pnpm preflight`; see `docs/agents/testing.md`.

## Gotchas

- **An Electron-hosted agent shell sets `ELECTRON_RUN_AS_NODE=1`.** Electron then runs
  `out/main/index.js` as plain Node and dies with `Cannot read properties of undefined (reading
  'isPackaged')`. The driver deletes the variable for the child. Unset it yourself before
  running `node_modules/electron/dist/electron` by hand. `pnpm test` sets it on purpose.
- **On a Wayland desktop, `xvfb-run` alone still opens the window on the live session.**
  `XDG_SESSION_TYPE=wayland` sends Electron to Wayland even with `WAYLAND_DISPLAY` unset. The
  driver passes `--ozone-platform=x11`; `eval-main return electron.screen.getPrimaryDisplay().size`
  should print the `Xvfb` size (640x480 with Arch's `xvfb-run` default), not your monitor's.
- **`--ozone-platform=headless` crashes Electron 44** with SIGSEGV or SIGTRAP within a second,
  even for a minimal app, with or without `--disable-gpu` or SwiftShader flags. The core dump shows
  a call to address `0x0` inside the `electron` binary. Use `Xvfb`.
- **The signing key must exist before launch, even with `launch fresh`.** Playwright's loader
  forces `--password-store=basic`, so the key path raises a native acknowledgement dialog that
  Playwright cannot see, and `firstWindow()` waits until the launch times out. The driver writes a
  plaintext key pair, as `e2e/fixtures/electronApp.ts` does.
- **A bare-HTML capture renders blank in the Page tab.** `e2e/fixtures/seed.ts` posts
  `<html><body>...</body></html>` as the MHTML part; Chromium cannot parse it as MHTML. The
  driver's `capture` posts a minimal MHTML document, which renders.
- **Port 19845 is fixed, and a taken port stops the app from starting.** Main shows a native
  "could not start its capture server" error box, invisible under `Xvfb`, and exits before any
  window opens, so Playwright reports only a `firstWindow` timeout. `launch` checks the port
  first and refuses with `127.0.0.1:19845 is taken`. Close the installed Birdbrain or another
  driver session, then launch again.
- **Any native dialog stalls the driver.** `dialog.showErrorBox` and the key acknowledgement
  render on `Xvfb` where Playwright cannot reach them. A launch that times out in `firstWindow`
  usually means one fired; rerun with `DRIVER_STDERR=1` to read the main-process log.
- **`capture` needs an operator name.** After `launch fresh` there is none, so the server refuses
  captures until you set one in Settings.

## Troubleshooting

- **`out/main/index.js missing - run pnpm build`**: the worktree has never been built. Run
  `pnpm build`.
- **`send.sh` waits for the full timeout on every command**: the driver is not running in that
  pane; `tmux capture-pane -t bb -p` shows a shell prompt. Start the driver again.
- **`ERROR: locator.click: Timeout 10000ms exceeded.`**: the element is not on screen. Run
  `testids` or `ss` to see where the app is.
- **`send.sh` output shows shell errors such as `command not found: launch`**: an earlier
  `quit` had not returned when the next line was sent, so the shell got it. Each `send.sh` call
  waits for the previous one; do not type into the pane between calls.
