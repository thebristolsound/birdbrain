import { describe, expect, it } from 'vitest'
import { buildLaunchArgs } from '@main/services/launchedBrowser/launchArgs'
import { buildSuiteLaunchArgs, EXCLUDED_SWITCHES } from '../../../helpers/launchedBrowserSuite'
import type { KnownEgress } from '@shared/types'

const PROFILE = '/home/op/.config/Birdbrain/launched-browsers/session-1234/chrome'
const DIRECT: KnownEgress = { kind: 'direct' }
const TOR: KnownEgress = { kind: 'tor', proxyUrl: 'socks5://127.0.0.1:9050', label: 'Tor' }
const HTTP_PROXY: KnownEgress = {
  kind: 'proxy',
  proxyUrl: 'http://proxy.example:8080',
  label: 'Harbor relay'
}

// The switches the spec's table marks "always" ("Browser discovery and launch").
const ALWAYS = [
  `--user-data-dir=${PROFILE}`,
  '--remote-debugging-pipe',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  'about:blank'
]

function switchName(arg: string): string {
  return arg.split('=')[0]
}

function excludedIn(args: string[]): string[] {
  return args.filter((arg) => EXCLUDED_SWITCHES.includes(switchName(arg)))
}

describe('buildLaunchArgs', () => {
  it('pins the Direct list: the always switches and nothing else', () => {
    expect(buildLaunchArgs({ profileDir: PROFILE, egress: DIRECT })).toEqual(ALWAYS)
  })

  it('pins the proxy list: the always switches, the proxy alone, and the WebRTC policy', () => {
    expect(buildLaunchArgs({ profileDir: PROFILE, egress: TOR })).toEqual([
      ...ALWAYS.slice(0, -1),
      '--proxy-server=socks5://127.0.0.1:9050',
      '--webrtc-ip-handling-policy=disable_non_proxied_udp',
      'about:blank'
    ])
    expect(buildLaunchArgs({ profileDir: PROFILE, egress: HTTP_PROXY })).toContain(
      '--proxy-server=http://proxy.example:8080'
    )
  })

  it('names no direct:// fallback and no bypass list in either list', () => {
    for (const egress of [DIRECT, TOR, HTTP_PROXY]) {
      const args = buildLaunchArgs({ profileDir: PROFILE, egress })
      expect(args.join(' ')).not.toContain('direct://')
      expect(args.map(switchName)).not.toContain('--proxy-bypass-list')
    }
  })

  it('holds no excluded switch and no debugging port', () => {
    for (const egress of [DIRECT, TOR, HTTP_PROXY]) {
      expect(excludedIn(buildLaunchArgs({ profileDir: PROFILE, egress }))).toEqual([])
    }
    expect(EXCLUDED_SWITCHES).toEqual(
      expect.arrayContaining(['--remote-debugging-port', '--proxy-bypass-list'])
    )
  })

  it('keeps a profile path with spaces as one argument', () => {
    const profileDir = 'C:\\Users\\An Operator\\AppData\\Roaming\\Birdbrain\\session-1\\edge'
    expect(buildLaunchArgs({ profileDir, egress: DIRECT })[0]).toBe(`--user-data-dir=${profileDir}`)
  })

  it('refuses a proxy address that does not parse, rather than launching around it', () => {
    for (const proxyUrl of ['socks5://127.0.0.1:9050;direct://', 'socks4://127.0.0.1:9050', '']) {
      expect(() =>
        buildLaunchArgs({ profileDir: PROFILE, egress: { kind: 'proxy', proxyUrl, label: '' } })
      ).toThrow(expect.objectContaining({ code: 'EGRESS_PROXY_INVALID' }))
    }
  })

  it('passes the address in the form the settings store it', () => {
    const args = buildLaunchArgs({
      profileDir: PROFILE,
      egress: { kind: 'proxy', proxyUrl: ' http://proxy.example ', label: '' }
    })
    expect(args).toContain('--proxy-server=http://proxy.example:80')
  })
})

describe('buildSuiteLaunchArgs', () => {
  it("adds the loopback bypass removal to the suite's proxy launches only", () => {
    expect(buildSuiteLaunchArgs({ profileDir: PROFILE, egress: TOR })).toEqual([
      ...buildLaunchArgs({ profileDir: PROFILE, egress: TOR }).slice(0, -1),
      '--proxy-bypass-list=<-loopback>',
      'about:blank'
    ])
    expect(buildSuiteLaunchArgs({ profileDir: PROFILE, egress: DIRECT })).toEqual(ALWAYS)
  })
})
