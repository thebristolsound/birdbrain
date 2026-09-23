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

  it('shows two selector badges plus an overflow chip naming the rest', () => {
    renderItem({
      matchingSelectors: [selector('s1', 'alpha'), selector('s2', 'beta'), selector('s3', 'gamma')]
    })

    expect(screen.getByText('alpha')).toBeDefined()
    expect(screen.getByText('beta')).toBeDefined()
    expect(screen.queryByText('gamma')).toBeNull()
    expect(screen.getByText('+1').getAttribute('title')).toBe('gamma')
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
