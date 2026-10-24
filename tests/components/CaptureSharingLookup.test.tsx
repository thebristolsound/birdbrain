import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Capture } from '@shared/types'
import { CaptureItem } from '@renderer/components/captures/CaptureItem'
import { useCaptureSharing } from '@renderer/components/sharing/useCaptureSharing'
import { fakeBridge } from '../renderer/fakeBridge'
import { CASE_ID, members, snapshot, MERGE_31 } from './sharingFixtures'

vi.mock('@renderer/hooks/useCaptureThumbnail', () => ({
  useCaptureThumbnail: () => ({ thumbnail: null, loading: false })
}))

afterEach(cleanup)

it.each([true, false])(
  'shares one lookup and uses the snapshot verdict, valid=%s',
  async (valid) => {
    const captures: Capture[] = Array.from({ length: 60 }, (_, index) => ({
      id: `capture-${index}`,
      caseId: CASE_ID,
      title: `Capture ${index}`,
      url: 'https://example.com',
      hash: 'h',
      timestamp: MERGE_31.timestamp,
      createdAt: MERGE_31.timestamp,
      format: 'mhtml',
      method: 'extension',
      operatorId: 'inst-nk',
      exhibitCitation: `NK-${index + 1}`
    }))
    const state = snapshot(
      captures.map((capture, index) => ({
        ...MERGE_31,
        type: 'exclude' as const,
        exhibitId: capture.id,
        authorInstallationId: 'inst-nk',
        index: index + 32
      }))
    )
    if (!valid) state.chain = { valid: false, brokenAt: 32, reason: 'signature mismatch' }
    let entryReads = 0
    fakeBridge({
      sharing: { getMembers: vi.fn(async () => members()) },
      manifest: {
        snapshot: vi.fn(async () => ({
          ...state,
          get entries() {
            entryReads += 1
            return state.entries
          }
        }))
      }
    })
    function Rows() {
      const sharing = useCaptureSharing(CASE_ID, true)
      return (
        <div>
          {sharing.snapshot && <span data-testid="lookup-ready" />}
          {captures.map((capture) => (
            <CaptureItem
              key={capture.id}
              capture={capture}
              isSelected={false}
              sharing={sharing}
              onClick={() => {}}
            />
          ))}
        </div>
      )
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Rows />
      </QueryClientProvider>
    )
    await screen.findByTestId('lookup-ready')
    expect(screen.queryAllByTestId('capture-excluded-pill')).toHaveLength(
      valid ? captures.length : 0
    )
    expect(entryReads).toBeLessThan(10)
  }
)
