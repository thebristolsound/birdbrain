type Job = {
  captureId: string
  status: 'pending' | 'running' | 'done' | 'failed'
}

type JobCallback = (captureId: string) => void

let queue: Job[] = []
let processing = false
let onComplete: JobCallback | null = null
let processFn: ((captureId: string) => Promise<void>) | null = null

export function initQueue(
  processor: (captureId: string) => Promise<void>,
  completionCallback?: JobCallback
): void {
  processFn = processor
  onComplete = completionCallback || null
}

export function enqueue(captureId: string): void {
  // Avoid duplicates (pending or running)
  if (queue.some((j) => j.captureId === captureId && (j.status === 'pending' || j.status === 'running'))) return
  queue.push({ captureId, status: 'pending' })
  processNext()
}

export function getQueueStatus(): { pending: number; running: number } {
  return {
    pending: queue.filter((j) => j.status === 'pending').length,
    running: queue.filter((j) => j.status === 'running').length
  }
}

export function clearQueue(): void {
  queue = queue.filter((j) => j.status === 'running')
}

export function resetQueue(): void {
  queue = []
  processing = false
  onComplete = null
  processFn = null
}

async function processNext(): Promise<void> {
  if (processing || !processFn) return

  const next = queue.find((j) => j.status === 'pending')
  if (!next) return

  processing = true
  next.status = 'running'

  try {
    await processFn(next.captureId)
    next.status = 'done'
    if (onComplete) onComplete(next.captureId)
  } catch (err) {
    next.status = 'failed'
    console.error(`Entity extraction failed for ${next.captureId}:`, err)
  } finally {
    processing = false
    // Clean up completed/failed
    queue = queue.filter((j) => j.status === 'pending' || j.status === 'running')
    processNext()
  }
}
