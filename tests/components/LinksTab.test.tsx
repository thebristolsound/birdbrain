// @vitest-environment jsdom
//
// The Links tab (#1708 D14): rows, filters, the In Case badge, the named empty states
// and the shared link menu.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture, CaptureLink, CaptureLinks, EgressSetting, FieldHit } from '@shared/types'
import type { WaybackLinkProgressEvent } from '@shared/ipc'
import { LinksTab } from '@renderer/components/captures/LinksTab'
import { notify } from '@renderer/lib/notify'
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
  {
    tabCapture = capture,
    cases = [] as Partial<Capture>[],
    hit = undefined as FieldHit | undefined
  } = {}
) {
  const getLinks = vi.fn(async () => answer)
  fakeBridge({ captures: { getLinks, list: vi.fn(async () => cases) } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  render(<LinksTab capture={tabCapture} hit={hit} />, { wrapper: Wrapper })
  return getLinks
}

function linkHit(overrides: Partial<FieldHit>): FieldHit {
  return {
    fieldId: 4,
    caseId: 'case1',
    exhibitId: 'cap1',
    exhibitNumber: 2,
    exhibitCitation: '2',
    contentHash: 'h',
    title: 'Story',
    field: 'link.href',
    preview: '/other',
    norm: 'https://news.example/other',
    occurrences: 1,
    locator: {
      source: 'html-part',
      part: 1,
      startOffset: 120,
      endOffset: 126,
      extractor: 'fields/1'
    },
    ...overrides
  }
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

  it('badges a same-page link to the viewed Capture as in the Case', async () => {
    renderTab(
      result([
        link({ href: 'https://news.example/held#comments', text: 'Comments', kind: 'same-page' })
      ]),
      { cases: [{ id: 'c2', url: 'https://news.example/held', timestamp: '2026-01-01T00:00:00Z' }] }
    )
    const [row] = await screen.findAllByTestId('links-row')
    await waitFor(() => expect(within(row).queryByTestId('links-in-case')).not.toBeNull())
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

  it('does not call the page link-free when embedded frames were skipped', async () => {
    renderTab(result([], { skippedParts: { tooLarge: 2, overPartCount: 0, overTotalSize: 0 } }))
    const notices = await screen.findAllByTestId('links-notice')
    expect(notices.map((n) => n.textContent)).toEqual([
      'Not listed: 2 embedded frames, each too large to read.'
    ])
    const empty = screen.getByTestId('links-empty').textContent
    expect(empty).toContain('No links in what was read')
    expect(empty).toContain('this page may hold links that are not listed')
    expect(empty).not.toContain('No links on this page')
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
        skippedParts: { tooLarge: 0, overPartCount: 0, overTotalSize: 0 }
      })
    )
    expect((await screen.findByTestId('links-empty')).textContent).toContain('too large')
  })

  it('lists the frames it could read with a notice when only the main document was skipped', async () => {
    renderTab(
      result([link({ frame: 'subframe' })], {
        mainDocumentSkipped: true,
        skippedParts: { tooLarge: 0, overPartCount: 0, overTotalSize: 0 }
      })
    )
    const notices = await screen.findAllByTestId('links-notice')
    expect(notices.map((n) => n.textContent)).toEqual([
      'The main document is too large to read; only links in its frames are listed.'
    ])
  })

  it('notes skipped frames under each reason, and a truncated list', async () => {
    renderTab(
      result([link({})], {
        skippedParts: { tooLarge: 2, overPartCount: 1, overTotalSize: 3 },
        truncated: true
      })
    )
    const notices = await screen.findAllByTestId('links-notice')
    expect(notices.map((n) => n.textContent)).toEqual([
      'Not listed: 2 embedded frames, each too large to read.',
      'Not listed: 1 embedded frame past the number of frames this tab reads.',
      'Not listed: 3 embedded frames past the total size this tab reads.',
      'Only the first 1 links are listed. Reading stopped there, so repeat counts cover the page up to that point.'
    ])
  })

  it('names only the reasons that applied', async () => {
    renderTab(
      result([link({})], { skippedParts: { tooLarge: 0, overPartCount: 0, overTotalSize: 1 } })
    )
    const notices = await screen.findAllByTestId('links-notice')
    expect(notices.map((n) => n.textContent)).toEqual([
      'Not listed: 1 embedded frame past the total size this tab reads.'
    ])
  })

  it('does not ask for links from a pre-MHTML capture, and says why', async () => {
    const getLinks = renderTab(null, { tabCapture: { ...capture, format: 'html' } })
    expect((await screen.findByTestId('links-empty')).textContent).toContain(
      'No link list for this capture'
    )
    expect(getLinks).not.toHaveBeenCalled()
  })

  // An import keeps a Capture's id unless it collides, so a deleted Capture's id can come
  // back with another archive behind it; a kept answer would then list the wrong page.
  it.each([
    ['another archive under the same id', result([link({ text: 'Before' })]), 'Before'],
    ['an archive that was missing', null, 'No stored page to read']
  ])('reads the archive again when the tab is reopened: %s', async (_name, first, firstText) => {
    const getLinks = vi.fn(async (): Promise<CaptureLinks | null> => first)
    fakeBridge({ captures: { getLinks, list: vi.fn(async () => []) } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tab = (
      <QueryClientProvider client={client}>
        <LinksTab capture={capture} />
      </QueryClientProvider>
    )
    const { unmount } = render(tab)
    expect(await screen.findByText(firstText)).toBeDefined()
    unmount()
    await new Promise((resolve) => setTimeout(resolve, 0))

    getLinks.mockImplementation(async () => result([link({ text: 'After' })]))
    render(tab)
    expect(await screen.findByText('After')).toBeDefined()
    expect(screen.queryByText(firstText)).toBeNull()
    expect(getLinks).toHaveBeenCalledTimes(2)
  })

  it('marks the rows a link target hit matches, and states its part and offsets once', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    renderTab(
      result([
        link({ text: 'Widget', href: 'https://widgets.example/w' }),
        link({}),
        link({ frame: 'subframe', documentUrl: 'https://frames.example/f' })
      ]),
      { hit: linkHit({}) }
    )
    const rows = await screen.findAllByTestId('links-row')
    expect(rows.map((row) => row.hasAttribute('data-link-hit'))).toEqual([false, true, true])
    // The subframe row shares the address but not the place, so no row carries offsets.
    expect(rows.map((row) => within(row).queryByTestId('links-hit')?.textContent)).toEqual([
      undefined,
      'Search hit, Link target',
      'Search hit, Link target'
    ])
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    expect(screen.getByTestId('links-notice').textContent).toBe(
      'Search hit, Link target, first found at part 1, characters 120 to 126. Every row with the same address is marked.'
    )
    delete (Element.prototype as Partial<Element>).scrollIntoView
  })

  it("matches an image alt text hit by the row's text", async () => {
    renderTab(result([link({}), link({ href: 'https://pay.example/', text: 'Pay here' })]), {
      hit: linkHit({ field: 'link.alt', preview: 'Pay  here', norm: 'Pay here' })
    })
    const rows = await screen.findAllByTestId('links-row')
    expect(rows.map((row) => row.hasAttribute('data-link-hit'))).toEqual([false, true])
    expect(within(rows[1]).getByTestId('links-hit').textContent).toBe('Search hit, Image alt text')
    expect(screen.getByTestId('links-notice').textContent).toContain(
      'Every row with the same text is marked.'
    )
  })

  it('marks no row for a hit on a field that is not a link, whatever its text', async () => {
    renderTab(
      result([link({ text: 'https://cdn.example/banner.png' }), link({ text: 'GTM-QX4R7T' })]),
      {
        hit: linkHit({
          field: 'image.src',
          preview: 'banner.png',
          norm: 'https://cdn.example/banner.png'
        })
      }
    )
    const rows = await screen.findAllByTestId('links-row')
    expect(rows.map((row) => row.hasAttribute('data-link-hit'))).toEqual([false, false])
    expect(screen.getByTestId('links-notice').textContent).toBe(
      'No listed link matches the search hit at part 1, characters 120 to 126.'
    )
  })

  it('says so when no listed link matches the hit', async () => {
    renderTab(result([link({})]), { hit: linkHit({ norm: 'https://gone.example/' }) })
    expect((await screen.findByTestId('links-notice')).textContent).toBe(
      'No listed link matches the search hit at part 1, characters 120 to 126.'
    )
    expect(screen.queryByTestId('links-hit')).toBeNull()
  })

  it("gives a pre-MHTML capture's hit its place in the stored page", async () => {
    renderTab(null, {
      tabCapture: { ...capture, format: 'html' },
      hit: linkHit({ locator: { ...linkHit({}).locator, part: 0, startOffset: 9, endOffset: 38 } })
    })
    expect((await screen.findByTestId('links-empty')).textContent).toContain(
      'The search hit is at characters 9 to 38 of the stored page.'
    )
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

// #1737, plan S6: a row's Wayback cell reads only the cache the link menu's lookup fills.
describe('LinksTab Wayback cell', () => {
  const SNAPSHOT = {
    timestamp: '2026-07-29T12:00:00.000Z',
    snapshotUrl: 'https://web.archive.org/web/20260729120000/https://a.example/1',
    originalUrl: 'https://a.example/1',
    statusCode: 200
  }
  const FOUND = {
    snapshots: [SNAPSHOT],
    closestIndex: 0,
    checkedAt: '2026-10-26T00:00:00.000Z',
    countIsMinimum: false
  }

  function renderWithLookup(
    links: CaptureLink[],
    lookupLink: (...args: never[]) => unknown,
    {
      openExternal = vi.fn(async (): Promise<void> => undefined),
      enqueue = vi.fn(async () => ({ accepted: 1, rejected: [] as unknown[] }))
    } = {}
  ) {
    fakeBridge({
      captures: {
        getLinks: vi.fn(async () => result(links)),
        list: vi.fn(async () => []),
        openExternal
      },
      wayback: { lookupLink },
      recapture: { enqueue }
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <LinksTab capture={capture} />
      </QueryClientProvider>
    )
    return { openExternal, enqueue }
  }

  async function lookUp(text: string) {
    fireEvent.contextMenu(await screen.findByText(text))
    fireEvent.click(await screen.findByTestId('context-menu-item-link-wayback'))
  }

  it('shows Not checked on each web row, asks nothing, and gives other rows no cell', async () => {
    const lookupLink = vi.fn()
    renderWithLookup(
      [
        link({ href: 'https://a.example/1', text: 'One' }),
        link({ href: 'mailto:desk@news.example', text: 'Mail', kind: 'mailto' })
      ],
      lookupLink
    )
    const rows = await screen.findAllByTestId('links-row')
    expect(within(rows[0]).getByTestId('links-wayback').textContent).toBe('Wayback:Not checked')
    expect(within(rows[1]).queryByTestId('links-wayback')).toBeNull()
    expect(lookupLink).not.toHaveBeenCalled()
  })

  it('looks a row up from its menu, then answers every row with that address', async () => {
    let answer: (value: unknown) => void = () => {}
    const lookupLink = vi.fn(() => new Promise((resolve) => (answer = resolve)))
    const success = vi.spyOn(notify, 'success')
    renderWithLookup(
      [
        link({ href: 'https://a.example/1', text: 'One' }),
        link({ href: 'https://a.example/1', text: 'One again' })
      ],
      lookupLink
    )
    await lookUp('One')

    await waitFor(() =>
      expect(screen.getAllByTestId('links-wayback')[0].textContent).toBe('Wayback:Checking…')
    )
    expect(lookupLink).toHaveBeenCalledExactlyOnceWith({
      captureId: 'cap1',
      url: 'https://a.example/1'
    })
    act(() => answer(FOUND))
    await waitFor(() => {
      for (const cell of screen.getAllByTestId('links-wayback')) {
        expect(cell.textContent).toContain('1 version, closest 3d before this page was captured')
      }
    })
    // The Page tab toasts its answer; here the cell is the answer.
    expect(success).not.toHaveBeenCalled()
  })

  it('offers Open at archive.org, Copy snapshot URL and Capture snapshot, and no pin', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { openExternal, enqueue } = renderWithLookup(
      [link({ href: 'https://a.example/1', text: 'One' })],
      vi.fn(async () => FOUND)
    )
    await lookUp('One')
    const cell = await screen.findByTestId('links-wayback')
    await waitFor(() => expect(within(cell).getByTestId('links-wayback-open')).toBeDefined())
    expect(
      within(cell)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Open at archive.org', 'Copy snapshot URL', 'Capture snapshot'])

    fireEvent.click(within(cell).getByTestId('links-wayback-open'))
    fireEvent.click(within(cell).getByTestId('links-wayback-copy'))
    fireEvent.click(within(cell).getByTestId('links-wayback-capture'))

    expect(openExternal).toHaveBeenCalledWith(SNAPSHOT.snapshotUrl)
    expect(writeText).toHaveBeenCalledWith(SNAPSHOT.snapshotUrl)
    // The replay URL with the toolbar, into the stored page's Case.
    await waitFor(() =>
      expect(enqueue).toHaveBeenCalledWith({
        urls: [SNAPSHOT.snapshotUrl],
        caseId: 'case1',
        supersedesCaptureId: undefined
      })
    )
  })

  async function snapshotCell() {
    await lookUp('One')
    const cell = await screen.findByTestId('links-wayback')
    await waitFor(() => expect(within(cell).getByTestId('links-wayback-open')).toBeDefined())
    return cell
  }

  it('says a Capture snapshot was queued only when the queue accepted it', async () => {
    const success = vi.spyOn(notify, 'success')
    const warn = vi.spyOn(notify, 'warn').mockImplementation(() => {})
    renderWithLookup(
      [link({ href: 'https://a.example/1', text: 'One' })],
      vi.fn(async () => FOUND)
    )
    fireEvent.click(within(await snapshotCell()).getByTestId('links-wayback-capture'))
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith('Snapshot capture queued', {
        description: SNAPSHOT.snapshotUrl
      })
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it('reports a refused Capture snapshot, and never as queued', async () => {
    const success = vi.spyOn(notify, 'success')
    const warn = vi.spyOn(notify, 'warn').mockImplementation(() => {})
    const enqueue = vi.fn(async () => ({
      accepted: 0,
      rejected: [{ url: SNAPSHOT.snapshotUrl, reason: 'excluded by case policy' }] as unknown[]
    }))
    renderWithLookup(
      [link({ href: 'https://a.example/1', text: 'One' })],
      vi.fn(async () => FOUND),
      { enqueue }
    )
    fireEvent.click(within(await snapshotCell()).getByTestId('links-wayback-capture'))
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('Snapshot not captured: excluded by case policy')
    )
    expect(success).not.toHaveBeenCalledWith('Snapshot capture queued', expect.anything())
  })

  it('reports a snapshot the browser could not open', async () => {
    const error = vi.spyOn(notify, 'error').mockImplementation(() => {})
    const openExternal = vi.fn(async (): Promise<void> => {
      throw new Error('no browser')
    })
    renderWithLookup(
      [link({ href: 'https://a.example/1', text: 'One' })],
      vi.fn(async () => FOUND),
      { openExternal }
    )
    fireEvent.click(within(await snapshotCell()).getByTestId('links-wayback-open'))
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Couldn't open the link in your browser", {
        cause: expect.any(Error)
      })
    )
  })

  it('says No successful snapshot for an empty answer', async () => {
    renderWithLookup(
      [link({ href: 'https://a.example/1', text: 'One' })],
      vi.fn(async () => ({ ...FOUND, snapshots: [], closestIndex: null }))
    )
    await lookUp('One')
    await waitFor(() =>
      expect(screen.getByTestId('links-wayback').textContent).toBe('Wayback:No successful snapshot')
    )
    expect(screen.queryByTestId('links-wayback-open')).toBeNull()
  })

  it('shows the error a failed lookup reports', async () => {
    renderWithLookup(
      [link({ href: 'https://a.example/1', text: 'One' })],
      vi.fn(async () => {
        throw new Error('Wayback CDX responded 503 Unavailable')
      })
    )
    await lookUp('One')
    await waitFor(() =>
      expect(screen.getByTestId('links-wayback').textContent).toBe(
        'Wayback:Wayback CDX responded 503 Unavailable'
      )
    )
  })

  it('turns the lookup off for a link to a private network, and sends nothing', async () => {
    const lookupLink = vi.fn()
    renderWithLookup([link({ href: 'http://intranet/wiki', text: 'Wiki' })], lookupLink)
    fireEvent.contextMenu(await screen.findByText('Wiki'))
    const item = await screen.findByTestId('context-menu-item-link-wayback')
    expect(item.textContent).toBe('Look up in Wayback (Points at a private network)')
    expect(item.getAttribute('data-disabled')).not.toBeNull()
    fireEvent.click(item)
    expect(lookupLink).not.toHaveBeenCalled()
  })
})

// #1738, plan S3 and S4: Look up all in Wayback, its confirmation, progress and cancel.
describe('LinksTab Wayback batch', () => {
  const DIRECT: EgressSetting = { kind: 'direct' }
  const ANSWER = {
    snapshots: [
      {
        timestamp: '2026-07-29T12:00:00.000Z',
        snapshotUrl: 'https://web.archive.org/web/20260729120000/https://a.example/1',
        originalUrl: 'https://a.example/1',
        statusCode: 200
      }
    ],
    closestIndex: 0,
    checkedAt: '2026-10-26T00:00:00.000Z',
    countIsMinimum: false
  }

  function renderBatch(
    links: CaptureLink[],
    {
      egress = DIRECT as EgressSetting,
      outcome = { answered: 0, failed: 0, notChecked: 0, stopped: null } as unknown
    } = {}
  ) {
    let finish: (value: unknown) => void = () => {}
    const lookupLinks = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const cancelLookupLinks = vi.fn(async () => true)
    const listeners: Array<(event: WaybackLinkProgressEvent) => void> = []
    fakeBridge({
      captures: { getLinks: vi.fn(async () => result(links)), list: vi.fn(async () => []) },
      wayback: { lookupLinks, cancelLookupLinks, lookupLink: vi.fn(async () => ANSWER) },
      settings: { get: vi.fn(async () => ({ egress })) },
      onWaybackLinkProgress: vi.fn((callback: (event: WaybackLinkProgressEvent) => void) => {
        listeners.push(callback)
        return () => {}
      })
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <QueryClientProvider client={client}>
        <LinksTab capture={capture} />
      </QueryClientProvider>
    )
    const emit = (event: WaybackLinkProgressEvent) =>
      act(() => listeners.forEach((listener) => listener(event)))
    return {
      lookupLinks,
      cancelLookupLinks,
      emit,
      finish: (value: unknown = outcome) => act(() => finish(value)),
      unmount: view.unmount
    }
  }

  async function openConfirmation() {
    fireEvent.click(await screen.findByTestId('wayback-batch-open'))
    return screen.findByTestId('wayback-batch-dialog')
  }

  const MIXED = [
    link({ href: 'https://a.example/1', text: 'One' }),
    link({ href: 'https://a.example/1', text: 'One again' }),
    link({ href: 'http://intranet/wiki', text: 'Wiki' }),
    link({ href: 'mailto:desk@news.example', text: 'Mail', kind: 'mailto' }),
    link({ href: 'https://b.example/2', text: 'Two' })
  ]

  it('lists every address it will send and every refused one, and sends nothing yet', async () => {
    const { lookupLinks } = renderBatch(MIXED)
    const dialog = await openConfirmation()
    expect(within(dialog).getByText('Look up 2 addresses in the Wayback Machine?')).toBeDefined()
    expect(
      within(within(dialog).getByTestId('wayback-batch-send'))
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual(['https://a.example/1', 'https://b.example/2'])
    const refused = within(dialog).getByTestId('wayback-batch-refused')
    expect(refused.textContent).toContain(
      '2 rows not sent. The address rule refuses these addresses:'
    )
    expect(
      within(refused)
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual([
      'http://intranet/wiki: Points at a private network',
      'mailto:desk@news.example: Not a web address'
    ])
    expect(dialog.textContent).toContain(
      'Each address below is sent to archive.org, which learns that it was asked about.'
    )
    await waitFor(() =>
      expect(dialog.textContent).toContain(
        "The requests leave over this computer's own connection, because the Egress is set to Direct."
      )
    )
    expect(within(dialog).queryByTestId('wayback-batch-over-cap')).toBeNull()

    fireEvent.click(within(dialog).getByTestId('wayback-batch-cancel'))
    await waitFor(() => expect(screen.queryByTestId('wayback-batch-dialog')).toBeNull())
    expect(lookupLinks).not.toHaveBeenCalled()
  })

  it('acts on the rows the search and External only show', async () => {
    const { lookupLinks } = renderBatch([
      link({ href: 'https://news.example/inside', text: 'Inside' }),
      link({ href: 'https://a.example/1', text: 'Outside one' }),
      link({ href: 'https://b.example/2', text: 'Outside two' })
    ])
    await screen.findAllByTestId('links-row')
    fireEvent.click(screen.getByLabelText('External only'))
    fireEvent.change(screen.getByLabelText('Search links'), { target: { value: 'two' } })
    const dialog = await openConfirmation()
    expect(within(dialog).getByTestId('wayback-batch-send').textContent).toBe('https://b.example/2')
    await waitFor(() =>
      expect(within(dialog).getByTestId('wayback-batch-confirm').hasAttribute('disabled')).toBe(
        false
      )
    )
    fireEvent.click(within(dialog).getByTestId('wayback-batch-confirm'))
    expect(lookupLinks).toHaveBeenCalledExactlyOnceWith({
      captureId: 'cap1',
      urls: ['https://b.example/2'],
      egress: DIRECT
    })
  })

  it('says only the first 50 are checked above the cap', async () => {
    renderBatch(
      Array.from({ length: 53 }, (_, i) =>
        link({ href: `https://site${i}.example/`, text: `Site ${i}` })
      )
    )
    const dialog = await openConfirmation()
    expect(within(dialog).getByTestId('wayback-batch-over-cap').textContent).toBe(
      'Only the first 50 addresses are checked. 3 more addresses are not checked.'
    )
    expect(
      within(within(dialog).getByTestId('wayback-batch-send')).getAllByRole('listitem')
    ).toHaveLength(50)
  })

  it('names a proxy Egress by its label, and not its address', async () => {
    renderBatch(MIXED, {
      egress: { kind: 'proxy', proxyUrl: 'socks5://10.0.0.5:1080', label: 'Office tunnel' }
    })
    const dialog = await openConfirmation()
    await waitFor(() =>
      expect(dialog.textContent).toContain(
        'The requests leave through the proxy set as the Egress ("Office tunnel").'
      )
    )
    expect(dialog.textContent).not.toContain('10.0.0.5')
  })

  it('sends nothing when the Egress setting cannot be read', async () => {
    const { lookupLinks } = renderBatch(MIXED, { egress: { kind: 'unavailable' } })
    const dialog = await openConfirmation()
    await waitFor(() =>
      expect(dialog.textContent).toContain(
        'The Egress setting could not be read, so nothing can be sent.'
      )
    )
    const confirm = within(dialog).getByTestId('wayback-batch-confirm')
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.click(confirm)
    expect(lookupLinks).not.toHaveBeenCalled()
  })

  async function startBatch(links: CaptureLink[] = MIXED, options = {}) {
    const batch = renderBatch(links, options)
    const dialog = await openConfirmation()
    await waitFor(() =>
      expect(within(dialog).getByTestId('wayback-batch-confirm').hasAttribute('disabled')).toBe(
        false
      )
    )
    fireEvent.click(within(dialog).getByTestId('wayback-batch-confirm'))
    await screen.findByTestId('wayback-batch-stop')
    return batch
  }

  const cells = () => screen.getAllByTestId('links-wayback').map((cell) => cell.textContent)

  it('updates every row that holds an address as its answer lands', async () => {
    const { emit, finish } = await startBatch()
    expect(screen.getByTestId('wayback-batch-status').textContent).toBe(
      'Checking in Wayback: 0 of 2 done.'
    )
    emit({ captureId: 'cap1', url: 'https://a.example/1', state: 'checking' })
    expect(cells()).toEqual([
      'Wayback:Checking…',
      'Wayback:Checking…',
      'Wayback:Not checked',
      'Wayback:Not checked'
    ])
    emit({ captureId: 'cap1', url: 'https://a.example/1', state: 'answered', result: ANSWER })
    emit({ captureId: 'cap1', url: 'https://b.example/2', state: 'checking' })
    emit({ captureId: 'cap1', url: 'https://b.example/2', state: 'failed', error: 'timed out' })
    const [first, second, , last] = cells()
    expect(first).toContain('1 version, closest 3d before this page was captured')
    expect(second).toContain('1 version, closest 3d before this page was captured')
    expect(last).toBe('Wayback:timed out')
    expect(screen.getByTestId('wayback-batch-status').textContent).toBe(
      'Checking in Wayback: 2 of 2 done.'
    )

    finish({ answered: 1, failed: 1, notChecked: 0, stopped: null })
    await waitFor(() =>
      expect(screen.getByTestId('wayback-batch-status').textContent).toBe(
        'Batch finished. 1 address answered, 1 failed.'
      )
    )
    expect(screen.getByTestId('wayback-batch-open')).toBeDefined()
  })

  it('shows a later menu lookup over an earlier batch failure', async () => {
    const { emit } = await startBatch()
    emit({ captureId: 'cap1', url: 'https://a.example/1', state: 'failed', error: 'timed out' })
    expect(cells()[0]).toBe('Wayback:timed out')
    await new Promise((resolve) => setTimeout(resolve, 2))
    fireEvent.contextMenu(screen.getByText('One'))
    fireEvent.click(await screen.findByTestId('context-menu-item-link-wayback'))
    await waitFor(() =>
      expect(cells()[0]).toContain('1 version, closest 3d before this page was captured')
    )
  })

  it('ignores progress for another capture', async () => {
    const { emit } = await startBatch()
    emit({ captureId: 'other', url: 'https://a.example/1', state: 'checking' })
    expect(cells()[0]).toBe('Wayback:Not checked')
  })

  it('returns a row archive.org refused to its earlier state, and reports the stop', async () => {
    const { emit, finish } = await startBatch()
    emit({ captureId: 'cap1', url: 'https://a.example/1', state: 'checking' })
    emit({ captureId: 'cap1', url: 'https://a.example/1', state: 'not-checked' })
    expect(cells()[0]).toBe('Wayback:Not checked')
    finish({ answered: 0, failed: 0, notChecked: 2, stopped: 'rate-limited', status: 429 })
    await waitFor(() =>
      expect(screen.getByTestId('wayback-batch-status').textContent).toBe(
        'archive.org answered HTTP 429, so the batch stopped. 0 addresses answered. 2 addresses not checked.'
      )
    )
  })

  it('cancels from the toolbar', async () => {
    const { cancelLookupLinks, finish } = await startBatch()
    fireEvent.click(screen.getByTestId('wayback-batch-stop'))
    expect(cancelLookupLinks).toHaveBeenCalledExactlyOnceWith('cap1')
    finish({ answered: 1, failed: 0, notChecked: 1, stopped: 'cancelled' })
    await waitFor(() =>
      expect(screen.getByTestId('wayback-batch-status').textContent).toBe(
        'Batch cancelled. 1 address answered. 1 address not checked.'
      )
    )
  })

  it('clears a row left checking when the batch fails, and shows why', async () => {
    const { emit } = renderBatch(MIXED)
    const lookupLinks = vi.fn(async () => {
      throw new Error('A Wayback batch is already running')
    })
    window.birdbrain.wayback.lookupLinks = lookupLinks
    const dialog = await openConfirmation()
    await waitFor(() =>
      expect(within(dialog).getByTestId('wayback-batch-confirm').hasAttribute('disabled')).toBe(
        false
      )
    )
    fireEvent.click(within(dialog).getByTestId('wayback-batch-confirm'))
    emit({ captureId: 'cap1', url: 'https://a.example/1', state: 'checking' })
    await waitFor(() =>
      expect(screen.getByTestId('wayback-batch-status').textContent).toBe(
        'A Wayback batch is already running'
      )
    )
    expect(cells()[0]).toBe('Wayback:Not checked')
  })

  it('cancels a running batch when the tab closes', async () => {
    const { cancelLookupLinks, unmount } = await startBatch()
    unmount()
    expect(cancelLookupLinks).toHaveBeenCalledExactlyOnceWith('cap1')
  })

  it('cancels nothing when the tab closes after the batch ended', async () => {
    const { cancelLookupLinks, finish, unmount } = await startBatch()
    finish()
    await screen.findByTestId('wayback-batch-open')
    unmount()
    expect(cancelLookupLinks).not.toHaveBeenCalled()
  })
})
