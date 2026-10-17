import { utilityProcess } from 'electron'
import type { ExtractedDatum } from '@main/services/dataExtractor'
import type {
  ExtractionErrorInfo,
  ExtractionReplyMessage,
  ExtractionRequest,
  ExtractionRequestMessage
} from '@main/services/extraction/processHandler'

// The main process's side of the extraction utility process (#598). Requests
// go to the process one at a time, so the timeout measures the extraction in
// hand, never the queue behind it. A process that exits, or does not answer
// in time, fails the request it held and is dropped; the next request forks a
// fresh one.

export const EXTRACTION_TIMEOUT_MS = 60_000

export type ExtractionOutcome =
  | { ok: true; rows: ExtractedDatum[]; durationMs: number }
  | { ok: false; error: Error; durationMs: number }

export interface ExtractionClient {
  // Never rejects: every failure is an `ok: false` outcome.
  extract: (request: ExtractionRequest) => Promise<ExtractionOutcome>
  // Stops the process and fails every request not yet answered.
  dispose: () => void
}

// The part of Electron's UtilityProcess the client uses, so tests can pass a fake.
export interface ExtractionChild {
  postMessage: (message: ExtractionRequestMessage) => void
  on(event: 'message', listener: (reply: ExtractionReplyMessage) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  kill: () => boolean
}

export interface ExtractionProcessDeps {
  // The built entry, out/main/extraction.js.
  entryPath: string
  fork?: (entryPath: string) => ExtractionChild
  timeoutMs?: number
}

function forkUtilityProcess(entryPath: string): ExtractionChild {
  return utilityProcess.fork(entryPath, [], { serviceName: 'Birdbrain extraction' })
}

function codedError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

function errorFrom({ name, code, message }: ExtractionErrorInfo): Error {
  const err = new Error(message)
  err.name = name
  return code ? Object.assign(err, { code }) : err
}

interface Pending {
  message: ExtractionRequestMessage
  settle: (outcome: ExtractionOutcome) => void
}

export function createExtractionProcess(deps: ExtractionProcessDeps): ExtractionClient {
  const fork = deps.fork ?? forkUtilityProcess
  const timeoutMs = deps.timeoutMs ?? EXTRACTION_TIMEOUT_MS
  const queue: Pending[] = []
  let child: ExtractionChild | null = null
  let inFlight: { pending: Pending; sentAt: number; timer: ReturnType<typeof setTimeout> } | null =
    null
  let nextId = 1
  let disposed = false

  function settleInFlight(outcome: (sentAt: number) => ExtractionOutcome): void {
    if (!inFlight) return
    const { pending, sentAt, timer } = inFlight
    clearTimeout(timer)
    inFlight = null
    pending.settle(outcome(sentAt))
  }

  function failInFlight(error: Error): void {
    settleInFlight((sentAt) => ({ ok: false, error, durationMs: performance.now() - sentAt }))
  }

  function start(): ExtractionChild {
    const forked = fork(deps.entryPath)
    forked.on('message', (reply) => {
      if (forked !== child || inFlight?.pending.message.id !== reply.id) return
      settleInFlight(() =>
        reply.ok
          ? { ok: true, rows: reply.rows, durationMs: reply.durationMs }
          : { ok: false, error: errorFrom(reply.error), durationMs: reply.durationMs }
      )
      pump()
    })
    forked.on('exit', (code) => {
      if (forked !== child) return
      child = null
      failInFlight(codedError(`Extraction process exited with code ${code}`, 'EXTRACTION_EXITED'))
      pump()
    })
    return forked
  }

  function onTimeout(): void {
    const stuck = child
    child = null
    stuck?.kill()
    failInFlight(
      codedError(`Extraction did not answer within ${timeoutMs} ms`, 'EXTRACTION_TIMEOUT')
    )
    pump()
  }

  function pump(): void {
    while (!inFlight && !disposed) {
      const pending = queue.shift()
      if (!pending) return
      const sentAt = performance.now()
      try {
        child ??= start()
        child.postMessage(pending.message)
      } catch (err) {
        // A process that took the fork but not the message is dropped like a stuck one.
        child?.kill()
        child = null
        pending.settle({
          ok: false,
          error: err instanceof Error ? err : new Error(String(err)),
          durationMs: performance.now() - sentAt
        })
        continue
      }
      const timer = setTimeout(onTimeout, timeoutMs)
      timer.unref?.()
      inFlight = { pending, sentAt, timer }
    }
  }

  return {
    extract(request) {
      if (disposed) {
        return Promise.resolve({
          ok: false,
          error: codedError('Extraction process stopped', 'EXTRACTION_STOPPED'),
          durationMs: 0
        })
      }
      return new Promise<ExtractionOutcome>((settle) => {
        queue.push({ message: { ...request, id: nextId++ }, settle })
        pump()
      })
    },

    dispose() {
      disposed = true
      const stopping = child
      child = null
      stopping?.kill()
      const stopped = codedError('Extraction process stopped', 'EXTRACTION_STOPPED')
      failInFlight(stopped)
      for (const { settle } of queue.splice(0)) settle({ ok: false, error: stopped, durationMs: 0 })
    }
  }
}
