import { parse } from 'tldts'

// The worker pool's rules (docs/specs/2026-11-09-batch-capture-throughput-design.md, "Bounded
// parallel workers"). Kept out of index.ts, which the unit suite cannot load.

export const MAX_BACKGROUND_WORKERS = 2

const CPUS_PER_WORKER = 4

// A job does not start beside a running one while `os.freemem()` is below this. On Linux, Node 24's
// libuv reads it from MemAvailable, which counts reclaimable page cache, not MemFree.
export const MIN_FREE_MEMORY_BYTES = 1.5 * 1024 ** 3

// How often a slot the memory floor holds looks again, besides when a running job ends.
export const MEMORY_GATE_RETRY_MS = 2_000

const clampWorkers = (n: number): number => Math.min(Math.max(n, 1), MAX_BACKGROUND_WORKERS)

// `clamp(floor(cpus / 4), 1, 2)`, so a machine with fewer than 8 logical CPUs runs one job.
export function workersForCpus(cpus: number): number {
  return clampWorkers(Math.floor(cpus / CPUS_PER_WORKER))
}

const WHOLE_NUMBER = /^\d+$/

// `BIRDBRAIN_BACKGROUND_WORKERS`, clamped to 1 and 2, overrides the formula; it is read in a
// packaged build too, so support can force one worker. A value that is not a whole number is
// ignored.
export function resolveBackgroundWorkers(override: string | undefined, cpus: number): number {
  const value = override?.trim()
  if (value && WHOLE_NUMBER.test(value)) return clampWorkers(Number.parseInt(value, 10))
  return workersForCpus(cpus)
}

// The slot a job's address takes under the one-running-job-per-site rule: the registrable domain
// on the public suffix list's ICANN section, so `www.example.com` and `example.com` share one. An
// IP address, or a host with no registrable domain, is its own site; so is an address that does
// not parse, which `enqueue` refuses anyway.
export function jobSite(url: string): string {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return url
  }
  const { hostname, domain, isIp } = parse(host)
  if (isIp) return hostname ?? host
  return domain ?? hostname ?? host
}
