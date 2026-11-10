// @vitest-environment jsdom
//
// The Data screen's MHTML Parts tab (#991): what it says a stored archive holds, and what an
// Operator can copy out of it. Ruling R6 keeps every verification word and icon out of it.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import type { MhtmlPartRow, MhtmlPartsListing, MhtmlPartsRefusal } from '@shared/types'
import { MhtmlPartsTab } from '@renderer/components/data/MhtmlPartsTab'
import { PARTS_CAPTION, UNANCHORED_PARTS_CAPTION } from '@renderer/components/data/mhtmlPartsModel'

afterEach(() => cleanup())

const HASH_1 = '51e139ae51b1f7f100083f3536d21e615f4f25e831f15fe93abb93519265ce18'
const HASH_2 = '929e08d597feae564ce98003c4a47ff5239a5b93681d186eda3a9871e5b62644'
const HASH_3 = 'd692e65d337705a1df44f2dbb2d64cd737f7f9cf9475343d9528b165357c79c1'

function part(overrides: Partial<MhtmlPartRow> & Pick<MhtmlPartRow, 'position'>): MhtmlPartRow {
  return {
    htmlPart: null,
    mainDocument: false,
    contentType: 'text/html',
    transferEncoding: 'binary',
    contentLocation: 'https://example.com/',
    contentId: null,
    offset: 0,
    size: 0,
    sha256: '0'.repeat(64),
    headersTerminated: true,
    endsAtEndOfFile: false,
    fieldsTruncated: false,
    ...overrides
  }
}

const PARTS: MhtmlPartRow[] = [
  part({
    position: 1,
    htmlPart: 0,
    mainDocument: true,
    contentType: 'text/html; charset=utf-8',
    transferEncoding: 'quoted-printable',
    contentLocation: 'https://example.com/report',
    offset: 343,
    size: 107,
    sha256: HASH_1
  }),
  part({
    position: 2,
    contentType: 'image/png',
    transferEncoding: null,
    contentLocation: null,
    contentId: '<badge@example.org>',
    offset: 584,
    size: 12,
    sha256: HASH_2
  }),
  part({
    position: 3,
    htmlPart: 1,
    contentLocation: 'https://widgets.example/\r\nembed',
    offset: 796,
    size: 2048,
    sha256: HASH_3
  })
]

function listed(overrides: Partial<Extract<MhtmlPartsListing, { status: 'listed' }>> = {}) {
  const listing: MhtmlPartsListing = {
    status: 'listed',
    readAt: '2026-11-10T09:00:00.000Z',
    fileSize: 1691,
    topContentType: 'multipart/related; type="text/html"',
    boundary: '----PartsFixtureBoundary',
    snapshotLocation: 'https://example.com/report',
    fieldsTruncated: false,
    closed: true,
    totalParts: 3,
    unterminatedParts: 0,
    truncated: false,
    parts: PARTS,
    ...overrides
  }
  return listing
}

function renderTab(listing: MhtmlPartsListing | null, anchored = true) {
  const onCopy = vi.fn()
  const { container } = render(
    <MhtmlPartsTab listing={listing} anchored={anchored} onCopy={onCopy} />
  )
  return { onCopy, container }
}

function text(node: Element | null | undefined): string {
  return node?.textContent ?? ''
}

describe('MhtmlPartsTab, listed', () => {
  it('heads the hash column as computed now and states that only the file is anchored', () => {
    renderTab(listed())
    const headers = within(screen.getByTestId('mhtml-parts-table'))
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)
    expect(headers).toEqual([
      '#',
      'HTML part',
      'Content-Location',
      'Content-Type',
      'Encoding',
      'Offset',
      'Size',
      'SHA-256 (computed now)',
      'Copy'
    ])
    expect(text(screen.getByTestId('mhtml-parts-caption'))).toBe(PARTS_CAPTION)
    expect(
      within(screen.getByTestId('mhtml-parts-table')).getByText('Offset').getAttribute('title')
    ).toContain('tail -c +$((offset+1)) <file> | head -c <size> | sha256sum')
  })

  it('says verify only in the caption, and shows no shield', () => {
    const { container } = renderTab(listed())
    expect(text(screen.getByTestId('mhtml-parts-table'))).not.toMatch(/verif/i)
    expect(text(screen.getByTestId('mhtml-parts-archive'))).not.toMatch(/verif/i)
    const caption = screen.getByTestId('mhtml-parts-caption')
    const all = text(screen.getByTestId('mhtml-parts-listed'))
    expect(all.replace(text(caption), '')).not.toMatch(/verif/i)
    expect(text(caption).match(/verif\w*/gi)).toEqual(['Verify'])
    expect(container.querySelector('svg[class*="shield"]')).toBeNull()
  })

  it('says nothing is anchored when the Capture has no Manifest Entry', () => {
    const { container } = renderTab(listed(), false)
    const caption = text(screen.getByTestId('mhtml-parts-caption'))
    expect(caption).toBe(UNANCHORED_PARTS_CAPTION)
    expect(text(screen.getByTestId('mhtml-parts-listed'))).not.toMatch(/verif/i)
    expect(container.querySelector('svg[class*="shield"]')).toBeNull()
  })

  it('shows the archive header, the part count and the file size as read', () => {
    renderTab(listed())
    const card = text(screen.getByTestId('mhtml-parts-archive'))
    expect(card).toContain('Content-Type: multipart/related; type="text/html"')
    expect(card).toContain('boundary: ----PartsFixtureBoundary')
    expect(card).toContain('Snapshot-Content-Location: https://example.com/report')
    expect(card).toContain('Parts: 3 · File: 1,691 bytes, as read now')
    expect(card).toContain('Read at ')
  })

  it('writes absent archive headers as (none)', () => {
    renderTab(listed({ topContentType: null, snapshotLocation: null }))
    const card = text(screen.getByTestId('mhtml-parts-archive'))
    expect(card).toContain('Content-Type: (none)')
    expect(card).toContain('Snapshot-Content-Location: (none)')
  })

  it('marks HTML parts by their part number and the main document', () => {
    renderTab(listed())
    expect(text(within(screen.getByTestId('mhtml-part-1')).getByTestId('mhtml-part-html'))).toBe(
      'part 0main'
    )
    expect(text(within(screen.getByTestId('mhtml-part-2')).getByTestId('mhtml-part-html'))).toBe('')
    expect(text(within(screen.getByTestId('mhtml-part-3')).getByTestId('mhtml-part-html'))).toBe(
      'part 1'
    )
  })

  it('shows each row’s type, encoding, offset, size and full hash', () => {
    renderTab(listed())
    const first = text(screen.getByTestId('mhtml-part-1'))
    expect(first).toContain('text/html; charset=utf-8')
    expect(first).toContain('quoted-printable')
    expect(first).toContain('343')
    expect(first).toContain('107 B')
    expect(text(within(screen.getByTestId('mhtml-part-1')).getByTestId('mhtml-part-sha256'))).toBe(
      HASH_1
    )
    expect(text(screen.getByTestId('mhtml-part-2'))).toContain('(none)')
    expect(screen.getByText('2.0 KB').getAttribute('title')).toBe('2,048 bytes')
  })

  it('shows the Content-ID for a part with no Content-Location', () => {
    renderTab(listed())
    expect(
      text(within(screen.getByTestId('mhtml-part-2')).getByTestId('mhtml-part-location'))
    ).toBe('Content-ID: <badge@example.org>')
  })

  it('renders the Content-Location as escaped text, never a link', () => {
    const { container } = renderTab(listed())
    expect(container.querySelector('a')).toBeNull()
    expect(
      text(within(screen.getByTestId('mhtml-part-3')).getByTestId('mhtml-part-location'))
    ).toBe('https://widgets.example/\\x0d\\x0aembed')
  })

  it('copies the full hash, location and byte range, unescaped', () => {
    const { onCopy } = renderTab(listed())
    const row = within(screen.getByTestId('mhtml-part-3'))
    fireEvent.click(row.getByTestId('mhtml-part-copy-sha256'))
    fireEvent.click(row.getByTestId('mhtml-part-copy-location'))
    fireEvent.click(row.getByTestId('mhtml-part-copy-range'))
    expect(onCopy.mock.calls).toEqual([
      [HASH_3, 'SHA-256 (computed now, not anchored)'],
      ['https://widgets.example/\r\nembed', 'Content-Location'],
      ['offset 796 length 2048', 'byte range']
    ])
    expect(row.getByTestId('mhtml-part-copy-sha256').getAttribute('aria-label')).toBe(
      'Copy the SHA-256 of part 3'
    )
  })

  it('withholds the location copy on a row with a cut value or no location', () => {
    renderTab(
      listed({
        parts: [part({ position: 1, fieldsTruncated: true }), PARTS[1]]
      })
    )
    const cut = within(screen.getByTestId('mhtml-part-1'))
    expect(cut.queryByTestId('mhtml-part-copy-location')).toBeNull()
    expect(cut.getByTestId('mhtml-part-copy-sha256')).toBeTruthy()
    expect(cut.getByTestId('mhtml-part-copy-range')).toBeTruthy()
    expect(
      within(screen.getByTestId('mhtml-part-2')).queryByTestId('mhtml-part-copy-location')
    ).toBeNull()
    expect(screen.getByTestId('mhtml-parts-banner-fields-cut')).toBeTruthy()
  })

  it('says when a part’s headers never end', () => {
    renderTab(
      listed({
        unterminatedParts: 1,
        parts: [
          part({
            position: 1,
            headersTerminated: false,
            contentType: null,
            transferEncoding: null,
            contentLocation: null
          })
        ]
      })
    )
    expect(text(screen.getByTestId('mhtml-part-1'))).toContain('(headers unterminated)')
    expect(text(screen.getByTestId('mhtml-parts-banner-unterminated'))).toContain(
      '1 part has no blank line ending its headers.'
    )
  })

  it('writes a terminated part with no Content-Type as (none)', () => {
    renderTab(listed({ parts: [part({ position: 1, contentType: null })] }))
    expect(text(screen.getByTestId('mhtml-part-1'))).toContain('(none)')
  })

  it('shows a banner for an unclosed archive and for the row ceiling', () => {
    renderTab(listed({ closed: false, truncated: true, totalParts: 9000 }))
    expect(text(screen.getByTestId('mhtml-parts-banner-unclosed'))).toContain(
      'this list may be incomplete'
    )
    expect(text(screen.getByTestId('mhtml-parts-banner-ceiling'))).toBe(
      'Listing stops at 3 of 9,000 parts.'
    )
  })

  it('shows no banner for a whole archive', () => {
    renderTab(listed())
    expect(screen.queryByTestId(/mhtml-parts-banner-/)).toBeNull()
  })
})

describe('MhtmlPartsTab, nothing listed', () => {
  const cases: [MhtmlPartsRefusal, string][] = [
    [
      { reason: 'file-missing', path: 'case1/cap-a.mhtml' },
      'The stored MHTML file is not on disk at case1/cap-a.mhtml.'
    ],
    [
      { reason: 'too-large', size: 300, limit: 200 },
      'The stored file is 300 bytes, over the 200-byte limit this tab reads. Nothing was listed.'
    ],
    [
      { reason: 'no-mime-header' },
      'The stored file is not a multipart MHTML archive: it has no header block naming a boundary, so it holds no parts to list.'
    ],
    [
      { reason: 'no-boundary', contentType: 'text/html', fieldsTruncated: false },
      'The stored file is not a multipart MHTML archive: it has no header block naming a boundary, so it holds no parts to list.'
    ],
    [
      { reason: 'no-parts', boundary: '----b', fieldsTruncated: false },
      'The file names boundary ----b but holds no part delimited by it.'
    ]
  ]

  it.each(cases)('states the %o refusal, with its reason', (refusal, sentence) => {
    renderTab({ status: 'refused', readAt: '2026-11-10T09:00:00.000Z', refusal })
    const stated = screen.getByTestId('mhtml-parts-refused')
    expect(text(stated)).toBe(sentence)
    expect(stated.getAttribute('data-reason')).toBe(refusal.reason)
    expect(screen.queryByTestId('mhtml-parts-table')).toBeNull()
  })

  it('states that a row with no stored MHTML has nothing to read', () => {
    renderTab(null)
    expect(text(screen.getByTestId('mhtml-parts-refused'))).toBe(
      'This row has no stored MHTML to read.'
    )
  })
})
