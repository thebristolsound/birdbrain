import { readdirSync, readFileSync, readlinkSync } from 'fs'

// Linux /proc reads for the launched-browser suites: the processes a browser started, the TCP
// sockets they listen on, and whether any of them is still running. A process is named by its pid
// and its start time, so a pid the kernel hands to a new process does not read as a survivor.

export interface ProcessId {
  pid: number
  startTime: string
}

interface Stat {
  ppid: number
  state: string
  startTime: string
}

function readStat(pid: number): Stat | null {
  let text: string
  try {
    text = readFileSync(`/proc/${pid}/stat`, 'utf8')
  } catch {
    return null
  }
  // The command name is in parentheses and may hold spaces; the fields after it are fixed.
  const fields = text.slice(text.lastIndexOf(')') + 2).split(' ')
  return { state: fields[0], ppid: Number(fields[1]), startTime: fields[19] }
}

// Empty for a process that has gone.
function commandLineOf(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8')
  } catch {
    return ''
  }
}

function allPids(): number[] {
  return readdirSync('/proc')
    .filter((name) => /^\d+$/.test(name))
    .map(Number)
}

/**
 * The browser's process tree by parent pid, plus its crash handler: Chrome starts that handler
 * detached, so it is reparented away from the browser, and the children name its pid with
 * `--crashpad-handler-pid`.
 */
export function browserProcesses(rootPid: number): ProcessId[] {
  const children = new Map<number, number[]>()
  for (const pid of allPids()) {
    const stat = readStat(pid)
    if (!stat) continue
    children.set(stat.ppid, [...(children.get(stat.ppid) ?? []), pid])
  }
  const found = new Set<number>()
  const queue = [rootPid]
  while (queue.length > 0) {
    const pid = queue.shift() as number
    if (found.has(pid)) continue
    found.add(pid)
    queue.push(...(children.get(pid) ?? []))
    const handler = /--crashpad-handler-pid=(\d+)/.exec(commandLineOf(pid))?.[1]
    if (handler) queue.push(Number(handler))
  }
  const processes: ProcessId[] = []
  for (const pid of found) {
    const stat = readStat(pid)
    if (stat && stat.state !== 'Z') processes.push({ pid, startTime: stat.startTime })
  }
  return processes
}

/** The processes of `processes` that still run: same pid, same start time, not a zombie. */
export function stillRunning(processes: readonly ProcessId[]): ProcessId[] {
  return processes.filter(({ pid, startTime }) => {
    const stat = readStat(pid)
    return stat !== null && stat.state !== 'Z' && stat.startTime === startTime
  })
}

const TCP_LISTEN = '0A'

function isMissing(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'ENOENT'
}

function listeningInodes(pid: number): Set<string> {
  const inodes = new Set<string>()
  // Each process's own view: a sandboxed child has a network namespace of its own.
  for (const table of ['tcp', 'tcp6']) {
    const lines = readFileSync(`/proc/${pid}/net/${table}`, 'utf8').trim().split('\n').slice(1)
    for (const line of lines) {
      const fields = line.trim().split(/\s+/)
      if (fields[3] === TCP_LISTEN) inodes.add(fields[9])
    }
  }
  return inodes
}

/**
 * Every listening TCP socket a process of `processes` holds, as `pid:inode`. Throws when a
 * process's descriptors cannot be read, so an unreadable process fails the check rather than
 * passing it. A process that exited before it was read holds nothing.
 */
export function listeningTcpSockets(processes: readonly ProcessId[]): string[] {
  const found: string[] = []
  for (const entry of stillRunning(processes)) {
    const { pid } = entry
    try {
      const listening = listeningInodes(pid)
      for (const fd of readdirSync(`/proc/${pid}/fd`)) {
        let target: string
        try {
          target = readlinkSync(`/proc/${pid}/fd/${fd}`)
        } catch (error) {
          // A descriptor closed between the two reads.
          if (isMissing(error)) continue
          throw error
        }
        const inode = /^socket:\[(\d+)\]$/.exec(target)?.[1]
        if (inode && listening.has(inode)) found.push(`${pid}:${inode}`)
      }
    } catch (error) {
      if (!isMissing(error) || stillRunning([entry]).length > 0) throw error
    }
  }
  return found
}

/** Polls until none of `processes` runs, or the time runs out, and returns those left. */
export async function waitForExit(
  processes: readonly ProcessId[],
  timeoutMs = 5_000
): Promise<ProcessId[]> {
  const deadline = Date.now() + timeoutMs
  let left = stillRunning(processes)
  while (left.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    left = stillRunning(left)
  }
  return left
}

/** The pids of running processes whose command line holds `text`, such as a profile folder. */
export function processesNaming(text: string): number[] {
  return allPids().filter((pid) => commandLineOf(pid).includes(text))
}
