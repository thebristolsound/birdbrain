import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'events'
import { join } from 'path'
import {
  createExtractionProcess,
  type ExtractionChild,
  type ExtractionOutcome
} from '@main/services/extraction/processClient'
import type { ExtractionRequestMessage } from '@main/services/extraction/processHandler'
import { fakeFork } from '../../../helpers/inProcessExtraction'
import {
  FIXTURE_DIR,
  FIXTURE_KNOWN_ANSWERS,
  rowKeys
} from '../../../helpers/extractionKnownAnswers'

const POPE = 'cnn-pope-synthetic.mhtml'
const IRAN = 'cnn-iran-synthetic.mhtml'

function request(fixture: string) {
  return { mhtmlPath: join(FIXTURE_DIR, fixture), htmlPath: join(FIXTURE_DIR, 'absent.html') }
}

function errorCode(outcome: ExtractionOutcome): unknown {
  return outcome.ok ? undefined : (outcome.error as NodeJS.ErrnoException).code
}

// A child that records what it is sent and answers only when a test tells it to.
class ScriptedChild extends EventEmitter implements ExtractionChild {
  readonly received: ExtractionRequestMessage[] = []
  kills = 0

  postMessage(message: ExtractionRequestMessage): void {
    this.received.push(message)
  }

  kill(): boolean {
    this.kills += 1
    return true
  }
}

describe('createExtractionProcess', () => {
  it('does not fork until the first extraction', async () => {
    const { fork, children } = fakeFork()
    const client = createExtractionProcess({ entryPath: '/app/out/main/extraction.js', fork })
    expect(children).toHaveLength(0)
    await client.extract(request(POPE))
    expect(children).toHaveLength(1)
  })

  it('forks the entry it was given and returns the rows the process answers with', async () => {
    const forked: string[] = []
    const { fork, children } = fakeFork()
    const client = createExtractionProcess({
      entryPath: '/app/out/main/extraction.js',
      fork: (entryPath) => {
        forked.push(entryPath)
        return fork(entryPath)
      }
    })
    const outcome = await client.extract(request(POPE))
    expect(forked).toEqual(['/app/out/main/extraction.js'])
    expect(children[0].received[0]).toMatchObject(request(POPE))
    if (!outcome.ok) throw outcome.error
    expect(rowKeys(outcome.rows)).toEqual(FIXTURE_KNOWN_ANSWERS[POPE])
    expect(outcome.durationMs).toBeGreaterThan(0)
  })

  it('reuses one process and sends the next request only once the last is answered', async () => {
    const child = new ScriptedChild()
    const client = createExtractionProcess({ entryPath: 'x', fork: () => child })
    const first = client.extract(request(POPE))
    const second = client.extract(request(IRAN))
    expect(child.received).toHaveLength(1)

    const [{ id: firstId }] = child.received
    child.emit('message', { id: firstId, ok: true, rows: [], durationMs: 3 })
    expect(await first).toEqual({ ok: true, rows: [], durationMs: 3 })
    expect(child.received).toHaveLength(2)

    const secondId = child.received[1].id
    expect(secondId).not.toBe(firstId)
    child.emit('message', { id: secondId, ok: true, rows: [], durationMs: 4 })
    expect(await second).toEqual({ ok: true, rows: [], durationMs: 4 })
  })

  it('turns an error the process answers with into a failure carrying its name and code', async () => {
    const child = new ScriptedChild()
    const client = createExtractionProcess({ entryPath: 'x', fork: () => child })
    const pending = client.extract(request(POPE))
    child.emit('message', {
      id: child.received[0].id,
      ok: false,
      error: { name: 'TypeError', code: 'EISDIR', message: 'read failed' },
      durationMs: 2
    })
    const outcome = await pending
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.name).toBe('TypeError')
    expect(outcome.error.message).toBe('read failed')
    expect(errorCode(outcome)).toBe('EISDIR')
    expect(outcome.durationMs).toBe(2)
  })

  it('leaves the code off an answered error that has none', async () => {
    const child = new ScriptedChild()
    const client = createExtractionProcess({ entryPath: 'x', fork: () => child })
    const pending = client.extract(request(POPE))
    child.emit('message', {
      id: child.received[0].id,
      ok: false,
      error: { name: 'Error', code: null, message: 'no code' },
      durationMs: 1
    })
    const outcome = await pending
    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? 'n/a' : 'code' in outcome.error).toBe(false)
  })

  it('fails the request a process held when it exits, and forks a fresh one for the next', async () => {
    const { fork, children } = fakeFork(['exit'])
    const client = createExtractionProcess({ entryPath: 'x', fork })

    const failed = await client.extract(request(POPE))
    expect(failed.ok).toBe(false)
    expect(errorCode(failed)).toBe('EXTRACTION_EXITED')

    const next = await client.extract(request(IRAN))
    expect(children).toHaveLength(2)
    expect(next.ok && rowKeys(next.rows)).toEqual(FIXTURE_KNOWN_ANSWERS[IRAN])
  })

  it('kills a process that does not answer in time, and the next request gets a new one', async () => {
    const { fork, children } = fakeFork(['hang'])
    const client = createExtractionProcess({ entryPath: 'x', fork, timeoutMs: 30 })

    const timedOut = await client.extract(request(POPE))
    expect(errorCode(timedOut)).toBe('EXTRACTION_TIMEOUT')
    expect(timedOut.durationMs).toBeGreaterThanOrEqual(25)
    expect(children[0].killed).toBe(true)

    const next = await client.extract(request(POPE))
    expect(children).toHaveLength(2)
    expect(next.ok && rowKeys(next.rows)).toEqual(FIXTURE_KNOWN_ANSWERS[POPE])
  })

  it('ignores an answer from a process it already gave up on', async () => {
    const stuck = new ScriptedChild()
    const fresh = new ScriptedChild()
    const children = [stuck, fresh]
    const client = createExtractionProcess({
      entryPath: 'x',
      fork: () => children.shift() ?? new ScriptedChild(),
      timeoutMs: 20
    })
    expect(errorCode(await client.extract(request(POPE)))).toBe('EXTRACTION_TIMEOUT')
    expect(stuck.kills).toBe(1)

    const pending = client.extract(request(IRAN))
    const { id } = fresh.received[0]
    // The killed process answering late, with the id the fresh one now holds, and exiting.
    stuck.emit('message', { id, ok: true, rows: [], durationMs: 1 })
    stuck.emit('exit', 0)
    fresh.emit('message', { id, ok: true, rows: [], durationMs: 9 })
    expect(await pending).toEqual({ ok: true, rows: [], durationMs: 9 })
  })

  it('ignores an answer whose id is not the request in flight', async () => {
    const child = new ScriptedChild()
    const client = createExtractionProcess({ entryPath: 'x', fork: () => child, timeoutMs: 20 })
    const pending = client.extract(request(POPE))
    child.emit('message', { id: child.received[0].id + 100, ok: true, rows: [], durationMs: 1 })
    expect(errorCode(await pending)).toBe('EXTRACTION_TIMEOUT')
  })

  it('forks again after a process that exited while idle', async () => {
    const { fork, children } = fakeFork()
    const client = createExtractionProcess({ entryPath: 'x', fork })
    await client.extract(request(POPE))
    children[0].emit('exit', 0)
    await client.extract(request(POPE))
    expect(children).toHaveLength(2)
  })

  it('fails a request when the fork throws, and tries a fork again for the next', async () => {
    let attempts = 0
    const { fork } = fakeFork()
    const client = createExtractionProcess({
      entryPath: 'x',
      fork: (entryPath) => {
        attempts += 1
        if (attempts === 1) throw new TypeError('fork failed')
        return fork(entryPath)
      }
    })
    const first = client.extract(request(POPE))
    const second = client.extract(request(IRAN))
    const failed = await first
    expect(failed.ok ? null : failed.error.message).toBe('fork failed')
    expect((await second).ok).toBe(true)
    expect(attempts).toBe(2)
  })

  it('stops a process that cannot be sent the request, and forks a fresh one for the next', async () => {
    const refusing = new ScriptedChild()
    refusing.postMessage = () => {
      throw new Error('channel closed')
    }
    const { fork, children } = fakeFork()
    const forks = [refusing]
    const client = createExtractionProcess({
      entryPath: 'x',
      fork: (entryPath) => forks.shift() ?? fork(entryPath)
    })
    const failed = await client.extract(request(POPE))
    expect(failed.ok ? null : failed.error.message).toBe('channel closed')
    expect(refusing.kills).toBe(1)

    const next = await client.extract(request(IRAN))
    expect(children).toHaveLength(1)
    expect(next.ok && rowKeys(next.rows)).toEqual(FIXTURE_KNOWN_ANSWERS[IRAN])
  })

  it('wraps a non-Error thrown by the fork', async () => {
    const client = createExtractionProcess({
      entryPath: 'x',
      fork: () => {
        throw 'no process'
      }
    })
    const outcome = await client.extract(request(POPE))
    expect(outcome.ok ? null : outcome.error.message).toBe('no process')
  })

  it("fails rather than hangs where Electron's utilityProcess is absent, as in this runner", async () => {
    const client = createExtractionProcess({ entryPath: 'x' })
    const outcome = await client.extract(request(POPE))
    expect(outcome.ok).toBe(false)
  })

  it('stops the process on dispose and fails what it had not answered', async () => {
    const child = new ScriptedChild()
    const client = createExtractionProcess({ entryPath: 'x', fork: () => child })
    const inFlight = client.extract(request(POPE))
    const queued = client.extract(request(IRAN))
    client.dispose()
    expect(child.kills).toBe(1)
    expect(errorCode(await inFlight)).toBe('EXTRACTION_STOPPED')
    expect(errorCode(await queued)).toBe('EXTRACTION_STOPPED')
    expect(errorCode(await client.extract(request(POPE)))).toBe('EXTRACTION_STOPPED')
  })
})
