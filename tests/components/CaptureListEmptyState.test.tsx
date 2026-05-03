// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { CaptureListEmptyState } from '@renderer/components/captures/CaptureListEmptyState'
import { stubMatchMedia } from './matchMediaStub'

describe('CaptureListEmptyState', () => {
  beforeEach(() => {
    stubMatchMedia()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders headline and subcopy', () => {
    render(<CaptureListEmptyState />)
    expect(screen.getByText('No captures yet')).toBeDefined()
    expect(screen.getByText(/Browse the web with the Birdbrain extension active/i)).toBeDefined()
  })

  it('exposes a stable test id for layout', () => {
    render(<CaptureListEmptyState />)
    expect(screen.getByTestId('capture-list-empty-state')).toBeDefined()
  })
})
