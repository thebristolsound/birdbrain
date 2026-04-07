import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTheaterMachine } from '@renderer/hooks/useTheater'

// We test the pure logic, not the React hook wrapper
// Extract the theater state machine logic for testability

describe('theater state machine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('advances through stages over time', () => {
    const machine = createTheaterMachine({
      stages: ['receiving', 'processing', 'done'],
      minDuration: 800,
      minStageTime: 250
    })

    expect(machine.getState().stage).toBe('receiving')
    expect(machine.getState().progress).toBe(0)

    machine.tick(300)
    expect(machine.getState().stage).toBe('processing')

    machine.tick(300)
    expect(machine.getState().stage).toBe('done')
  })

  it('holds final stage until minDuration elapses after done signal', () => {
    const machine = createTheaterMachine({
      stages: ['receiving', 'processing'],
      minDuration: 800,
      minStageTime: 250
    })

    // Signal done immediately
    machine.signalDone()
    machine.tick(250)
    expect(machine.getState().isComplete).toBe(false)

    machine.tick(600)
    expect(machine.getState().isComplete).toBe(true)
  })

  it('progress never goes backwards', () => {
    const machine = createTheaterMachine({
      stages: ['a', 'b'],
      minDuration: 600,
      minStageTime: 200
    })

    machine.tick(200)
    const p1 = machine.getState().progress

    machine.tick(100)
    const p2 = machine.getState().progress

    expect(p2).toBeGreaterThanOrEqual(p1)
  })

  it('blends actual progress when provided', () => {
    const machine = createTheaterMachine({
      stages: ['uploading'],
      minDuration: 800,
      minStageTime: 250
    })

    machine.setActualProgress(0.8)
    machine.tick(100)
    // Progress should reflect actual progress blended with pacing
    expect(machine.getState().progress).toBeGreaterThan(0)
  })
})
