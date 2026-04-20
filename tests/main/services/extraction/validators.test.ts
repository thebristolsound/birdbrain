import { describe, it, expect } from 'vitest'
import {
  isPublicIpv4,
  isValidDomain,
  isValidEmailDomain,
  isValidEmail
} from '@main/services/extraction/validators'

describe('validators', () => {
  describe('isPublicIpv4', () => {
    describe('regression guard — bug report cases', () => {
      it('rejects 10.94.75.75 (RFC1918)', () => expect(isPublicIpv4('10.94.75.75')).toBe(false))
      it('rejects 127.0.0.1 (loopback)', () => expect(isPublicIpv4('127.0.0.1')).toBe(false))
      it('rejects 169.254.1.1 (link-local)', () => expect(isPublicIpv4('169.254.1.1')).toBe(false))
      it('rejects 224.0.0.1 (multicast)', () => expect(isPublicIpv4('224.0.0.1')).toBe(false))
      it('rejects 192.168.1.1 (RFC1918)', () => expect(isPublicIpv4('192.168.1.1')).toBe(false))
      it('accepts 8.8.8.8', () => expect(isPublicIpv4('8.8.8.8')).toBe(true))
      it('accepts 1.1.1.1', () => expect(isPublicIpv4('1.1.1.1')).toBe(true))
      it('rejects 010.0.0.1 (leading zero)', () => expect(isPublicIpv4('010.0.0.1')).toBe(false))
      it('rejects 256.0.0.1 (octet > 255)', () => expect(isPublicIpv4('256.0.0.1')).toBe(false))
    })

    describe('0.0.0.0/8 — this network', () => {
      it('rejects 0.0.0.0', () => expect(isPublicIpv4('0.0.0.0')).toBe(false))
      it('rejects 0.255.255.255', () => expect(isPublicIpv4('0.255.255.255')).toBe(false))
    })

    describe('10.0.0.0/8 — RFC1918', () => {
      it('rejects 10.0.0.0', () => expect(isPublicIpv4('10.0.0.0')).toBe(false))
      it('rejects 10.255.255.255', () => expect(isPublicIpv4('10.255.255.255')).toBe(false))
    })

    describe('100.64.0.0/10 — CGNAT', () => {
      it('rejects 100.64.0.0', () => expect(isPublicIpv4('100.64.0.0')).toBe(false))
      it('rejects 100.127.255.255', () => expect(isPublicIpv4('100.127.255.255')).toBe(false))
      it('accepts 100.63.255.255 (just outside CGNAT)', () =>
        expect(isPublicIpv4('100.63.255.255')).toBe(true))
      it('accepts 100.128.0.0 (just outside CGNAT)', () =>
        expect(isPublicIpv4('100.128.0.0')).toBe(true))
    })

    describe('172.16.0.0/12 — RFC1918', () => {
      it('rejects 172.16.0.0', () => expect(isPublicIpv4('172.16.0.0')).toBe(false))
      it('rejects 172.31.255.255', () => expect(isPublicIpv4('172.31.255.255')).toBe(false))
      it('accepts 172.15.255.255 (just outside)', () =>
        expect(isPublicIpv4('172.15.255.255')).toBe(true))
      it('accepts 172.32.0.0 (just outside)', () => expect(isPublicIpv4('172.32.0.0')).toBe(true))
    })

    describe('192.0.0.0/24 — IETF protocol', () => {
      it('rejects 192.0.0.0', () => expect(isPublicIpv4('192.0.0.0')).toBe(false))
      it('rejects 192.0.0.255', () => expect(isPublicIpv4('192.0.0.255')).toBe(false))
    })

    describe('192.0.2.0/24 — TEST-NET-1', () => {
      it('rejects 192.0.2.0', () => expect(isPublicIpv4('192.0.2.0')).toBe(false))
      it('rejects 192.0.2.255', () => expect(isPublicIpv4('192.0.2.255')).toBe(false))
    })

    describe('192.88.99.0/24 — 6to4 relay', () => {
      it('rejects 192.88.99.0', () => expect(isPublicIpv4('192.88.99.0')).toBe(false))
      it('rejects 192.88.99.255', () => expect(isPublicIpv4('192.88.99.255')).toBe(false))
    })

    describe('198.18.0.0/15 — benchmarking', () => {
      it('rejects 198.18.0.0', () => expect(isPublicIpv4('198.18.0.0')).toBe(false))
      it('rejects 198.19.255.255', () => expect(isPublicIpv4('198.19.255.255')).toBe(false))
      it('accepts 198.17.255.255 (just outside)', () =>
        expect(isPublicIpv4('198.17.255.255')).toBe(true))
      it('accepts 198.20.0.0 (just outside)', () => expect(isPublicIpv4('198.20.0.0')).toBe(true))
    })

    describe('198.51.100.0/24 — TEST-NET-2', () => {
      it('rejects 198.51.100.0', () => expect(isPublicIpv4('198.51.100.0')).toBe(false))
      it('rejects 198.51.100.255', () => expect(isPublicIpv4('198.51.100.255')).toBe(false))
    })

    describe('203.0.113.0/24 — TEST-NET-3', () => {
      it('rejects 203.0.113.0', () => expect(isPublicIpv4('203.0.113.0')).toBe(false))
      it('rejects 203.0.113.255', () => expect(isPublicIpv4('203.0.113.255')).toBe(false))
    })

    describe('224.0.0.0/4 — multicast', () => {
      it('rejects 224.0.0.0', () => expect(isPublicIpv4('224.0.0.0')).toBe(false))
      it('rejects 239.255.255.255', () => expect(isPublicIpv4('239.255.255.255')).toBe(false))
    })

    describe('240.0.0.0/4 — reserved', () => {
      it('rejects 240.0.0.0', () => expect(isPublicIpv4('240.0.0.0')).toBe(false))
      it('rejects 254.255.255.255', () => expect(isPublicIpv4('254.255.255.255')).toBe(false))
      it('rejects 255.255.255.255 (broadcast)', () =>
        expect(isPublicIpv4('255.255.255.255')).toBe(false))
    })

    describe('invalid inputs', () => {
      it('rejects empty string', () => expect(isPublicIpv4('')).toBe(false))
      it('rejects non-dotted-quad', () => expect(isPublicIpv4('notanip')).toBe(false))
      it('rejects too few octets', () => expect(isPublicIpv4('1.2.3')).toBe(false))
      it('rejects too many octets', () => expect(isPublicIpv4('1.2.3.4.5')).toBe(false))
      it('rejects empty octet', () => expect(isPublicIpv4('1..3.4')).toBe(false))
      it('rejects hex notation', () => expect(isPublicIpv4('0x01.0x02.0x03.0x04')).toBe(false))
      it('rejects leading zero 010.0.0.1', () => expect(isPublicIpv4('010.0.0.1')).toBe(false))
      it('rejects leading zero 1.01.0.1', () => expect(isPublicIpv4('1.01.0.1')).toBe(false))
    })
  })

  describe('isValidDomain', () => {
    describe('regression guard — bug report cases', () => {
      it('rejects localhost', () => expect(isValidDomain('localhost')).toBe(false))
      it('rejects foo.local', () => expect(isValidDomain('foo.local')).toBe(false))
      it('accepts example.com', () => expect(isValidDomain('example.com')).toBe(true))
      it('accepts www.cnn.com', () => expect(isValidDomain('www.cnn.com')).toBe(true))
      it('rejects script.js (no valid public suffix)', () =>
        expect(isValidDomain('script.js')).toBe(false))
      it('rejects 8.8.8.8 (isIp)', () => expect(isValidDomain('8.8.8.8')).toBe(false))
    })

    describe('blocklist — exact and suffix', () => {
      it('rejects *.localhost', () => expect(isValidDomain('foo.localhost')).toBe(false))
      it('rejects *.invalid', () => expect(isValidDomain('foo.invalid')).toBe(false))
      it('rejects *.test', () => expect(isValidDomain('foo.test')).toBe(false))
      it('rejects *.example', () => expect(isValidDomain('foo.example')).toBe(false))
      it('rejects *.internal', () => expect(isValidDomain('corp.internal')).toBe(false))
      it('rejects *.lan', () => expect(isValidDomain('router.lan')).toBe(false))
      it('rejects *.home', () => expect(isValidDomain('device.home')).toBe(false))
      it('rejects *.arpa', () => expect(isValidDomain('1.in-addr.arpa')).toBe(false))
    })

    describe('valid public domains', () => {
      it('accepts google.com', () => expect(isValidDomain('google.com')).toBe(true))
      it('accepts sub.domain.co.uk', () => expect(isValidDomain('sub.domain.co.uk')).toBe(true))
      it('accepts birdbrain.app', () => expect(isValidDomain('birdbrain.app')).toBe(true))
    })

    describe('structural rejections', () => {
      it('rejects domain with no dot', () => expect(isValidDomain('nodot')).toBe(false))
      it('rejects domain > 253 chars', () =>
        expect(isValidDomain('a'.repeat(254) + '.com')).toBe(false))
      it('rejects IP address', () => expect(isValidDomain('192.168.1.1')).toBe(false))
    })
  })

  describe('isValidEmailDomain', () => {
    describe('regression guard — bug report cases', () => {
      it('rejects mhtml.blink', () => expect(isValidEmailDomain('mhtml.blink')).toBe(false))
      it('accepts gmail.com', () => expect(isValidEmailDomain('gmail.com')).toBe(true))
    })

    describe('denylist', () => {
      it('rejects example.com', () => expect(isValidEmailDomain('example.com')).toBe(false))
      it('rejects example.org', () => expect(isValidEmailDomain('example.org')).toBe(false))
      it('rejects example.net', () => expect(isValidEmailDomain('example.net')).toBe(false))
      it('rejects example.edu', () => expect(isValidEmailDomain('example.edu')).toBe(false))
      it('rejects localhost', () => expect(isValidEmailDomain('localhost')).toBe(false))
      it('rejects test', () => expect(isValidEmailDomain('test')).toBe(false))
      it('rejects invalid', () => expect(isValidEmailDomain('invalid')).toBe(false))
      it('rejects noreply.github.com', () =>
        expect(isValidEmailDomain('noreply.github.com')).toBe(false))
      it('rejects users.noreply.github.com', () =>
        expect(isValidEmailDomain('users.noreply.github.com')).toBe(false))
      it('rejects email.example.com', () =>
        expect(isValidEmailDomain('email.example.com')).toBe(false))
      it('rejects donotreply.com', () => expect(isValidEmailDomain('donotreply.com')).toBe(false))
      it('rejects do-not-reply.com', () =>
        expect(isValidEmailDomain('do-not-reply.com')).toBe(false))
    })

    describe('case insensitivity', () => {
      it('rejects MHTML.BLINK (uppercase)', () =>
        expect(isValidEmailDomain('MHTML.BLINK')).toBe(false))
      it('rejects Example.Com', () => expect(isValidEmailDomain('Example.Com')).toBe(false))
    })
  })

  describe('isValidEmail', () => {
    describe('regression guard — bug report cases', () => {
      it('rejects css-02d9d271-e4cb-46fa-ad80-50231de356cb@mhtml.blink', () =>
        expect(isValidEmail('css-02d9d271-e4cb-46fa-ad80-50231de356cb@mhtml.blink')).toBe(false))
      it('rejects matt@example.com (example.com denylisted)', () =>
        expect(isValidEmail('matt@example.com')).toBe(false))
      it('accepts matt@birdbrain.app', () => expect(isValidEmail('matt@birdbrain.app')).toBe(true))
    })

    describe('syntax validation', () => {
      it('rejects no @ sign', () => expect(isValidEmail('nodomain')).toBe(false))
      it('rejects empty local part', () => expect(isValidEmail('@domain.com')).toBe(false))
      it('rejects local part > 64 chars', () =>
        expect(isValidEmail('a'.repeat(65) + '@domain.com')).toBe(false))
      it('rejects empty domain', () => expect(isValidEmail('user@')).toBe(false))
      it('accepts valid email', () => expect(isValidEmail('user@gmail.com')).toBe(true))
    })
  })
})
