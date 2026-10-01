// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { VerifyBar } from '@renderer/components/overview/VerifyBar'

const NONE = { verified: 0, unverified: 0, tampered: 0, chainBroken: 0, missing: 0 }

function legend(key: string): { count: string | null; label: string | null } {
  const [, count, label] = screen.getByTestId(`verify-legend-${key}`).children
  return { count: count.textContent, label: label.textContent }
}

afterEach(cleanup)

describe('VerifyBar', () => {
  it('labels each status on its own, in a fixed order', () => {
    render(<VerifyBar {...NONE} verified={1} />)

    const labels = screen
      .getAllByTestId(/^verify-legend-/)
      .map((el) => el.lastElementChild?.textContent)
    expect(labels).toEqual([
      'Verified',
      'Unverified',
      'Changed since capture',
      'Missing',
      'Chain broken'
    ])
  })

  it('shows a missing capture as Missing and draws no Changed since capture segment', () => {
    render(<VerifyBar {...NONE} verified={2} missing={1} />)

    expect(screen.getByTitle('Missing: 1')).toBeTruthy()
    expect(screen.queryByTitle(/^Changed since capture/)).toBeNull()
    expect(legend('missing')).toEqual({ count: '1', label: 'Missing' })
    expect(legend('tampered')).toEqual({ count: '0', label: 'Changed since capture' })
  })

  it('shows a chain-broken capture as Chain broken and draws no Changed since capture segment', () => {
    render(<VerifyBar {...NONE} verified={2} chainBroken={1} />)

    expect(screen.getByTitle('Chain broken: 1')).toBeTruthy()
    expect(screen.queryByTitle(/^Changed since capture/)).toBeNull()
    expect(legend('chainBroken')).toEqual({ count: '1', label: 'Chain broken' })
    expect(legend('tampered')).toEqual({ count: '0', label: 'Changed since capture' })
  })

  it('shows a capture whose stored bytes changed as Changed since capture', () => {
    render(<VerifyBar {...NONE} verified={2} tampered={1} />)

    expect(screen.getByTitle('Changed since capture: 1')).toBeTruthy()
    expect(legend('tampered')).toEqual({ count: '1', label: 'Changed since capture' })
    expect(legend('missing').count).toBe('0')
    expect(legend('chainBroken').count).toBe('0')
  })

  it('says there is nothing to verify when every count is zero', () => {
    render(<VerifyBar {...NONE} />)

    expect(screen.getByText('No captures to verify yet.')).toBeTruthy()
    expect(screen.queryByTestId('verify-legend-verified')).toBeNull()
  })
})
