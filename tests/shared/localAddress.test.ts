import { describe, it, expect } from 'vitest'
import { captureLinkBlockReason, localAddressKind, localAddressLabel } from '@shared/localAddress'

describe('localAddressKind', () => {
  it.each([
    ['http://localhost:8080/', 'this-computer'],
    ['http://LOCALHOST./', 'this-computer'],
    ['http://app.localhost/', 'this-computer'],
    ['http://127.0.0.1:5000/', 'loopback'],
    ['http://127.8.9.10/', 'loopback'],
    ['http://0x7f.1/', 'loopback'],
    ['http://2130706433/', 'loopback'],
    ['http://[::1]/', 'loopback'],
    ['http://[::ffff:127.0.0.1]/', 'loopback'],
    ['http://0.0.0.0/', 'unspecified'],
    ['http://[::]/', 'unspecified'],
    ['http://10.0.0.5/', 'private'],
    ['http://172.16.0.1/', 'private'],
    ['http://172.31.255.255/', 'private'],
    ['http://192.168.1.1/', 'private'],
    ['http://[::ffff:192.168.1.1]/', 'private'],
    ['http://[fd12:3456::1]/', 'private'],
    ['http://100.64.0.1/', 'shared'],
    ['http://169.254.169.254/latest/meta-data/', 'link-local'],
    ['http://[fe80::1]/', 'link-local'],
    ['http://[::ffff:169.254.1.1]/', 'link-local'],
    ['http://255.255.255.255/', 'broadcast'],
    ['http://224.0.0.1/', 'multicast'],
    ['http://[ff02::1]/', 'multicast'],
    ['http://[::7f00:1]/', 'ipv4-compatible'],
    ['http://[64:ff9b::a00:1]/', 'nat64'],
    // Ruling 3 of the viewer's slice 3 plan (2026-10-26): names only the local network
    // answers.
    ['http://wiki/', 'private-name'],
    ['https://intranet:8443/login', 'private-name'],
    ['http://WIKI./', 'private-name'],
    ['http://printer.local/', 'private-name'],
    ['http://local/', 'private-name'],
    ['https://grafana.corp.internal/d/1', 'private-name'],
    ['http://nas.home.arpa/', 'private-name'],
    ['http://home.arpa/', 'private-name'],
    // `URL` keeps all but one trailing dot, so each is stripped before the host is read.
    ['http://wiki../', 'private-name'],
    ['http://printer.local../', 'private-name'],
    ['http://localhost../', 'this-computer'],
    ['http://127.0.0.1../', 'loopback']
  ])('classifies %s as %s', (url, kind) => {
    expect(localAddressKind(url)).toBe(kind)
  })

  it.each([
    'https://example.com/',
    'http://172.15.0.1/',
    'http://172.32.0.1/',
    'http://100.128.0.1/',
    'http://8.8.8.8/',
    'http://[2001:db8::1]/',
    'http://localhost.example.com/',
    'https://local.example/',
    'https://internal.example.com/',
    'https://example.local.example/',
    'https://notlocal.example/'
  ])('answers null for the public host in %s', (url) => {
    expect(localAddressKind(url)).toBeNull()
  })

  it('reads the dotless-name rule for web addresses only', () => {
    expect(localAddressKind('mailto:someone@example.com')).toBeNull()
    expect(localAddressKind('chrome-error://chromewebdata/')).toBeNull()
    expect(localAddressKind('about:blank')).toBeNull()
    expect(localAddressKind('file:///etc/hosts')).toBeNull()
  })

  it('answers null for a string that is not a URL', () => {
    expect(localAddressKind('not a url')).toBeNull()
    expect(localAddressKind('')).toBeNull()
  })

  it('names each class the way a refusal states it', () => {
    expect(localAddressLabel('this-computer')).toBe('this computer')
    expect(localAddressLabel('loopback')).toBe('a loopback address')
    expect(localAddressLabel('private')).toBe('a private address')
    expect(localAddressLabel('private-name')).toBe('a private network')
  })
})

// The rule the Capture link menu, the Look up in Wayback item and the lookup's main-process
// handler all apply (#1708 D9, #1737).
describe('captureLinkBlockReason', () => {
  it('answers null for a public web address', () => {
    expect(captureLinkBlockReason('https://example.com/a?b=c#d')).toBeNull()
  })

  it('refuses something that is not a URL at all', () => {
    expect(captureLinkBlockReason('')).toBe('Not a web address')
    expect(captureLinkBlockReason('not a url')).toBe('Not a web address')
  })

  it('refuses a scheme other than http and https', () => {
    expect(captureLinkBlockReason('mailto:someone@example.com')).toBe('Not a web address')
    expect(captureLinkBlockReason('ftp://example.com/file')).toBe('Not a web address')
  })

  it('reads the host after URL normalises it, so an encoded loopback is still caught', () => {
    expect(captureLinkBlockReason('http://0x7f.1/')).toBe('Points at a loopback address')
    expect(captureLinkBlockReason('http://LOCALHOST./')).toBe('Points at this computer')
  })

  it('refuses a host with no dot and a name under a private-use suffix', () => {
    expect(captureLinkBlockReason('http://wiki/')).toBe('Points at a private network')
    expect(captureLinkBlockReason('http://intranet/home')).toBe('Points at a private network')
    expect(captureLinkBlockReason('http://printer.local/')).toBe('Points at a private network')
    expect(captureLinkBlockReason('https://git.internal/')).toBe('Points at a private network')
    expect(captureLinkBlockReason('http://nas.home.arpa/')).toBe('Points at a private network')
  })

  it('refuses a host written with several trailing dots', () => {
    expect(captureLinkBlockReason('http://wiki../')).toBe('Points at a private network')
    expect(captureLinkBlockReason('http://printer.local../')).toBe('Points at a private network')
    expect(captureLinkBlockReason('http://localhost../')).toBe('Points at this computer')
  })

  it('passes a dotted public name, whatever it resolves to', () => {
    expect(captureLinkBlockReason('http://intranet.example/')).toBeNull()
  })
})
