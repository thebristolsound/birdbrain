// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Note } from '@shared/types'
import { NoteListRow } from '@renderer/components/notes/NoteListRow'
import type { MentionResolver } from '@renderer/components/notes/mention/useMentionSources'
import { fakeBridge } from '../renderer/fakeBridge'

const note: Note = {
  id: 'note1',
  caseId: 'case1',
  captureId: 'cap1',
  title: 'A note',
  body: 'body text',
  bodyDoc: undefined,
  sourceUrl: undefined,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
}

const resolve: MentionResolver = () => ({ status: 'resolved', label: 'A capture', color: null })

function renderRow(view: 'detailed' | 'list') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(
    <NoteListRow note={note} selected={false} view={view} onSelect={() => {}} resolve={resolve} />,
    { wrapper: Wrapper }
  )
}

afterEach(cleanup)

describe('NoteListRow', () => {
  // The stored thumbnail is 4:3 and this box is wider, so object-cover crops it
  // vertically; the top is the part of the page worth showing (#1317).
  it('anchors the thumbnail crop to the top', async () => {
    fakeBridge({ captures: { getThumbnail: vi.fn(async () => 'thumb') } })
    renderRow('detailed')

    const { className } = await waitFor(() => {
      const img = screen.getByTestId('note-row-note1').querySelector('img')
      expect(img).not.toBeNull()
      return img!
    })
    expect(className.split(' ')).toEqual(expect.arrayContaining(['object-cover', 'object-top']))
  })
})
