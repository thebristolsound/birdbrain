import { describe, expect, it } from 'vitest'
import { jobSite, resolveBackgroundWorkers, workersForCpus } from '@main/services/backgroundJobPool'

// The pool's concurrency and its site rule (docs/specs/2026-11-09-batch-capture-throughput-
// design.md, "Bounded parallel workers").

describe('background job pool rules', () => {
  it('runs one worker per four logical CPUs, at least one and at most two', () => {
    expect([1, 4, 7, 8, 11, 12, 18, 64].map(workersForCpus)).toEqual([1, 1, 1, 2, 2, 2, 2, 2])
  })

  it('lets BIRDBRAIN_BACKGROUND_WORKERS override the formula, clamped to 1 and 2', () => {
    expect(resolveBackgroundWorkers('1', 18)).toBe(1)
    expect(resolveBackgroundWorkers('2', 4)).toBe(2)
    expect(resolveBackgroundWorkers('0', 18)).toBe(1)
    expect(resolveBackgroundWorkers('5', 4)).toBe(2)
    expect(resolveBackgroundWorkers(' 2 ', 4)).toBe(2)
  })

  it('uses the formula when the override is unset or not a whole number', () => {
    for (const value of [undefined, '', 'two', '-1', '1.5']) {
      expect([resolveBackgroundWorkers(value, 4), resolveBackgroundWorkers(value, 8)]).toEqual([
        1, 2
      ])
    }
  })

  it('gives www and the bare domain one site, and subdomains of one registrable domain one', () => {
    expect(jobSite('https://www.example.com/a')).toBe('example.com')
    expect(jobSite('https://example.com')).toBe('example.com')
    expect(jobSite('https://WWW.Example.COM./b')).toBe('example.com')
    expect(jobSite('https://en.wikipedia.org/wiki/A')).toBe(jobSite('https://de.wikipedia.org/'))
    expect(jobSite('https://shop.bar.co.uk/')).toBe('bar.co.uk')
    expect(jobSite('https://example.org/')).not.toBe(jobSite('https://example.com/'))
  })

  it('makes each IP address, and each host with no registrable domain, its own site', () => {
    expect(jobSite('http://203.0.113.5:8080/a')).toBe('203.0.113.5')
    expect(jobSite('http://203.0.113.6/b')).toBe('203.0.113.6')
    expect(jobSite('http://[2001:db8::1]/')).toBe('2001:db8::1')
    expect(jobSite('http://localhost:5173/')).toBe('localhost')
    expect(jobSite('http://intranet/')).toBe('intranet')
    expect(jobSite('not a url')).toBe('not a url')
  })
})
