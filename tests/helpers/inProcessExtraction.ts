import { EventEmitter } from 'events'
import {
  createExtractionProcess,
  type ExtractionChild,
  type ExtractionClient,
  type ExtractionProcessDeps
} from '@main/services/extraction/processClient'
import {
  handleExtractionMessage,
  type ExtractionRequestMessage
} from '@main/services/extraction/processHandler'

// Stand-ins for the extraction utility process (#598). The unit runner sets
// ELECTRON_RUN_AS_NODE, where Electron's utilityProcess does not exist, so a
// test drives the real client with a child that answers by calling the
// process's message handler here, on a later turn, as the real process does.

export type FakeChildBehaviour = 'answer' | 'exit' | 'hang'

export class FakeExtractionChild extends EventEmitter implements ExtractionChild {
  readonly received: ExtractionRequestMessage[] = []
  killed = false

  constructor(private readonly behaviour: FakeChildBehaviour = 'answer') {
    super()
  }

  postMessage(message: ExtractionRequestMessage): void {
    this.received.push(message)
    // A timer rather than setImmediate, so a test counting setImmediate calls
    // counts only the lifecycle's own.
    setTimeout(() => {
      if (this.killed) return
      if (this.behaviour === 'answer') this.emit('message', handleExtractionMessage(message))
      if (this.behaviour === 'exit') this.emit('exit', 1)
    }, 0)
  }

  kill(): boolean {
    if (this.killed) return false
    this.killed = true
    setTimeout(() => this.emit('exit', 0), 0)
    return true
  }
}

// Forks one fake per call, taking each one's behaviour from `behaviours` in
// order and answering with the handler once the list runs out.
export function fakeFork(behaviours: FakeChildBehaviour[] = []): {
  fork: NonNullable<ExtractionProcessDeps['fork']>
  children: FakeExtractionChild[]
} {
  const children: FakeExtractionChild[] = []
  const fork = (): FakeExtractionChild => {
    const child = new FakeExtractionChild(behaviours[children.length] ?? 'answer')
    children.push(child)
    return child
  }
  return { fork, children }
}

export function inProcessExtraction(
  overrides: Partial<ExtractionProcessDeps> = {}
): ExtractionClient {
  return createExtractionProcess({
    entryPath: 'extraction.js',
    fork: fakeFork().fork,
    ...overrides
  })
}
