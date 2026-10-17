import { readFileSync } from 'fs'
import { join } from 'path'
import type { RecordedEvent, ResponseBodyResult } from '../../collector'

// `renderer-spike-streams.json` holds, unmodified, the `events` of eight runs from the step 0
// event file named in its `source`. Step 0 recorded no session id, so each stream is read as the
// page's own session.

interface SpikeRun {
  name: string
  events: Array<{ method: string; params: unknown }>
}

const { runs } = JSON.parse(
  readFileSync(join(__dirname, 'renderer-spike-streams.json'), 'utf8')
) as { runs: SpikeRun[] }

export const SPIKE_RUNS = runs.map(({ name }) => name)

export const spikeStream = (name: string): RecordedEvent[] => {
  const run = runs.find((candidate) => candidate.name === name)
  if (run === undefined) throw new Error(`No step 0 run named ${name}`)
  return run.events.map(({ method, params }) => ({ sessionId: '', method, params }))
}

/** Step 0 fetched no body, so each finished request gets an invented one. */
export const inventedBodies = (events: RecordedEvent[]): Map<string, ResponseBodyResult> =>
  new Map(
    events
      .filter(({ method }) => method === 'Network.loadingFinished')
      .map(({ params }) => {
        const { requestId } = params as { requestId: string }
        return [requestId, { body: `body of ${requestId}`, base64Encoded: false }]
      })
  )
