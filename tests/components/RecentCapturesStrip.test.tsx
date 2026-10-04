// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { Capture } from '@shared/types'

vi.mock('@renderer/hooks/useCaptureThumbnail', () => ({
  useCaptureThumbnail: () => ({ thumbnail: null, loading: false })
}))

import { RecentCapturesStrip } from '@renderer/components/overview/RecentCapturesStrip'

function capture(id: string, lastVerifiedStatus?: Capture['lastVerifiedStatus']): Capture {
  return {
    id,
    caseId: 'case1',
    url: `https://example.com/${id}`,
    title: id,
    hash: id,
    timestamp: '2026-08-02T00:00:00.000Z',
    createdAt: '2026-08-02T00:00:00.000Z',
    format: 'mhtml',
    method: 'extension',
    ...(lastVerifiedStatus ? { lastVerifiedStatus } : {})
  }
}

afterEach(() => cleanup())

it('gives the shield a text alternative that names each persisted outcome', () => {
  render(
    <RecentCapturesStrip
      captures={[
        capture('a', 'verified'),
        capture('b', 'tampered'),
        capture('c', 'chain-broken'),
        capture('d', 'legacy'),
        capture('e', 'verifier-too-old'),
        capture('f')
      ]}
      lastVisitAt={null}
      onOpen={vi.fn()}
    />
  )
  const labels = screen.getAllByRole('img').map((node) => node.getAttribute('aria-label'))
  expect(labels).toEqual([
    'Verified',
    'Verification failed',
    'Verification failed',
    'Legacy HTML',
    'Verifier too old',
    'Not yet verified'
  ])
})
