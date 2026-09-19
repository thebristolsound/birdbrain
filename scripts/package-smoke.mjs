#!/usr/bin/env node
// Launch smoke for the artifact electron-builder just wrote under dist/.
//
// The pre-ship gate (docs/plans/2026-08-15-pre-ship-validation-gate.md, section 3)
// opens with "install -> launch" on the CI-built installer, and until now that step
// was human-run only. This script does that step by machine on the exact artifact:
// on Windows it silent-installs the NSIS .exe and launches the installed program; on
// Linux it runs the AppImage. Either way the app gets a throwaway userData directory,
// and the pass condition is the capture server answering on its port, which sits
// after the database open and migration, the signing key, and the server token in
// src/main/index.ts, so a 200 proves the packaged main process got through startup.
//
// It launches twice against the same userData directory, and the second launch is
// the point (#653): the folder the app advertises has to be at the same path after
// a quit, so <userData>/extension/manifest.json and the extension-version stamp
// have to be there after both. It does not distinguish a copy that was left alone
// from one the second launch rewrote; either way the path holds a loadable folder,
// which is what the advertised path has to do.
//
// On Linux the second launch also runs the app from a DIFFERENT directory, which is
// the condition #653 is actually about. --appimage-extract-and-run does not mount:
// AppImageKit v12's runtime (src/runtime.c:580-695, and the same literals are in the
// runtime electron-builder ships) extracts to $TMPDIR/appimage_extracted_<md5 of the
// AppImage's own bytes>. The digest is content-derived, so renaming or copying the
// artifact changes nothing — TMPDIR is the half that can differ. Each launch gets
// its own, the first one is deleted before the second starts, and the script asserts
// each launch really did extract under its own TMPDIR, so process.resourcesPath
// differed and the first launch's copy of it no longer exists. That is the mount
// churn, without FUSE. Windows has no mount and is launched twice unchanged.
//
// What it still does not prove: that Chrome's loaded extension keeps working, which
// no headless probe can show and which stays a human gate step.
//
// It proves launch, nothing more beyond that: the rest of section 3 (capture, view,
// export) stays with the human checklist and the Playwright suite.
//
// Two facts about the environment this leans on, both mirrored from
// e2e/fixtures/electronApp.ts: BIRDBRAIN_USER_DATA relocates the app's data
// directory, and a seeded plaintext signing key keeps initSigningKey on its
// existing-key branch, so the #414 acknowledgement modal (which fires whenever
// safeStorage is unavailable, as it is on a headless runner) never opens.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateKeyPairSync } from 'node:crypto'

// CAPTURE_SERVER_PORT in src/shared/constants.ts; this script cannot import TypeScript.
const PORT = 19845
const STATUS_URL = `http://127.0.0.1:${PORT}/api/status`
const BUDGET_MS = 90_000
const POLL_MS = 500

const root = process.cwd()
const { version, build } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
const productName = build.productName
const dist = join(root, build.directories?.output ?? 'dist')

// The throwaway directories: the userData profile and, on Linux, one TMPDIR per
// launch. process.exit() skips finally blocks, so fail() clears them, not main.
const scratch = []

function scratchDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(dir)
  return dir
}

function clearScratch() {
  while (scratch.length) rmSync(scratch.pop(), { recursive: true, force: true })
}

function fail(message) {
  clearScratch()
  console.error(`package-smoke: ${message}`)
  process.exit(1)
}

function findArtifact(pattern) {
  if (!existsSync(dist)) fail(`no ${dist}; run pnpm package:<os> first`)
  const names = readdirSync(dist)
  const hit = names.find((n) => pattern.test(n))
  if (!hit) fail(`no artifact matching ${pattern} in dist/ (found: ${names.join(', ') || 'nothing'})`)
  return join(dist, hit)
}

async function statusAnswers() {
  try {
    const res = await fetch(STATUS_URL)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function seedUserData() {
  const dir = scratchDir('birdbrain-smoke-')
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ operatorName: 'Package smoke' }))
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  writeFileSync(join(dir, 'signing-key.pem'), privateKey, 'utf-8')
  writeFileSync(join(dir, 'signing-public-key.pem'), publicKey, 'utf-8')
  return dir
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Returns { command, args } for the launch, having installed or unpacked as needed.
function prepareLaunch() {
  const v = escapeRegExp(version)
  if (process.platform === 'win32') {
    const installer = findArtifact(new RegExp(`^${escapeRegExp(productName)}-Setup-${v}\\.exe$`))
    console.log(`package-smoke: silent install ${installer}`)
    const install = spawnSync(installer, ['/S'], { stdio: 'inherit' })
    if (install.status !== 0) fail(`installer exited ${install.status}`)
    // A one-click NSIS build launches the app when it finishes, silent or not
    // (runAfterFinish defaults to true). That instance would own the port and
    // the real userData directory, so end it before launching the probe.
    spawnSync('taskkill', ['/IM', `${productName}.exe`, '/F', '/T'], { stdio: 'ignore' })
    const exe = join(process.env.LOCALAPPDATA ?? '', 'Programs', productName, `${productName}.exe`)
    if (!existsSync(exe)) fail(`installed executable not found at ${exe}`)
    return { command: exe, args: [] }
  }
  if (process.platform === 'linux') {
    const appImage = findArtifact(new RegExp(`^${escapeRegExp(productName)}-${v}\\.AppImage$`))
    spawnSync('chmod', ['+x', appImage])
    // --appimage-extract-and-run: no FUSE on a runner. The extracted chrome-sandbox
    // loses its setuid bit, so Chromium's SUID sandbox cannot start; --no-sandbox
    // is the documented answer and costs this probe nothing, since it asserts the
    // main process boots, not the renderer's sandbox posture.
    return { command: appImage, args: ['--appimage-extract-and-run', '--no-sandbox'] }
  }
  fail(`unsupported platform ${process.platform}; release.yml packages win32 and linux`)
}

// The AppImage runtime is the process we spawned; the Electron binary it extracts
// and runs is its child, and a signal to the runtime alone leaves that child (and
// the stdout pipe it holds) alive, so this script would never exit. Signal the
// process group on Linux and the process tree on Windows.
async function stop(child) {
  const signalGroup = (sig) => {
    try {
      process.kill(-child.pid, sig)
    } catch {
      // Already gone.
    }
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/F', '/T'], { stdio: 'ignore' })
  } else {
    signalGroup('SIGTERM')
  }
  await new Promise((r) => setTimeout(r, 3000))
  if (process.platform !== 'win32') signalGroup('SIGKILL')
}

// One launch against `userData`, stopped once the server answers or the budget runs
// out. Everything the pass condition needs is read before the app is stopped —
// including the extraction directory, which the AppImage runtime removes on exit.
async function launchOnce(command, args, userData, label, appTmp) {
  const output = []
  const started = Date.now()
  console.log(`package-smoke: ${label} launch ${command} ${args.join(' ')}`)
  const child = spawn(command, [...args, `--user-data-dir=${userData}`], {
    env: { ...process.env, BIRDBRAIN_USER_DATA: userData, ...(appTmp ? { TMPDIR: appTmp } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group, so stop() can signal the whole tree (see there).
    detached: process.platform !== 'win32'
  })
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => output.push(chunk.toString()))
  }
  let exited = null
  child.on('exit', (code, signal) => {
    exited = { code, signal }
  })

  let status = null
  while (Date.now() - started < BUDGET_MS) {
    if (exited) break
    status = await statusAnswers()
    if (status) break
    await new Promise((r) => setTimeout(r, POLL_MS))
  }

  const elapsed = Date.now() - started
  const dbExists = existsSync(join(userData, 'birdbrain.db'))
  const extensionCopied = existsSync(join(userData, 'extension', 'manifest.json'))
  const stampExists = existsSync(join(userData, 'extension-version'))
  const extractedIn = appTmp
    ? readdirSync(appTmp)
        .filter((n) => n.startsWith('appimage_extracted_'))
        .map((n) => join(appTmp, n))
    : []
  await stop(child)
  return { label, status, output, exited, elapsed, dbExists, extensionCopied, stampExists, extractedIn }
}

function assertLaunchPassed(run, userData) {
  const { label, status, output, exited, elapsed, dbExists, extensionCopied, stampExists } = run
  if (status && dbExists && extensionCopied && stampExists) return
  console.error(`--- app output (${label} launch, tail) ---`)
  console.error(output.join('').split('\n').slice(-40).join('\n'))
  if (exited) {
    fail(`${label} launch: app exited early (code ${exited.code}, signal ${exited.signal}) after ${elapsed}ms`)
  }
  if (!status) fail(`${label} launch: no answer from ${STATUS_URL} within ${BUDGET_MS}ms`)
  if (!dbExists) {
    fail(`${label} launch: server answered but ${join(userData, 'birdbrain.db')} was never created`)
  }
  if (!extensionCopied) {
    fail(
      `${label} launch: server answered but ${join(userData, 'extension', 'manifest.json')} does not exist — the bundled extension was not copied under user data (#653)`
    )
  }
  fail(
    `${label} launch: server answered but ${join(userData, 'extension-version')} does not exist — the copy was never stamped with the app version (#653)`
  )
}

// The premise of the two-launch check on Linux: each launch extracted the AppImage
// under its own TMPDIR, so the app ran from a different resources path each time and
// the first one was deleted before the second started. Asserted rather than assumed,
// because it is what the gate document claims this leg establishes.
function assertRanFromDifferentDirectories(first, second) {
  if (process.platform !== 'linux') return
  for (const run of [first, second]) {
    if (run.extractedIn.length === 0) {
      fail(
        `${run.label} launch: no appimage_extracted_* directory under its own TMPDIR, so this leg does not show the app running from a changed path (#653)`
      )
    }
  }
  const [firstDir] = first.extractedIn
  const [secondDir] = second.extractedIn
  if (firstDir === secondDir) fail(`both launches ran from ${firstDir}; the paths did not change`)
  if (existsSync(firstDir)) fail(`${firstDir} still exists; the first launch's directory was not removed`)
  console.log(`package-smoke: ran from ${firstDir}, then ${secondDir}`)
}

// The port the first launch held is released by the OS asynchronously, and a
// second launch that bound nothing would otherwise be "proved" by the first
// instance's own answer.
async function waitForPortFree() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (!(await statusAnswers())) return
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  fail(`${STATUS_URL} still answers after the first launch was stopped`)
}

async function main() {
  if (await statusAnswers()) {
    fail(`something already answers on ${STATUS_URL}; the probe would prove nothing`)
  }

  const { command, args } = prepareLaunch()
  const userData = seedUserData()
  // Linux only: TMPDIR is where --appimage-extract-and-run puts the app, so a
  // fresh one per launch is a fresh resources path (see the header).
  const appTmp = process.platform === 'linux' ? scratchDir('birdbrain-smoke-tmp-') : null
  const first = await launchOnce(command, args, userData, 'first', appTmp)
  assertLaunchPassed(first, userData)
  await waitForPortFree()
  if (appTmp) rmSync(appTmp, { recursive: true, force: true })
  // Same user data, a directory the first launch never ran from: the relaunch
  // the gate's section 3 checks by hand.
  const secondTmp = process.platform === 'linux' ? scratchDir('birdbrain-smoke-tmp-') : null
  const second = await launchOnce(command, args, userData, 'second', secondTmp)
  assertLaunchPassed(second, userData)
  assertRanFromDifferentDirectories(first, second)
  console.log(
    `package-smoke: pass in ${first.elapsed}ms + ${second.elapsed}ms; status keys: ${Object.keys(second.status).sort().join(', ')}; database created; extension folder and version stamp present after both launches`
  )
  clearScratch()
  // Explicit: a pipe left open by a grandchild that survived stop() must not turn
  // a pass into a hung job.
  process.exit(0)
}

main().catch((err) => fail(err instanceof Error ? err.stack ?? err.message : String(err)))
