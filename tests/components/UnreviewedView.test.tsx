// @vitest-environment jsdom
//
// The unreviewed view (docs/plans/2026-10-09-case-retrieval-first-slice.md, D8): its
// groups, its text, how a listed Capture opens, and the rare-identifier limit.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { FieldHit, UnreviewedCaptures, UnreviewedRow } from '@shared/types'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate
}))

import { UnreviewedView, unreviewedNotes } from '@renderer/components/data/UnreviewedView'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'

function hit(overrides: Partial<FieldHit> = {}): FieldHit {
  return {
    fieldId: 11,
    caseId: 'case1',
    exhibitId: 'cap-mail',
    exhibitNumber: 4,
    exhibitCitation: '4',
    contentHash: 'c'.repeat(64),
    title: 'Original message',
    field: 'header.from',
    preview: 'Wren Hollis <wren@hollis-mail.example.org>',
    norm: 'wren@hollis-mail.example.org',
    occurrences: 1,
    locator: { source: 'text', part: null, startOffset: 20, endOffset: 62, extractor: 'fields/1' },
    ...overrides
  }
}

const FROM_HIT = hit()
const REPLY_HIT = hit({
  fieldId: 12,
  field: 'header.reply-to',
  preview: '<pay@corvane.example.net>',
  norm: 'pay@corvane.example.net'
})
const LINK_HIT = hit({
  fieldId: 13,
  exhibitId: 'cap-forum',
  exhibitNumber: 7,
  exhibitCitation: '7',
  title: 'Forum thread',
  field: 'link.href',
  preview: 'https://northgate.example.com/pay',
  norm: 'https://northgate.example.com/pay',
  locator: { source: 'html-part', part: 0, startOffset: 40, endOffset: 73, extractor: 'fields/1' }
})

function keyed(key: string, captures: UnreviewedRow['captures']): UnreviewedRow {
  return { key, identifier: null, caseCaptures: null, captures }
}

const MAIL = { exhibitId: 'cap-mail', exhibitCitation: '4', title: 'Original message' }
const FORUM = { exhibitId: 'cap-forum', exhibitCitation: '7', title: 'Forum thread' }

function result(overrides: Partial<UnreviewedCaptures> = {}): UnreviewedCaptures {
  return {
    captures: 10,
    total: 3,
    ungrouped: 1,
    notCurrent: 0,
    partial: 0,
    rareLimit: 2,
    groups: {
      from: [keyed('wren@hollis-mail.example.org', [{ ...MAIL, hit: FROM_HIT }])],
      'reply-to': [keyed('pay@corvane.example.net', [{ ...MAIL, hit: REPLY_HIT }])],
      'link-host': [
        keyed('northgate.example.com', [{ ...FORUM, hit: LINK_HIT }]),
        keyed('ledger.example.org', [
          { ...FORUM, hit: LINK_HIT },
          { ...MAIL, hit: hit({ field: 'link.href', locator: LINK_HIT.locator }) }
        ])
      ],
      rare: [
        {
          key: 'ada.penrose@larchfield.example.org',
          identifier: { category: 'Infrastructure', subcategory: 'Email Address' },
          caseCaptures: 2,
          captures: [{ ...MAIL, hit: null }]
        }
      ]
    },
    ...overrides
  }
}

let listUnreviewed: ReturnType<typeof vi.fn>

function stub(...answers: Array<UnreviewedCaptures | Error>) {
  listUnreviewed = vi.fn()
  for (const answer of answers) {
    if (answer instanceof Error) listUnreviewed.mockRejectedValueOnce(answer)
    else listUnreviewed.mockResolvedValueOnce(answer)
  }
  listUnreviewed.mockResolvedValue(answers.find((a) => !(a instanceof Error)) ?? result())
  fakeBridge({ cases: { listUnreviewed } })
}

function renderView(onTotal?: (total: number) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  const view = render(<UnreviewedView caseId="case1" onTotal={onTotal} />, { wrapper: Wrapper })
  return { ...view, client }
}

const GROUP_IDS: Record<string, string> = {
  From: 'from',
  'Reply-To': 'reply-to',
  'Link host': 'link-host',
  'Rare identifiers': 'rare'
}

function button(text: string): HTMLButtonElement {
  const group = GROUP_IDS[text]
  const label = group
    ? screen.getByTestId(`unreviewed-group-${group}`)
    : screen.getAllByTestId('unreviewed-row-key').find((key) => key.textContent === text)!
  return label.closest('button')!
}

const pick = (text: string) => fireEvent.click(button(text))

beforeEach(() => {
  navigate.mockClear()
  useAppStore.setState({ viewerHit: null, activeViewerTab: 'screenshot', selectedCaptureId: null })
})

afterEach(() => cleanup())

describe('UnreviewedView', () => {
  it('lists the four groups with their row counts, the picked group, and its rows', async () => {
    stub(result())
    renderView()
    await screen.findByTestId('unreviewed-view')
    const groups = ['From', 'Reply-To', 'Link host', 'Rare identifiers'].map(
      (label) => button(label).textContent
    )
    expect(groups).toEqual(['From1', 'Reply-To1', 'Link host2', 'Rare identifiers1'])
    // From is picked when the view opens.
    expect(button('wren@hollis-mail.example.org').textContent).toBe(
      'wren@hollis-mail.example.org1 capture'
    )
    expect(screen.getByText('Select a row')).toBeTruthy()

    pick('Link host')
    expect(button('ledger.example.org').textContent).toBe('ledger.example.org2 captures')
    pick('ledger.example.org')
    expect(screen.getByTestId('unreviewed-capture-cap-forum').textContent).toBe(
      'Exhibit 7Forum thread'
    )
    expect(screen.getByTestId('unreviewed-capture-cap-mail').textContent).toBe(
      'Exhibit 4Original message'
    )

    pick('Rare identifiers')
    expect(button('ada.penrose@larchfield.example.org').textContent).toBe(
      'Email Addressada.penrose@larchfield.example.org1 unreviewed, 2 in the case'
    )
  })

  it('says how many Captures it lists and the rule, and what the other counts mean', async () => {
    stub(result({ ungrouped: 2, notCurrent: 3, partial: 4, total: 631 }))
    renderView()
    const header = await screen.findByTestId('unreviewed-header')
    expect([...header.children].map((child) => child.textContent)).toEqual([
      '631 unreviewed captures',
      'No note names them and no selector matched them.',
      '2 of them are in no group.',
      '3 have no current link and header records, so they are not in the From, Reply-To or link host groups.',
      '4 have link and header records that a size limit cut short, so those groups may leave some of their values out.'
    ])
  })

  it('words one of each in the singular, and leaves out a count of 0', async () => {
    expect(unreviewedNotes({ ungrouped: 1, notCurrent: 1, partial: 1 })).toEqual([
      '1 of them is in no group.',
      '1 has no current link and header records, so it is not in the From, Reply-To or link host groups.',
      '1 has link and header records that a size limit cut short, so those groups may leave some of its values out.'
    ])
    expect(unreviewedNotes({ ungrouped: 0, notCurrent: 0, partial: 0 })).toEqual([])
    stub(result({ total: 1, ungrouped: 0 }))
    renderView()
    const header = await screen.findByTestId('unreviewed-header')
    expect([...header.children].map((child) => child.textContent)).toEqual([
      '1 unreviewed capture',
      'No note names it and no selector matched it.'
    ])
  })

  it('says when the Case has no Captures, and when every Capture is reviewed', async () => {
    stub(result({ captures: 0, total: 0, ungrouped: 0 }))
    const first = renderView()
    expect((await screen.findByTestId('unreviewed-empty')).textContent).toBe(
      'This case has no captures yet.'
    )
    first.unmount()
    stub(result({ captures: 4, total: 0, ungrouped: 0 }))
    renderView()
    expect((await screen.findByTestId('unreviewed-empty')).textContent).toBe(
      'Every capture in this case has a note or a selector match.'
    )
  })

  it('shows a failed read with its reason, and Retry reads again', async () => {
    stub(new Error('database is locked'), result())
    renderView()
    expect((await screen.findByTestId('unreviewed-error')).textContent).toBe(
      'Failed to load the unreviewed captures: database is locked'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('unreviewed-view')).toBeTruthy()
    expect(listUnreviewed).toHaveBeenCalledTimes(2)
  })

  it('opens a From or Reply-To Capture at its header in the Text tab', async () => {
    stub(result())
    renderView()
    await screen.findByTestId('unreviewed-view')
    pick('wren@hollis-mail.example.org')
    fireEvent.click(screen.getByTestId('unreviewed-capture-cap-mail'))
    expect(useAppStore.getState()).toMatchObject({
      selectedCaptureId: 'cap-mail',
      viewerHit: FROM_HIT,
      activeViewerTab: 'text'
    })
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case1' }
    })

    pick('Reply-To')
    pick('pay@corvane.example.net')
    fireEvent.click(screen.getByTestId('unreviewed-capture-cap-mail'))
    expect(useAppStore.getState().viewerHit).toEqual(REPLY_HIT)
  })

  it('opens a link host Capture at its link in the Links tab', async () => {
    stub(result())
    renderView()
    await screen.findByTestId('unreviewed-view')
    pick('Link host')
    pick('northgate.example.com')
    fireEvent.click(screen.getByTestId('unreviewed-capture-cap-forum'))
    expect(useAppStore.getState()).toMatchObject({
      selectedCaptureId: 'cap-forum',
      viewerHit: LINK_HIT,
      activeViewerTab: 'links'
    })
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('opens a rare identifier Capture with no hit, clearing one left for that Capture', async () => {
    stub(result())
    useAppStore.setState({ selectedCaptureId: 'cap-mail', viewerHit: FROM_HIT })
    renderView()
    await screen.findByTestId('unreviewed-view')
    pick('Rare identifiers')
    pick('ada.penrose@larchfield.example.org')
    fireEvent.click(screen.getByTestId('unreviewed-capture-cap-mail'))
    expect(useAppStore.getState()).toMatchObject({ selectedCaptureId: 'cap-mail', viewerHit: null })
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case1' }
    })
  })

  it('starts the limit at 2, reads again for a whole number of at least 1, and never sends another', async () => {
    stub(result())
    const view = renderView()
    await screen.findByTestId('unreviewed-view')
    expect(listUnreviewed).toHaveBeenLastCalledWith('case1', 2)
    const limit = () => screen.getByTestId('unreviewed-rare-limit') as HTMLInputElement
    expect(limit().value).toBe('2')

    fireEvent.change(limit(), { target: { value: '3' } })
    await vi.waitFor(() => expect(listUnreviewed).toHaveBeenLastCalledWith('case1', 3))
    fireEvent.change(limit(), { target: { value: '1' } })
    await vi.waitFor(() => expect(listUnreviewed).toHaveBeenLastCalledWith('case1', 1))
    for (const value of ['0', '1.5', '-2', '']) {
      fireEvent.change(limit(), { target: { value } })
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
    const sent = listUnreviewed.mock.calls.map(([, n]) => n)
    expect(sent.every((n) => Number.isInteger(n) && n >= 1)).toBe(true)
    expect(listUnreviewed).toHaveBeenLastCalledWith('case1', 1)

    // Reopened, the view starts at 2 again and reads again.
    view.unmount()
    const calls = listUnreviewed.mock.calls.length
    renderView()
    await screen.findByTestId('unreviewed-view')
    expect(limit().value).toBe('2')
    expect(listUnreviewed.mock.calls.length).toBe(calls + 1)
    expect(listUnreviewed).toHaveBeenLastCalledWith('case1', 2)
  })

  it('reads again each time it is mounted on the same cache', async () => {
    stub(result())
    const { client, unmount } = renderView()
    await screen.findByTestId('unreviewed-view')
    unmount()
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>
    }
    render(<UnreviewedView caseId="case1" />, { wrapper: Wrapper })
    await vi.waitFor(() => expect(listUnreviewed).toHaveBeenCalledTimes(2))
  })

  it('reports its total for the rail', async () => {
    stub(result({ total: 12 }))
    const onTotal = vi.fn()
    renderView(onTotal)
    await vi.waitFor(() => expect(onTotal).toHaveBeenCalledWith(12))
  })

  it('never says a value is present, verified or proven, or that nobody looked', async () => {
    stub(result({ ungrouped: 1, notCurrent: 2, partial: 3 }))
    renderView()
    const view = await screen.findByTestId('unreviewed-view')
    const seen: string[] = [view.textContent ?? '']
    for (const group of ['Reply-To', 'Link host', 'Rare identifiers']) {
      pick(group)
      for (const row of within(view).getAllByTestId('unreviewed-row-key')) {
        fireEvent.click(row.closest('button')!)
        seen.push(view.textContent ?? '')
      }
    }
    for (const text of seen) {
      expect(text).not.toMatch(/present|verif|prove|confirm|nobody|no one|authentic/i)
    }
  })
})
