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
// It proves launch, nothing more: the rest of section 3 (capture, view, export,
// relaunch) stays with the human checklist and the Playwright suite.
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

function fail(message) {
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
  const dir = mkdtempSync(join(tmpdir(), 'birdbrain-smoke-'))
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

async function main() {
  if (await statusAnswers()) {
    fail(`something already answers on ${STATUS_URL}; the probe would prove nothing`)
  }

  const { command, args } = prepareLaunch()
  const userData = seedUserData()
  const output = []
  const started = Date.now()
  console.log(`package-smoke: launch ${command} ${args.join(' ')}`)
  const child = spawn(command, [...args, `--user-data-dir=${userData}`], {
    env: { ...process.env, BIRDBRAIN_USER_DATA: userData },
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
  const dbPath = join(userData, 'birdbrain.db')
  const dbExists = existsSync(dbPath)
  await stop(child)
  rmSync(userData, { recursive: true, force: true })

  if (!status || !dbExists) {
    console.error('--- app output (tail) ---')
    console.error(output.join('').split('\n').slice(-40).join('\n'))
    if (exited) fail(`app exited early (code ${exited.code}, signal ${exited.signal}) after ${elapsed}ms`)
    if (!status) fail(`no answer from ${STATUS_URL} within ${BUDGET_MS}ms`)
    fail(`server answered but ${dbPath} was never created`)
  }
  console.log(
    `package-smoke: pass in ${elapsed}ms; status keys: ${Object.keys(status).sort().join(', ')}; database created`
  )
  // Explicit: a pipe left open by a grandchild that survived stop() must not turn
  // a pass into a hung job.
  process.exit(0)
}

main().catch((err) => fail(err instanceof Error ? err.stack ?? err.message : String(err)))
