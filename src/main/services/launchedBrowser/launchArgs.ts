import { parseProxyUrl } from '@shared/schemas'
import type { KnownEgress } from '@shared/types'

// The launched browser's whole argument list, owned by Birdbrain (spec, "Browser discovery and
// launch"): the switches the spec marks "always", and while the Egress is not Direct the proxy
// with no `direct://` fallback and the WebRTC policy. No excluded switch, no debugging port and
// no proxy bypass list; launchArgs.test.ts pins both lists.

export const START_URL = 'about:blank'

export interface LaunchArgsInput {
  profileDir: string
  egress: KnownEgress
}

function codedError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

export function buildLaunchArgs({ profileDir, egress }: LaunchArgsInput): string[] {
  const args = [
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-pipe',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync'
  ]
  if (egress.kind !== 'direct') {
    // The settings loader stores only addresses parseProxyUrl accepts; this refuses one that
    // reached here another way.
    const proxy = parseProxyUrl(egress.proxyUrl)
    if (!proxy.ok) {
      throw codedError(
        `The Egress proxy address is not usable: ${proxy.reason}`,
        'EGRESS_PROXY_INVALID'
      )
    }
    args.push(`--proxy-server=${proxy.url}`, '--webrtc-ip-handling-policy=disable_non_proxied_udp')
  }
  args.push(START_URL)
  return args
}
