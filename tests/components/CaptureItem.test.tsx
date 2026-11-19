// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { Capture, Selector } from '@shared/types'

const thumbnail = vi.hoisted(() =>
  vi.fn((): { thumbnail: string | null; loading: boolean } => ({ thumbnail: null, loading: false }))
)
vi.mock('@renderer/hooks/useCaptureThumbnail', () => ({
  useCaptureThumbnail: thumbnail
}))

import { CaptureItem } from '@renderer/components/captures/CaptureItem'
import { members } from './sharingFixtures'

// Fixed clock so both time treatments are known-answer assertions rather than
// "matches /ago/".
const NOW = new Date('2026-05-02T12:00:00.000Z').getTime()

const capture: Capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/evidence/page',
  title: 'Example evidence page',
  hash: 'h',
  timestamp: new Date(NOW - 5 * 60_000).toISOString(),
  createdAt: new Date(NOW - 5 * 60_000).toISOString(),
  format: 'mhtml',
  method: 'extension'
}

function selector(id: string, label: string): Selector {
  return {
    id,
    caseId: 'case1',
    pattern: label,
    isRegex: false,
    enabled: true,
    label,
    createdAt: new Date(NOW).toISOString()
  }
}

function renderItem(props: Partial<Parameters<typeof CaptureItem>[0]> = {}) {
  return render(
    <CaptureItem
      capture={capture}
      isSelected={false}
      nowMs={NOW}
      onClick={vi.fn()}
      onToggleMultiSelect={vi.fn()}
      onToggleFavorite={vi.fn()}
      {...props}
    />
  )
}

beforeEach(() => {
  thumbnail.mockReturnValue({ thumbnail: null, loading: false })
})

afterEach(() => {
  cleanup()
  thumbnail.mockReset()
})

describe('CaptureItem — Exhibit citation chip (#1510)', () => {
  it('uses the roster hue and author for a shared Capture', () => {
    renderItem({
      capture: { ...capture, exhibitCitation: 'NK-12', operatorId: 'inst-nk' },
      sharing: { members: members() }
    })
    expect(screen.getByTestId('capture-item-citation').getAttribute('title')).toBe(
      'Captured by N. Kowalski (NK)'
    )
    expect(screen.getByTestId('capture-item-citation').dataset.hue).toBe('2')
    expect(screen.getByTestId('capture-author-rail')).toBeTruthy()
  })
  it('does not assign an inherited citation to a new member reusing its code', () => {
    const roster = members()
    roster.members = [{ ...roster.members[0], memberCode: 'NK' }]
    renderItem({
      capture: { ...capture, exhibitCitation: 'NK-12', operatorId: 'original-author' },
      sharing: { members: roster }
    })
    expect(screen.getByTestId('capture-item-citation').getAttribute('title')).toBe('Exhibit Number')
    expect(screen.queryByTestId('capture-author-rail')).toBeNull()
  })

  it('shows the citation main resolved before the title, in both views', () => {
    renderItem({ capture: { ...capture, exhibitNumber: 12, exhibitCitation: 'NK-12' } })
    const detailed = screen.getByTestId('capture-item-citation')
    expect(detailed.textContent).toBe('NK-12')
    expect(detailed.getAttribute('title')).toBe('Exhibit Number')
    expect(detailed.compareDocumentPosition(screen.getByText('Example evidence page'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )

    cleanup()
    renderItem({
      view: 'list',
      capture: { ...capture, exhibitNumber: 12, exhibitCitation: 'NK-12' }
    })
    expect(screen.getByTestId('capture-item-citation').textContent).toBe('NK-12')
  })

  it('renders no chip for a row that carries no citation', () => {
    renderItem()
    expect(screen.queryByTestId('capture-item-citation')).toBeNull()
  })
})

describe('CaptureItem — detailed view', () => {
  it('renders the long relative time with the full UTC timestamp on hover', () => {
    renderItem()

    const time = screen.getByText('5 minutes ago')
    expect(time.getAttribute('title')).toBe('Captured Sat, May 2, 2026, 11:55 AM UTC')
  })

  it('falls back to the logo silhouette when no thumbnail has been generated', () => {
    renderItem()
    expect(screen.getByTestId('capture-thumb-fallback')).toBeDefined()
  })

  it('draws the fallback tile from theme tokens, the same for every URL', () => {
    renderItem()
    const tile = screen.getByTestId('capture-thumb-fallback-tile')
    // Token classes swap with the theme; a hashed inline tint could not.
    expect(tile.className).toContain('from-elevated')
    expect(tile.className).toContain('to-surface')
    expect(tile.getAttribute('style')).toBeNull()
  })

  it('uses the stored thumbnail when one exists', () => {
    thumbnail.mockReturnValue({ thumbnail: 'data:image/jpeg;base64,zz', loading: false })
    renderItem()
    expect(screen.queryByTestId('capture-thumb-fallback')).toBeNull()
  })

  it('labels the provenance dot with the verification status', () => {
    renderItem({ capture: { ...capture, lastVerifiedStatus: 'verified' } })
    const dot = screen.getByTestId('capture-provenance-dot')
    expect(dot.getAttribute('title')).toBe('Verified')
    expect(dot.className).toContain('bg-emerald-400')
  })

  it('names the one matching Selector in one chip, with no count', () => {
    renderItem({ matchingSelectors: [selector('s1', 'alpha')] })

    expect(screen.getAllByTestId('capture-item-selector-chip')).toHaveLength(1)
    expect(screen.getByTestId('capture-item-selector-name').textContent).toBe('alpha')
    expect(screen.queryByTestId('capture-item-selector-more')).toBeNull()
  })

  it('names the first of several matching Selectors and counts the others', () => {
    renderItem({
      matchingSelectors: [selector('s1', 'alpha'), selector('s2', 'beta'), selector('s3', 'gamma')]
    })

    expect(screen.getAllByTestId('capture-item-selector-chip')).toHaveLength(1)
    expect(screen.getByTestId('capture-item-selector-name').textContent).toBe('alpha')
    expect(screen.getByTestId('capture-item-selector-more').textContent).toBe('+2')
    expect(screen.queryByText('beta')).toBeNull()
    expect(screen.queryByText('gamma')).toBeNull()
  })

  it('names a Selector by its label, and by its pattern when it has none', () => {
    renderItem({ matchingSelectors: [{ ...selector('s1', 'Alpha'), pattern: 'al+pha' }] })
    expect(screen.getByTestId('capture-item-selector-name').textContent).toBe('Alpha')
    cleanup()

    renderItem({ matchingSelectors: [{ ...selector('s1', 'al+pha'), label: undefined }] })
    const chip = screen.getByTestId('capture-item-selector-chip')
    expect(screen.getByTestId('capture-item-selector-name').textContent).toBe('al+pha')
    expect(chip.getAttribute('title')).toBe('al+pha')
  })

  it('names the Selector that filters the list, though another was created later', () => {
    renderItem({
      matchingSelectors: [selector('s1', 'alpha'), selector('s2', 'beta'), selector('s3', 'gamma')],
      filterSelectorIds: ['s3']
    })

    expect(screen.getByTestId('capture-item-selector-name').textContent).toBe('gamma')
    expect(screen.getByTestId('capture-item-selector-more').textContent).toBe('+2')
  })

  it('names the newest of the filtering Selectors a row matches', () => {
    renderItem({
      matchingSelectors: [selector('s1', 'alpha'), selector('s2', 'beta'), selector('s3', 'gamma')],
      filterSelectorIds: ['s3', 's2', 's9']
    })
    expect(screen.getByTestId('capture-item-selector-name').textContent).toBe('beta')
  })

  it('keeps the newest name when the filter names no Selector the row matches', () => {
    renderItem({
      matchingSelectors: [selector('s1', 'alpha'), selector('s2', 'beta')],
      filterSelectorIds: ['s9']
    })
    expect(screen.getByTestId('capture-item-selector-name').textContent).toBe('alpha')
    expect(screen.getByTestId('capture-item-selector-more').textContent).toBe('+1')
  })

  it('puts every matching name in the chip title and description, shown name first', () => {
    renderItem({
      matchingSelectors: [selector('s1', 'alpha'), selector('s2', 'beta'), selector('s3', 'gamma')],
      filterSelectorIds: ['s2']
    })

    const chip = screen.getByTestId('capture-item-selector-chip')
    expect(chip.getAttribute('title')).toBe('beta, alpha, gamma')
    const description = document.getElementById(chip.getAttribute('aria-describedby') ?? '')
    expect(description?.textContent).toBe('Matching Selectors: beta, alpha, gamma')
    // In the row, and hidden from sight only: the row is a button whose name
    // comes from its content, so a screen reader reads the names with the row.
    expect(screen.getByTestId('capture-item').contains(description)).toBe(true)
    expect(description?.className).toBe('sr-only')
    expect(description?.closest('[aria-hidden="true"], [hidden]')).toBeNull()
  })

  it('describes a single match too, and gives each row its own description', () => {
    renderItem({ matchingSelectors: [selector('s1', 'alpha')] })
    renderItem({ matchingSelectors: [selector('s2', 'beta')] })

    const [first, second] = screen.getAllByTestId('capture-item-selector-chip')
    expect(first.getAttribute('title')).toBe('alpha')
    const firstId = first.getAttribute('aria-describedby') ?? ''
    const secondId = second.getAttribute('aria-describedby') ?? ''
    expect(firstId).not.toBe(secondId)
    expect(document.getElementById(firstId)?.textContent).toBe('Matching Selectors: alpha')
    expect(document.getElementById(secondId)?.textContent).toBe('Matching Selectors: beta')
  })

  it('draws no Selector chip and no description on a row with no match', () => {
    renderItem({ filterSelectorIds: ['s1'] })

    expect(screen.queryByTestId('capture-item-selector-chip')).toBeNull()
    expect(screen.getByTestId('capture-item-chip-line').textContent).toBe('\u00a0')
    expect(screen.getByTestId('capture-item').textContent).not.toContain('Matching Selectors')
  })

  // jsdom lays nothing out, so these pin the structure that makes the line one
  // line high: it cannot wrap, it clips, and the name is what gives way.
  it('keeps the chip line to one line, with the name truncating before the count', () => {
    renderItem({
      matchingSelectors: [selector('s1', 'a'.repeat(200)), selector('s2', 'beta')]
    })

    const line = screen.getByTestId('capture-item-chip-line').className.split(' ')
    expect(line).not.toContain('flex-wrap')
    expect(line).toEqual(expect.arrayContaining(['flex', 'overflow-hidden', 'whitespace-nowrap']))
    const chip = screen.getByTestId('capture-item-selector-chip').className.split(' ')
    expect(chip).toEqual(expect.arrayContaining(['flex', 'min-w-0']))
    expect(screen.getByTestId('capture-item-selector-name').className).toBe('truncate')
    expect(screen.getByTestId('capture-item-selector-more').className).toBe('shrink-0')
  })

  it('reserves the chip line on a row with no matches, sized like a real chip', () => {
    renderItem()
    const strut = screen.getByTestId('capture-item-chip-strut')
    expect(strut.parentElement).toBe(screen.getByTestId('capture-item-chip-line'))
    expect(strut.getAttribute('aria-hidden')).toBe('true')
    expect(strut.className).toContain('invisible')
    const strutBox = strut.className.replace('invisible', '').trim()
    const emptyLine = screen.getByTestId('capture-item-chip-line').className
    cleanup()

    renderItem({ matchingSelectors: [selector('s1', 'alpha'), selector('s2', 'beta')] })
    expect(screen.queryByTestId('capture-item-chip-strut')).toBeNull()
    expect(screen.getByTestId('capture-item-selector-chip').className).toContain(strutBox)
    expect(screen.getByTestId('capture-item-chip-line').className).toBe(emptyLine)
  })

  it('gives the Favorite button a 24 pixel target around its 11 pixel star', () => {
    renderItem()
    const button = screen.getByLabelText('Favorite capture')
    const classes = button.className.split(' ')
    expect(classes).toEqual(expect.arrayContaining(['h-6', 'w-6', 'shrink-0', 'relative']))
    // The margin gives back the 4.5 pixels a side the target adds to the star's
    // old 15 pixel box, so the title keeps its width.
    expect(classes).toContain('-m-[4.5px]')
    const star = button.querySelector('svg')
    expect(star?.getAttribute('class')).toContain('h-[11px] w-[11px]')
  })

  it('toggles the favourite without also selecting the row', () => {
    const onClick = vi.fn()
    const onToggleFavorite = vi.fn()
    renderItem({ onClick, onToggleFavorite })

    fireEvent.click(screen.getByLabelText('Favorite capture'))

    expect(onToggleFavorite).toHaveBeenCalledOnce()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('marks background recaptures in the meta row', () => {
    renderItem({ capture: { ...capture, method: 'background' } })
    expect(screen.getByTestId('recapture-thumb-badge').getAttribute('title')).toBe(
      'Background recapture'
    )
  })

  it('marks duplicates in the meta row, so two identical rows are told apart (#827)', () => {
    renderItem({ capture: { ...capture, method: 'duplicate', duplicateOfCaptureId: 'cap0' } })
    expect(screen.getByTestId('duplicate-thumb-badge').getAttribute('title')).toBe(
      'Duplicate of another capture'
    )
    expect(screen.queryByTestId('recapture-thumb-badge')).toBeNull()
  })

  it('names the duplicate marker in the accessibility tree, not just on hover (#827)', () => {
    renderItem({ capture: { ...capture, method: 'duplicate', duplicateOfCaptureId: 'cap0' } })
    // A screen reader must be able to tell a byte copy from a second sighting:
    // the badge carries visually hidden text, and the icon stays decorative.
    expect(screen.getByText('Duplicate of another capture')).not.toBeNull()
    expect(screen.getByTestId('duplicate-thumb-badge').getAttribute('aria-hidden')).toBeNull()
  })
})

describe('CaptureItem — list view', () => {
  it('renders the short relative time with a clock and the same hover timestamp', () => {
    renderItem({ view: 'list' })

    const time = screen.getByText('5m', { exact: false })
    expect(time.getAttribute('title')).toBe('Captured Sat, May 2, 2026, 11:55 AM UTC')
    // The clock icon is the list row's compensation for the terser string.
    expect(time.querySelector('svg')).not.toBeNull()
  })

  it('drops the thumbnail entirely', () => {
    renderItem({ view: 'list' })
    expect(screen.queryByTestId('capture-thumb-fallback')).toBeNull()
  })

  it('shows a star only once the capture is favourited, and never a toggle', () => {
    const { container } = renderItem({ view: 'list' })
    expect(container.querySelectorAll('svg.fill-amber-400')).toHaveLength(0)
    expect(screen.queryByLabelText('Favorite capture')).toBeNull()

    cleanup()
    const favourited = renderItem({ view: 'list', isFavorite: true })
    expect(favourited.container.querySelectorAll('svg.fill-amber-400')).toHaveLength(1)
  })

  it('still marks a duplicate in the compact row, with accessible text (#827)', () => {
    renderItem({
      view: 'list',
      capture: { ...capture, method: 'duplicate', duplicateOfCaptureId: 'cap0' }
    })
    // The compact view drops the thumbnail and meta row, but a byte copy must
    // never read as a second sighting in ANY view — the marker stays.
    expect(screen.getByTestId('duplicate-list-badge').getAttribute('title')).toBe(
      'Duplicate of another capture'
    )
    expect(screen.getByText('Duplicate of another capture')).not.toBeNull()
  })
})

describe('CaptureItem — selection affordances survive both views', () => {
  it.each(['detailed', 'list'] as const)('keeps the checkbox in the %s view', (view) => {
    const onToggleMultiSelect = vi.fn()
    renderItem({ view, onToggleMultiSelect })

    const box = screen.getByTestId('capture-select-checkbox')
    expect(box.getAttribute('role')).toBe('checkbox')
    expect(box.getAttribute('aria-label')).toBe('Select capture')

    fireEvent.click(box)
    expect(onToggleMultiSelect).toHaveBeenCalledOnce()
  })

  it.each(['detailed', 'list'] as const)('keeps the multi-select rail in the %s view', (view) => {
    renderItem({ view, isMultiSelected: true })

    expect(screen.getByTestId('capture-multiselect-rail')).toBeDefined()
    expect(screen.getByTestId('capture-select-checkbox').getAttribute('aria-label')).toBe(
      'Deselect capture'
    )
  })

  it.each(['detailed', 'list'] as const)(
    'sticks the checkbox visible in the %s view once any row is checked',
    (view) => {
      renderItem({ view, showCheckbox: true })
      expect(screen.getByTestId('capture-select-checkbox').className).toContain('opacity-100')
    }
  )

  it.each([
    ['detailed', '-mt-px'],
    ['list', 'self-center']
  ] as const)(
    'gives the checkbox a 24 pixel target around its 14 pixel box in the %s view',
    (view, placement) => {
      renderItem({ view })
      const box = screen.getByTestId('capture-select-checkbox')
      const classes = box.className.split(' ')
      expect(classes).toEqual(expect.arrayContaining(['h-6', 'w-6', 'shrink-0', 'relative']))
      // The margin gives back the 5 pixels a side the target adds, so the
      // thumbnail and the title stay where they were.
      expect(classes).toEqual(expect.arrayContaining(['-m-[5px]', placement]))
      expect(box.firstElementChild?.className).toContain('h-3.5 w-3.5')
    }
  )

  it('activates on Enter and Space without scrolling the list', () => {
    const onClick = vi.fn()
    renderItem({ onClick })

    const row = screen.getByTestId('capture-item')
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })
    fireEvent.keyDown(row, { key: 'a' })

    expect(onClick).toHaveBeenCalledTimes(2)
  })
})
