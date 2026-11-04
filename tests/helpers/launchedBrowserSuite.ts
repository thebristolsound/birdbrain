import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { networkInterfaces } from 'os'
import { join } from 'path'
import { buildLaunchArgs, type LaunchArgsInput } from '@main/services/launchedBrowser/launchArgs'
import type { SpawnBrowser } from '@main/services/launchedBrowser/launcher'
import {
  ARCHIVES,
  CACHE_DIR,
  CHROME_FOR_TESTING_VERSION
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/fetch-chrome-for-testing.mjs'

// Switches no shipped launch passes: the spec's excluded list ("Browser discovery and
// launch"), the port of the fallback ruling 37 left unbuilt, and the bypass list that only the
// suite's own launches carry.
export const EXCLUDED_SWITCHES = [
  '--enable-automation',
  '--remote-allow-origins',
  '--no-sandbox',
  '--host-resolver-rules',
  '--log-net-log',
  '--password-store',
  '--use-mock-keychain',
  '--disable-blink-features',
  '--headless',
  '--load-extension',
  '--disable-background-networking',
  '--remote-debugging-port',
  '--proxy-bypass-list'
]

// Commands the engine must never send: the cookie readers, the automation override (spec,
// "The CDP client"), durable messages (2026-10-17 ruling) and the domain enables the spec
// rules out ("Attach before request").
export const NEVER_SENT = [
  'Storage.getCookies',
  'Network.getCookies',
  'Network.getAllCookies',
  'Emulation.setAutomationOverride',
  'Network.configureDurableMessages',
  'Runtime.enable',
  'Log.enable',
  'Performance.enable',
  'Debugger.enable'
]

// The suite's launch list. Chromium keeps loopback traffic off the proxy unless the bypass list
// removes that rule, so a loopback fixture is reached through the fixture proxy only with it
// (spec, "Egress"). It lives here, apart from the shipped builder.
export function buildSuiteLaunchArgs(input: LaunchArgsInput): string[] {
  const args = buildLaunchArgs(input)
  if (input.egress.kind === 'direct') return args
  const startUrl = args[args.length - 1]
  return [...args.slice(0, -1), '--proxy-bypass-list=<-loopback>', startUrl]
}

// The suite's list with test-only switches before the start URL, for one launch.
export function withSwitches(
  build: (input: LaunchArgsInput) => string[],
  switches: readonly string[]
): (input: LaunchArgsInput) => string[] {
  return (input) => {
    const args = build(input)
    return [...args.slice(0, -1), ...switches, args[args.length - 1]]
  }
}

export const PINNED_VERSION: string = CHROME_FOR_TESTING_VERSION

const pin = (ARCHIVES as Record<string, { executable: string } | undefined>)[
  `${process.platform}-${process.arch}`
]

// The pinned Chrome for Testing build, where scripts/fetch-chrome-for-testing.mjs puts it.
export const PINNED_BROWSER: string | null = pin
  ? join(CACHE_DIR as string, PINNED_VERSION, pin.executable)
  : null

// xvfb-run hands its command an Xauthority file in a folder of its own, xvfb-run.XXXXXX.
const XVFB_RUN_AUTHORITY = /\/xvfb-run\.[^/]+\/Xauthority/

/**
 * Why the real-browser suites cannot run here, or null when they can. They need the pinned
 * build, and they run only under xvfb-run, so that `pnpm test` on a desktop never opens a
 * browser window on it.
 */
export function realBrowserSkipReason(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!PINNED_BROWSER || !existsSync(PINNED_BROWSER)) {
    return `no pinned Chrome for Testing ${PINNED_VERSION}: run node scripts/fetch-chrome-for-testing.mjs`
  }
  if (!env.DISPLAY || !XVFB_RUN_AUTHORITY.test(env.XAUTHORITY ?? '')) {
    return 'not under xvfb-run: run xvfb-run --auto-servernum pnpm test <file>'
  }
  return null
}

// Whether this process sees no network interface but loopback, as inside `unshare -n`.
export function loopbackOnly(): boolean {
  const names = Object.keys(networkInterfaces())
  return names.length === 1 && names[0] === 'lo'
}

// The real spawn, with the Wayland variables removed so the browser draws on xvfb-run's X
// display and not on the desktop's Wayland compositor.
export const suiteSpawn: SpawnBrowser = (command, args, options) => {
  const env = { ...process.env }
  delete env.WAYLAND_DISPLAY
  delete env.XDG_SESSION_TYPE
  return spawn(command, args, { ...options, env })
}
