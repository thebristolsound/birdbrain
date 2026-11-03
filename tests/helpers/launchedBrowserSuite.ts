import { buildLaunchArgs, type LaunchArgsInput } from '@main/services/launchedBrowser/launchArgs'

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

// The suite's launch list. Chromium keeps loopback traffic off the proxy unless the bypass list
// removes that rule, so a loopback fixture is reached through the fixture proxy only with it
// (spec, "Egress"). It lives here, apart from the shipped builder.
export function buildSuiteLaunchArgs(input: LaunchArgsInput): string[] {
  const args = buildLaunchArgs(input)
  if (input.egress.kind === 'direct') return args
  const startUrl = args[args.length - 1]
  return [...args.slice(0, -1), '--proxy-bypass-list=<-loopback>', startUrl]
}
