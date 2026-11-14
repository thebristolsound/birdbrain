// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { Capture } from '@shared/types'

vi.mock('@renderer/lib/queries', () => ({
  useVerifyCapture: () => ({ isPending: false })
}))

import { ForensicsTab } from '@renderer/components/captures/ForensicsTab'
import { pinNonUtcTimeZone } from './timeZoneStub'

const legacyCapture: Capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/evidence',
  title: 'Example',
  hash: 'h',
  timestamp: '2026-08-01T12:00:00.000Z',
  createdAt: '2026-08-01T12:00:01.000Z',
  format: 'html',
  method: 'extension'
}

afterEach(cleanup)

describe('ForensicsTab', () => {
  // The legacy banner has no icon, so its text carries the warning colour itself.
  it('draws the legacy HTML banner text in the warning token', () => {
    render(<ForensicsTab capture={legacyCapture} caseId="case1" />)

    expect(screen.getByTestId('forensics-legacy-banner').className).toContain('text-warning-fg')
  })
})

// #1051: the record shows the attested time, so it must read the same on every machine.
describe('ForensicsTab capture times', () => {
  pinNonUtcTimeZone()

  it('renders Captured at and Created at in UTC, each from its own field', () => {
    render(
      <ForensicsTab
        capture={{
          ...legacyCapture,
          timestamp: '2026-08-01T21:04:05.000Z',
          createdAt: '2026-08-01T21:04:07.000Z'
        }}
        caseId="case1"
      />
    )

    expect(screen.getByText('Captured at').nextElementSibling?.textContent).toBe(
      'Aug 1, 2026 21:04:05 UTC'
    )
    expect(screen.getByText('Created at').nextElementSibling?.textContent).toBe(
      'Aug 1, 2026 21:04:07 UTC'
    )
  })
})
