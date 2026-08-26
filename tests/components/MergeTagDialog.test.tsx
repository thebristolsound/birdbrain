// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Tag } from '@shared/types'
import type { MergeTagsResult } from '@shared/ipc'
import { MergeTagDialog } from '@renderer/components/signals/MergeTagDialog'
import { fakeBridge } from '../renderer/fakeBridge'

const tags: Tag[] = [
  { id: 't-src', name: 'osint', color: '#ef4444' },
  { id: 't-dst', name: 'evidence', color: '#22c55e' },
  { id: 't-other', name: 'finance', color: '#3b82f6' }
]

const mergedResult: MergeTagsResult = {
  target: tags[1],
  captureLinks: 2,
  noteLinks: 1
}

let list: ReturnType<typeof vi.fn>
let merge: ReturnType<typeof vi.fn>

function renderDialog(overrides: { source?: { id: string; name: string } } = {}) {
  const onOpenChange = vi.fn()
  const onMerged = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  render(
    <MergeTagDialog
      open
      onOpenChange={onOpenChange}
      source={overrides.source ?? { id: 't-src', name: 'osint' }}
      onMerged={onMerged}
    />,
    { wrapper: Wrapper }
  )
  return { onOpenChange, onMerged }
}

beforeEach(() => {
  list = vi.fn(async () => tags)
  merge = vi.fn(async () => mergedResult)
  fakeBridge({ tags: { list, merge } })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MergeTagDialog targets', () => {
  it('offers every tag except the source as a merge target', async () => {
    renderDialog()

    expect(await screen.findByTestId('merge-target-t-dst')).toBeTruthy()
    expect(screen.getByTestId('merge-target-t-other')).toBeTruthy()
    expect(screen.queryByTestId('merge-target-t-src')).toBeNull()
  })

  it('says there is nothing to merge into when the source is the only tag', async () => {
    list.mockResolvedValue([tags[0]])
    renderDialog()

    expect(await screen.findByTestId('merge-tag-empty')).toBeTruthy()
    expect(screen.getByTestId('merge-tag-commit')).toHaveProperty('disabled', true)
  })

  // Tags are app-global, and the dialog is the only place the cross-case
  // blast radius gets said before the write — pinned so a copy edit that
  // drops it fails a test rather than a review.
  it('warns that the merge reaches every case and deletes the source', () => {
    renderDialog()

    expect(screen.getByText(/in every case, not only this one/)).toBeTruthy()
    expect(screen.getByText(/will be\s+deleted/)).toBeTruthy()
    expect(screen.getByText(/cannot be undone/)).toBeTruthy()
  })
})

describe('MergeTagDialog commit', () => {
  it('keeps the commit button disabled until a target is picked', async () => {
    renderDialog()

    const commit = screen.getByTestId('merge-tag-commit')
    expect(commit).toHaveProperty('disabled', true)
    expect(commit.textContent).toContain('Pick a tag to merge into')

    fireEvent.click(await screen.findByTestId('merge-target-t-dst'))

    expect(commit).toHaveProperty('disabled', false)
    // The button names the deletion — picking a target is not consent.
    expect(commit.textContent).toContain("Merge and delete 'osint'")
  })

  it('merges into the picked target, reports the survivor and closes', async () => {
    const { onOpenChange, onMerged } = renderDialog()

    fireEvent.click(await screen.findByTestId('merge-target-t-dst'))
    fireEvent.click(screen.getByTestId('merge-tag-commit'))

    await waitFor(() =>
      expect(merge).toHaveBeenCalledWith({ sourceId: 't-src', targetId: 't-dst' })
    )
    await waitFor(() => expect(onMerged).toHaveBeenCalledWith('t-dst'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does nothing until the commit button is pressed', async () => {
    renderDialog()

    fireEvent.click(await screen.findByTestId('merge-target-t-dst'))

    expect(merge).not.toHaveBeenCalled()
  })

  it('stays open with the pick intact when the merge fails', async () => {
    merge.mockRejectedValue(new Error('boom'))
    const { onOpenChange, onMerged } = renderDialog()

    fireEvent.click(await screen.findByTestId('merge-target-t-dst'))
    fireEvent.click(screen.getByTestId('merge-tag-commit'))

    await waitFor(() => expect(merge).toHaveBeenCalled())
    expect(onMerged).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByTestId('merge-target-t-dst').getAttribute('aria-checked')).toBe('true')
  })

  it('cancel closes without merging', async () => {
    const { onOpenChange } = renderDialog()

    fireEvent.click(await screen.findByText('Cancel'))

    expect(merge).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
