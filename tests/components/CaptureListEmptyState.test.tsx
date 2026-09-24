// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { CaptureListEmptyState } from '@renderer/components/captures/CaptureListEmptyState'
import { CLEAR_NARROWING_LABEL } from '@renderer/components/captures/captureListModel'
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

  it('draws the design tile: a 36px bordered canvas square, no corner badge', () => {
    render(<CaptureListEmptyState />)
    const tile = screen.getByTestId('capture-list-empty-state').firstElementChild as HTMLElement
    expect(tile.className).toContain('h-9')
    expect(tile.className).toContain('w-9')
    expect(tile.className).toContain('border-border')
    expect(tile.className).toContain('bg-canvas')
    expect(tile.parentElement?.querySelector('.bg-amber-500\\/10')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says nothing matches and offers the one clear control when narrowed', () => {
    const onClearNarrowing = vi.fn()
    render(<CaptureListEmptyState onClearNarrowing={onClearNarrowing} />)

    const empty = screen.getByTestId('capture-list-narrowed-empty')
    expect(empty.textContent).toContain('No captures match')
    expect(empty.textContent).toContain('Nothing in this case matches the current filters.')
    expect(screen.queryByTestId('capture-list-empty-state')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: CLEAR_NARROWING_LABEL }))
    expect(onClearNarrowing).toHaveBeenCalledTimes(1)
  })
})
