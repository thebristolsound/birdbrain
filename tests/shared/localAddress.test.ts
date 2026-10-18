import { describe, it, expect } from 'vitest'
import { localAddressKind, localAddressLabel } from '@shared/localAddress'

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
    ['http://[64:ff9b::a00:1]/', 'nat64']
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
    'http://localhost.example.com/'
  ])('answers null for the public host in %s', (url) => {
    expect(localAddressKind(url)).toBeNull()
  })

  it('answers null for a string that is not a URL', () => {
    expect(localAddressKind('not a url')).toBeNull()
    expect(localAddressKind('')).toBeNull()
  })

  it('names each class the way a refusal states it', () => {
    expect(localAddressLabel('this-computer')).toBe('this computer')
    expect(localAddressLabel('loopback')).toBe('a loopback address')
    expect(localAddressLabel('private')).toBe('a private address')
  })
})
