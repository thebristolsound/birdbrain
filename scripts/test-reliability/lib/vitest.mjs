// Runs Vitest the way `pnpm test` does (under Electron with ELECTRON_RUN_AS_NODE=1, so native
// modules load against Electron's ABI) and reads its JSON report back.

import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'

const OUTPUT_TAIL = 4000

// Required from Node, the electron package exports the path of its binary.
export const electronBinary = () => createRequire(import.meta.url)('electron')

export const vitestArgs = ({ mode, files, outputFile, bail }) => [
  './node_modules/vitest/vitest.mjs',
  mode,
  ...files,
  ...(mode === 'related' ? ['--run'] : []),
  '--reporter=json',
  `--outputFile=${outputFile}`,
  '--includeTaskLocation',
  '--coverage.enabled=false',
  '--passWithNoTests',
  ...(bail ? ['--bail=1'] : [])
]

export const parseReport = (json, root) => ({
  success: json.success === true,
  files: (json.testResults ?? []).map((file) => ({
    path: relative(root, file.name),
    status: file.status,
    message: file.message ?? '',
    tests: (file.assertionResults ?? []).map((test) => ({
      fullName: test.fullName,
      status: test.status,
      line: test.location?.line ?? null
    }))
  }))
})

// The run gets its own process group so a timeout or an interrupt can stop Vitest's workers
// too: a worker stuck in a mutant's infinite loop outlives a signal sent to its parent alone.
export const killTree = (child, platform = process.platform, kill = process.kill) => {
  if (platform === 'win32' || child.pid === undefined) {
    child.kill('SIGKILL')
    return
  }
  try {
    kill(-child.pid, 'SIGKILL')
  } catch (error) {
    // ESRCH: the group exited between the timer firing and the kill.
    if (error.code !== 'ESRCH') throw error
  }
}

const spawnAndWait = ({ spawn, command, args, options, timeoutMs, onSpawn }) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { ...options, detached: process.platform !== 'win32' })
    onSpawn(child)
    let output = ''
    let timedOut = false
    const keep = (chunk) => {
      output = (output + chunk).slice(-OUTPUT_TAIL)
    }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    const timer =
      timeoutMs === undefined
        ? null
        : setTimeout(() => {
            timedOut = true
            killTree(child)
          }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: null, timedOut, output: `${output}\n${error.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, timedOut, output })
    })
  })

export const createRunner = ({
  root,
  reportDir,
  spawn = nodeSpawn,
  electron = electronBinary,
  env = process.env,
  now = Date.now
}) => {
  let count = 0
  let active = null
  const run = async ({ mode, files, bail = false, timeoutMs }) => {
    mkdirSync(reportDir, { recursive: true })
    const outputFile = join(reportDir, `run-${++count}.json`)
    rmSync(outputFile, { force: true })
    const started = now()
    const { code, timedOut, output } = await spawnAndWait({
      spawn,
      command: electron(),
      args: vitestArgs({ mode, files, outputFile, bail }),
      options: { cwd: root, env: { ...env, ELECTRON_RUN_AS_NODE: '1' } },
      timeoutMs,
      onSpawn: (child) => {
        active = child
      }
    })
    active = null
    const report = existsSync(outputFile)
      ? parseReport(JSON.parse(readFileSync(outputFile, 'utf8')), root)
      : null
    return {
      ok: !timedOut && code === 0 && report?.success === true,
      timedOut,
      code,
      durationMs: now() - started,
      report,
      output
    }
  }
  // Called from a signal handler, so the interrupted run does not outlive the probe.
  const stop = () => {
    if (active) killTree(active)
  }
  return { run, stop }
}
