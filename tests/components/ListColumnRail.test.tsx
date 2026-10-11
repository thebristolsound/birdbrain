// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Camera } from 'lucide-react'
import { ListColumnRail } from '@renderer/components/layout/ListColumn'

function renderRail(props: Partial<Parameters<typeof ListColumnRail>[0]> = {}) {
  const onExpand = vi.fn()
  const onPrev = vi.fn()
  const onNext = vi.fn()
  render(
    <ListColumnRail
      noun="capture"
      icon={Camera}
      testId="capture-list-rail"
      count={3}
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

describe('ListColumnRail', () => {
  it('expands from either the chevron or the capture count', () => {
    const { onExpand } = renderRail()

    fireEvent.click(screen.getByTitle('Expand capture list'))
    fireEvent.click(screen.getByTitle('3 captures'))

    expect(onExpand).toHaveBeenCalledTimes(2)
  })

  it('singularises the capture count', () => {
    renderRail({ count: 1 })
    expect(screen.getByTitle('1 capture')).toBeDefined()
  })

  it('steps through captures without the list', () => {
    const { onPrev, onNext } = renderRail()

    fireEvent.click(screen.getByTitle('Previous capture'))
    fireEvent.click(screen.getByTitle('Next capture'))

    expect(onPrev).toHaveBeenCalledOnce()
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('names the items it stands in for', () => {
    renderRail({ noun: 'note', count: 2, testId: 'notes-list-rail' })

    expect(screen.getByTestId('notes-list-rail-expand').getAttribute('title')).toBe(
      'Expand note list'
    )
    expect(screen.getByTitle('2 notes')).toBeDefined()
    expect(screen.getByTitle('Next note')).toBeDefined()
  })

  it('disables the steppers at the ends of the list', () => {
    renderRail({ canGoPrev: false, canGoNext: false })

    expect(screen.getByTitle('Previous capture')).toHaveProperty('disabled', true)
    expect(screen.getByTitle('Next capture')).toHaveProperty('disabled', true)
  })
})
