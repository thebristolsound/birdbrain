import { describe, it, expect } from 'vitest'
import { renderAnnotationsSvg } from '@main/services/renderAnnotationsSvg'
import type { AnnotationShape } from '@shared/types'

describe('renderAnnotationsSvg', () => {
  it('returns empty SVG for empty shapes', () => {
    const svg = renderAnnotationsSvg([], 100, 80)
    expect(svg).toContain('<svg')
    expect(svg).toContain('width="100"')
    expect(svg).toContain('height="80"')
    expect(svg).toContain('viewBox="0 0 100 80"')
  })

  it('renders a rect', () => {
    const shapes: AnnotationShape[] = [
      { kind: 'rect', id: 'a', x: 10, y: 20, w: 30, h: 40, stroke: '#ff0000', strokeWidth: 3 }
    ]
    const svg = renderAnnotationsSvg(shapes, 100, 100)
    expect(svg).toContain('<rect')
    expect(svg).toContain('x="10"')
    expect(svg).toContain('y="20"')
    expect(svg).toContain('width="30"')
    expect(svg).toContain('height="40"')
    expect(svg).toContain('stroke="#ff0000"')
    expect(svg).toContain('fill="none"')
  })

  it('renders a highlight as a translucent rect', () => {
    const svg = renderAnnotationsSvg(
      [{ kind: 'highlight', id: 'h', x: 0, y: 0, w: 10, h: 10, color: '#ffff00' }],
      100,
      100
    )
    expect(svg).toContain('fill="#ffff00"')
    expect(svg).toContain('fill-opacity="0.4"')
  })

  it('renders a redact as solid black', () => {
    const svg = renderAnnotationsSvg(
      [{ kind: 'redact', id: 'r', x: 5, y: 5, w: 20, h: 20, mode: 'solid' }],
      100,
      100
    )
    expect(svg).toContain('fill="#000000"')
  })

  it('renders an arrow with marker-end', () => {
    const svg = renderAnnotationsSvg(
      [
        { kind: 'arrow', id: 'ar', x1: 0, y1: 0, x2: 50, y2: 50, stroke: '#00ff00', strokeWidth: 2 }
      ],
      100,
      100
    )
    expect(svg).toContain('<defs>')
    expect(svg).toContain('marker')
    expect(svg).toContain('<line')
    expect(svg).toContain('x1="0"')
    expect(svg).toContain('x2="50"')
    expect(svg).toContain('marker-end="url(#arrow)"')
  })

  it('renders a pin as numbered circle', () => {
    const svg = renderAnnotationsSvg(
      [{ kind: 'pin', id: 'p', x: 25, y: 35, number: 7, pinId: 'pin-7' }],
      100,
      100
    )
    expect(svg).toContain('<circle')
    expect(svg).toContain('cx="25"')
    expect(svg).toContain('cy="35"')
    expect(svg).toContain('>7</text>')
  })
})
