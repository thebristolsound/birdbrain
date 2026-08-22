// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { CaptureListRail } from '@renderer/components/captures/CaptureListRail'

function renderRail(props: Partial<Parameters<typeof CaptureListRail>[0]> = {}) {
  const onExpand = vi.fn()
  const onPrev = vi.fn()
  const onNext = vi.fn()
  render(
    <CaptureListRail
      captureCount={3}
      onExpand={onExpand}
      onPrev={onPrev}
      onNext={onNext}
      canGoPrev
      canGoNext
      {...props}
    />
  )
  return { onExpand, onPrev, onNext }
}

afterEach(cleanup)

describe('CaptureListRail', () => {
  it('expands from either the chevron or the capture count', () => {
    const { onExpand } = renderRail()

    fireEvent.click(screen.getByTitle('Expand capture list'))
    fireEvent.click(screen.getByTitle('3 captures'))

    expect(onExpand).toHaveBeenCalledTimes(2)
  })

  it('singularises the capture count', () => {
    renderRail({ captureCount: 1 })
    expect(screen.getByTitle('1 capture')).toBeDefined()
  })

  it('steps through captures without the list', () => {
    const { onPrev, onNext } = renderRail()

    fireEvent.click(screen.getByTitle('Previous capture'))
    fireEvent.click(screen.getByTitle('Next capture'))

    expect(onPrev).toHaveBeenCalledOnce()
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('disables the steppers at the ends of the list', () => {
    renderRail({ canGoPrev: false, canGoNext: false })

    expect(screen.getByTitle('Previous capture')).toHaveProperty('disabled', true)
    expect(screen.getByTitle('Next capture')).toHaveProperty('disabled', true)
  })
})
