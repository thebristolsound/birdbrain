import { useState, useEffect, useRef } from 'react'
import { MIN_THEATER_MS, MIN_STAGE_TIME_MS } from '@renderer/lib/motion'

interface TheaterOptions {
  stages: string[]
  minDuration?: number
  minStageTime?: number
  done?: boolean
  actualProgress?: number
}

interface TheaterState {
  stage: string
  progress: number
  isComplete: boolean
}

// Exported for testability — pure state machine with no React dependency
export function createTheaterMachine(options: Omit<TheaterOptions, 'done' | 'actualProgress'>) {
  const { stages, minDuration = MIN_THEATER_MS, minStageTime = MIN_STAGE_TIME_MS } = options
  let elapsed = 0
  let doneSignaled = false
  let doneAt: number | null = null
  let actualProgress = 0
  let highWaterProgress = 0

  function getState(): TheaterState {
    const totalMinTime = stages.length * minStageTime
    const paceProgress = Math.min(elapsed / totalMinTime, 1)

    // Blend paced progress with actual if provided
    const blended = actualProgress > 0 ? Math.max(paceProgress, actualProgress) : paceProgress

    // Never go backwards
    highWaterProgress = Math.max(highWaterProgress, blended)

    const stageIndex = Math.min(
      Math.floor(highWaterProgress * stages.length),
      stages.length - 1
    )

    const isComplete =
      doneSignaled && doneAt !== null && elapsed - doneAt >= minDuration

    return {
      stage: stages[stageIndex],
      progress: highWaterProgress,
      isComplete
    }
  }

  return {
    getState,
    tick(ms: number) {
      elapsed += ms
    },
    signalDone() {
      if (!doneSignaled) {
        doneSignaled = true
        doneAt = elapsed
      }
    },
    setActualProgress(p: number) {
      actualProgress = Math.max(0, Math.min(1, p))
    }
  }
}

export function useTheater(options: TheaterOptions): TheaterState {
  const {
    stages,
    minDuration = MIN_THEATER_MS,
    minStageTime = MIN_STAGE_TIME_MS,
    done = false,
    actualProgress = 0
  } = options
  const machineRef = useRef(createTheaterMachine({ stages, minDuration, minStageTime }))
  const [state, setState] = useState<TheaterState>(() => machineRef.current.getState())

  useEffect(() => {
    if (done) machineRef.current.signalDone()
  }, [done])

  useEffect(() => {
    machineRef.current.setActualProgress(actualProgress)
  }, [actualProgress])

  useEffect(() => {
    if (state.isComplete) return

    const interval = setInterval(() => {
      machineRef.current.tick(50)
      const next = machineRef.current.getState()
      setState(next)
      if (next.isComplete) clearInterval(interval)
    }, 50)

    return () => clearInterval(interval)
  }, [state.isComplete])

  return state
}
