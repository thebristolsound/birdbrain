import { describe, it, expect } from 'vitest'
import { CHART_SERIES, CHART_AXIS, CHART_GRID } from '@renderer/lib/chartColors'

describe('chartColors', () => {
  it('exposes the 20-color bar palette', () => {
    expect(CHART_SERIES).toHaveLength(20)
  })

  it('starts with the Recharts default four', () => {
    expect(CHART_SERIES.slice(0, 4)).toEqual(['#0088FE', '#00C49F', '#FFBB28', '#FF8042'])
  })

  it('contains only valid 6-digit hex colors', () => {
    for (const c of CHART_SERIES) expect(c).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('exposes zinc axis + grid colors', () => {
    expect(CHART_AXIS).toBe('#a1a1aa')
    expect(CHART_GRID).toBe('rgba(161,161,170,0.2)')
  })
})
