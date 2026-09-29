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
    expect(labels).toEqual(['Verified', 'Unverified', 'Tampered', 'Missing', 'Chain broken'])
  })

  it('shows a missing capture as Missing and draws no Tampered segment', () => {
    render(<VerifyBar {...NONE} verified={2} missing={1} />)

    expect(screen.getByTitle('Missing: 1')).toBeTruthy()
    expect(screen.queryByTitle(/^Tampered/)).toBeNull()
    expect(legend('missing')).toEqual({ count: '1', label: 'Missing' })
    expect(legend('tampered')).toEqual({ count: '0', label: 'Tampered' })
  })

  it('shows a chain-broken capture as Chain broken and draws no Tampered segment', () => {
    render(<VerifyBar {...NONE} verified={2} chainBroken={1} />)

    expect(screen.getByTitle('Chain broken: 1')).toBeTruthy()
    expect(screen.queryByTitle(/^Tampered/)).toBeNull()
    expect(legend('chainBroken')).toEqual({ count: '1', label: 'Chain broken' })
    expect(legend('tampered')).toEqual({ count: '0', label: 'Tampered' })
  })

  it('still shows a tampered capture as Tampered', () => {
    render(<VerifyBar {...NONE} verified={2} tampered={1} />)

    expect(screen.getByTitle('Tampered: 1')).toBeTruthy()
    expect(legend('tampered')).toEqual({ count: '1', label: 'Tampered' })
    expect(legend('missing').count).toBe('0')
    expect(legend('chainBroken').count).toBe('0')
  })

  it('says there is nothing to verify when every count is zero', () => {
    render(<VerifyBar {...NONE} />)

    expect(screen.getByText('No captures to verify yet.')).toBeTruthy()
    expect(screen.queryByTestId('verify-legend-verified')).toBeNull()
  })
})
