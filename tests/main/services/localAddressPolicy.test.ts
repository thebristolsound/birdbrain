import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const electronApp = vi.hoisted(() => ({ isPackaged: true }))
vi.mock('electron', () => ({ app: electronApp }))

import {
  E2E_LOOPBACK_SWITCH,
  RefusedAddressError,
  refusedAddressClass
} from '@main/services/localAddressPolicy'

describe('refusedAddressClass', () => {
  beforeEach(() => {
    electronApp.isPackaged = true
    delete process.env[E2E_LOOPBACK_SWITCH]
  })

  afterEach(() => {
    delete process.env[E2E_LOOPBACK_SWITCH]
  })

  it('answers null for a public address', () => {
    expect(refusedAddressClass('https://example.com/page')).toBeNull()
  })

  it('refuses loopback and private addresses by default', () => {
    expect(refusedAddressClass('http://127.0.0.1:8080/')).toBe('a loopback address')
    expect(refusedAddressClass('http://localhost/')).toBe('this computer')
    expect(refusedAddressClass('http://10.0.0.5/')).toBe('a private address')
    expect(refusedAddressClass('http://[::ffff:7f00:1]/')).toBe('a loopback address')
  })

  // The background capture reads the classification the link menu does, so ruling 3's
  // host names are refused here too (#1737).
  it('refuses a host with no dot and a name under a private-use suffix', () => {
    expect(refusedAddressClass('http://intranet/')).toBe('a private network')
    expect(refusedAddressClass('http://printer.local/')).toBe('a private network')
  })

  it('refuses 127.0.0.1 in a packaged build even with the e2e switch set', () => {
    process.env[E2E_LOOPBACK_SWITCH] = '1'
    expect(refusedAddressClass('http://127.0.0.1:8080/')).toBe('a loopback address')
    expect(refusedAddressClass('http://localhost/')).toBe('this computer')
  })

  it('admits loopback, and only loopback, in an unpackaged build with the switch set', () => {
    electronApp.isPackaged = false
    process.env[E2E_LOOPBACK_SWITCH] = '1'
    expect(refusedAddressClass('http://127.0.0.1:8080/')).toBeNull()
    expect(refusedAddressClass('http://localhost/')).toBeNull()
    expect(refusedAddressClass('http://[::1]/')).toBeNull()
    expect(refusedAddressClass('http://10.0.0.5/')).toBe('a private address')
    expect(refusedAddressClass('http://192.168.1.1/')).toBe('a private address')
    expect(refusedAddressClass('http://169.254.169.254/')).toBe('a link-local address')
  })

  it('keeps loopback refused in an unpackaged build without the switch', () => {
    electronApp.isPackaged = false
    expect(refusedAddressClass('http://127.0.0.1:8080/')).toBe('a loopback address')
    process.env[E2E_LOOPBACK_SWITCH] = 'true'
    expect(refusedAddressClass('http://127.0.0.1:8080/')).toBe('a loopback address')
  })
})

describe('RefusedAddressError', () => {
  it('states the refused class as the reason', () => {
    const err = new RefusedAddressError('a private address')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('Redirects to a private address')
  })
})
