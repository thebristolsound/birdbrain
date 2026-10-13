// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { Capture } from '@shared/types'

vi.mock('@renderer/lib/queries', () => ({
  useVerifyCapture: () => ({ isPending: false })
}))

import { ForensicsTab } from '@renderer/components/captures/ForensicsTab'

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
