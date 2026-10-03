// @vitest-environment jsdom
//
// The Links tab (#1708 D14): rows, filters, the In Case badge, the named empty states
// and the shared link menu.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture, CaptureLink, CaptureLinks } from '@shared/types'
import { LinksTab } from '@renderer/components/captures/LinksTab'
import { fakeBridge } from '../renderer/fakeBridge'

const capture: Capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://news.example/story',
  title: 'Story',
  hash: 'h',
  timestamp: '2026-08-01T12:00:00.000Z',
  createdAt: '2026-08-01T12:00:01.000Z',
  format: 'mhtml',
  method: 'extension'
}

function link(overrides: Partial<CaptureLink>): CaptureLink {
  return {
    href: 'https://news.example/other',
    rawHref: '/other',
    text: 'Other story',
    rel: [],
    kind: 'http',
    frame: 'main',
    documentUrl: capture.url,
    occurrences: 1,
    textHostMismatch: false,
    ...overrides
  }
}

function result(links: CaptureLink[], overrides: Partial<CaptureLinks> = {}): CaptureLinks {
  return {
    links,
    truncated: false,
    skippedParts: { tooLarge: 0, overPartCount: 0, overTotalSize: 0 },
    mainDocumentSkipped: false,
    ...overrides
  }
}

function renderTab(
  answer: CaptureLinks | null,
  { tabCapture = capture, cases = [] as Partial<Capture>[] } = {}
) {
  const getLinks = vi.fn(async () => answer)
  fakeBridge({ captures: { getLinks, list: vi.fn(async () => cases) } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  render(<LinksTab capture={tabCapture} />, { wrapper: Wrapper })
  return getLinks
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('LinksTab', () => {
  it('lists each link with its text, host, kind, rel, frame and repeat count', async () => {
    renderTab(
      result([
        link({ rel: ['nofollow', 'sponsored'], occurrences: 3 }),
        link({
          href: 'https://widgets.example/w',
          text: 'Widget',
          frame: 'subframe',
          documentUrl: 'https://widgets.example/frame'
        })
      ])
    )
    const rows = await screen.findAllByTestId('links-row')
    expect(rows).toHaveLength(2)
    const first = within(rows[0])
    expect(first.getByText('Other story')).toBeDefined()
    expect(first.getByText('news.example').className).toContain('font-semibold')
    expect(first.getByText('rel=nofollow')).toBeDefined()
    expect(first.getByText('rel=sponsored')).toBeDefined()
    expect(first.getByText('×3')).toBeDefined()
    expect(first.getByText('web')).toBeDefined()
    expect(first.queryByTestId('links-subframe')).toBeNull()
    expect(within(rows[1]).getByTestId('links-subframe').getAttribute('title')).toBe(
      'In an embedded frame: https://widgets.example/frame'
    )
    expect(screen.getByTestId('links-count').textContent).toBe('2 of 2')
  })

  it('marks a row whose text names another host', async () => {
    renderTab(result([link({ textHostMismatch: true, text: 'bank.example' })]))
    expect(await screen.findByTestId('links-mismatch')).toBeDefined()
  })

  it('badges a link the Case already holds a Capture of, and no other', async () => {
    renderTab(
      result([
        link({ href: 'https://news.example/held#frag', text: 'Held' }),
        link({ href: 'https://news.example/not-held', text: 'Not held' })
      ]),
      { cases: [{ id: 'c2', url: 'https://news.example/held', timestamp: '2026-01-01T00:00:00Z' }] }
    )
    const rows = await screen.findAllByTestId('links-row')
    await waitFor(() => expect(within(rows[0]).queryByTestId('links-in-case')).not.toBeNull())
    expect(within(rows[1]).queryByTestId('links-in-case')).toBeNull()
  })

  it('filters by search text and by external only', async () => {
    renderTab(
      result([
        link({ text: 'Inside' }),
        link({ href: 'https://www.news.example/x', text: 'Own host with www' }),
        link({ href: 'https://elsewhere.example/', text: 'Outside' }),
        link({ href: 'mailto:desk@elsewhere.example', text: 'Mail', kind: 'mailto' })
      ])
    )
    await screen.findAllByTestId('links-row')

    fireEvent.change(screen.getByLabelText('Search links'), { target: { value: 'ELSEWHERE' } })
    expect(screen.getAllByTestId('links-row').map((r) => r.textContent)).toEqual([
      expect.stringContaining('Outside'),
      expect.stringContaining('Mail')
    ])

    fireEvent.click(screen.getByLabelText('External only'))
    expect(screen.getAllByTestId('links-row')).toHaveLength(1)
    expect(screen.getByTestId('links-count').textContent).toBe('1 of 4')

    fireEvent.change(screen.getByLabelText('Search links'), { target: { value: 'nothing' } })
    expect(screen.getByTestId('links-empty').textContent).toContain('No links match')
  })

  it('opens the link menu on the row right-clicked, and on the next one', async () => {
    renderTab(
      result([
        link({ href: 'https://a.example/1', text: 'One' }),
        link({ href: 'https://b.example/2', text: 'Two' })
      ])
    )
    const rows = await screen.findAllByTestId('links-row')

    fireEvent.contextMenu(within(rows[0]).getByText('One'))
    expect((await screen.findByRole('menu')).getAttribute('aria-label')).toBe(
      'Link actions: https://a.example/1'
    )
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    fireEvent.contextMenu(within(rows[1]).getByText('Two'))
    expect((await screen.findByRole('menu')).getAttribute('aria-label')).toBe(
      'Link actions: https://b.example/2'
    )
    expect(screen.getByTestId('context-menu-item-link-capture')).toBeDefined()
  })

  it('opens no menu off a row', async () => {
    renderTab(result([link({})]))
    const row = await screen.findByTestId('links-row')
    fireEvent.contextMenu(row.parentElement as HTMLElement)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('names the empty states', async () => {
    renderTab(result([]))
    expect((await screen.findByTestId('links-empty')).textContent).toContain(
      'No links on this page'
    )
  })

  it('says when the archive is missing', async () => {
    renderTab(null)
    expect((await screen.findByTestId('links-empty')).textContent).toContain(
      'No stored page to read'
    )
  })

  it('says when the main document was too large, rather than that there are no links', async () => {
    renderTab(
      result([], {
        mainDocumentSkipped: true,
        skippedParts: { tooLarge: 1, overPartCount: 0, overTotalSize: 0 }
      })
    )
    expect((await screen.findByTestId('links-empty')).textContent).toContain('too large')
  })

  it('lists the frames it could read with a notice when only the main document was skipped', async () => {
    renderTab(
      result([link({ frame: 'subframe' })], {
        mainDocumentSkipped: true,
        skippedParts: { tooLarge: 1, overPartCount: 0, overTotalSize: 0 }
      })
    )
    const notices = await screen.findAllByTestId('links-notice')
    expect(notices.map((n) => n.textContent)).toEqual([
      'The main document is too large to read; only links in its frames are listed.'
    ])
  })

  it('notes skipped frames and a truncated list', async () => {
    renderTab(
      result([link({})], {
        skippedParts: { tooLarge: 2, overPartCount: 0, overTotalSize: 0 },
        truncated: true
      })
    )
    const notices = await screen.findAllByTestId('links-notice')
    expect(notices.map((n) => n.textContent)).toEqual([
      'Some embedded frames are too large to read and are not listed.',
      'Only the first 1 links are listed.'
    ])
  })

  it('does not ask for links from a pre-MHTML capture, and says why', async () => {
    const getLinks = renderTab(null, { tabCapture: { ...capture, format: 'html' } })
    expect((await screen.findByTestId('links-empty')).textContent).toContain(
      'No link list for this capture'
    )
    expect(getLinks).not.toHaveBeenCalled()
  })

  it('reports a failed read', async () => {
    fakeBridge({
      captures: {
        getLinks: vi.fn(async () => {
          throw new Error('disk gone')
        }),
        list: vi.fn(async () => [])
      }
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <LinksTab capture={capture} />
      </QueryClientProvider>
    )
    expect((await screen.findByTestId('links-empty')).textContent).toContain(
      "Couldn't read the stored page"
    )
  })
})
