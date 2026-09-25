// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AddUrlsBox } from '@renderer/components/captures/AddUrlsBox'
import { fakeBridge } from '../renderer/fakeBridge'

let enqueue: ReturnType<typeof vi.fn>

function renderBox(onQueued = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  render(<AddUrlsBox caseId="case1" onQueued={onQueued} />, { wrapper: Wrapper })
  return onQueued
}

function paste(value: string) {
  fireEvent.change(screen.getByTestId('add-urls-input'), { target: { value } })
  fireEvent.click(screen.getByTestId('add-urls-submit'))
}

beforeEach(() => {
  enqueue = vi.fn(async ({ urls }: { urls: string[] }) => ({ accepted: urls.length, rejected: [] }))
  fakeBridge({ recapture: { enqueue } })
})

afterEach(() => {
  cleanup()
})

describe('AddUrlsBox', () => {
  it('opens tall enough to show a multi-line paste', () => {
    renderBox()
    expect(screen.getByTestId('add-urls-input').getAttribute('rows')).toBe('4')
  })

  it('takes one entry per line, so a malformed line is one rejection', async () => {
    enqueue.mockResolvedValue({
      accepted: 1,
      rejected: [{ url: 'not a url', reason: 'invalid URL' }]
    })
    renderBox()

    paste('https://example.com/a\n\n  not a url  \r\nhttps://example.com/a\n')

    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1))
    expect(enqueue.mock.calls[0][0].urls).toEqual(['https://example.com/a', 'not a url'])
  })

  it('names each rejected entry beside its own reason', async () => {
    enqueue.mockResolvedValue({
      accepted: 0,
      rejected: [
        { url: 'ftp://example.com', reason: 'unsupported scheme' },
        { url: 'https://blocked.example', reason: 'blocked by exclusion rule *.example' }
      ]
    })
    const onQueued = renderBox()

    paste('ftp://example.com\nhttps://blocked.example')

    const list = await screen.findByTestId('add-urls-rejections')
    const items = [...list.querySelectorAll('li')].map((li) => li.textContent)
    expect(items).toEqual([
      'ftp://example.com: unsupported scheme',
      'https://blocked.example: blocked by exclusion rule *.example'
    ])
    expect(screen.getByTestId('add-urls-feedback').textContent).toContain('0 queued, 2 rejected')
    expect(onQueued).not.toHaveBeenCalled()
  })

  it('dismisses once everything queues cleanly', async () => {
    const onQueued = renderBox()
    paste('https://example.com/a\nhttps://example.com/b')

    await waitFor(() => expect(onQueued).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('add-urls-feedback').textContent).toBe('2 queued')
    expect(screen.queryByTestId('add-urls-rejections')).toBeNull()
  })

  it('reports a failed enqueue in place', async () => {
    enqueue.mockRejectedValue(new Error('queue offline'))
    renderBox()
    paste('https://example.com/a')

    expect((await screen.findByTestId('add-urls-feedback')).textContent).toBe('queue offline')
  })
})
