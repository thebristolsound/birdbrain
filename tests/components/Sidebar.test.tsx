// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { UpdateStatus } from '@shared/types'

const navigate = vi.hoisted(() => vi.fn())
const route = vi.hoisted(() => ({
  caseId: 'case-1' as string | undefined,
  path: '/cases/case-1/notes'
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ caseId: route.caseId }),
  useMatchRoute:
    () =>
    ({ to, params }: { to: string; params?: { caseId: string } }) =>
      to.replace('$caseId', params?.caseId ?? '') === route.path
}))

const update = vi.hoisted(() => ({ status: null as UpdateStatus | null }))
vi.mock('@renderer/hooks/useUpdateStatus', () => ({
  useUpdateStatus: () => ({ status: update.status })
}))

import { Sidebar } from '@renderer/components/layout/Sidebar'
import { SIDE_RAIL_PX } from '@renderer/components/captures/captureColumns'

const LABELS = ['Home', 'Overview', 'Captures', 'Notes', 'Signals', 'Data', 'Settings']

beforeEach(() => {
  route.caseId = 'case-1'
  route.path = '/cases/case-1/notes'
  update.status = null
  navigate.mockClear()
})

afterEach(cleanup)

describe('Sidebar', () => {
  it('shows every item under a visible label, in order, with Settings last', () => {
    render(<Sidebar />)
    const rail = screen.getByRole('navigation', { name: 'Sections' })
    const buttons = within(rail).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual(LABELS)
    // The name the tree reads is the label on screen, and no tooltip repeats it.
    for (const button of buttons) {
      expect(button.getAttribute('aria-label')).toBe(button.textContent)
    }
    expect(rail.querySelector('[aria-hidden="true"]:not(svg)')).toBeNull()
  })

  it('keeps the tour anchors on the buttons', () => {
    render(<Sidebar />)
    const anchors = ['dashboard', 'overview', 'captures', 'notes', 'signals', 'data']
    for (const [index, name] of anchors.entries()) {
      const button = screen.getByRole('button', { name: LABELS[index] })
      expect(button.getAttribute('data-tour')).toBe(`nav-${name}`)
    }
  })

  it('marks the section on screen as the current page, and no other', () => {
    render(<Sidebar />)
    const current = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current'))
    expect(current.map((button) => button.textContent)).toEqual(['Notes'])
    expect(current[0].className).toContain('bg-accent-subtle')
    expect(screen.getByRole('button', { name: 'Captures' }).className).not.toContain(
      'bg-accent-subtle'
    )
  })

  it('goes home, to a section of the open Case, and to Settings', () => {
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    expect(navigate).toHaveBeenLastCalledWith({ to: '/' })
    fireEvent.click(screen.getByRole('button', { name: 'Signals' }))
    expect(navigate).toHaveBeenLastCalledWith({
      to: '/cases/$caseId/signals',
      params: { caseId: 'case-1' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(navigate).toHaveBeenLastCalledWith({ to: '/settings' })
  })

  // The new-Case wizard shows the rail before any Case exists.
  it('holds the section items while no Case is open, and leaves Home and Settings usable', () => {
    route.caseId = undefined
    route.path = '/cases/new'
    render(<Sidebar />)
    for (const name of ['Overview', 'Captures', 'Notes', 'Signals', 'Data']) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      fireEvent.click(button)
    }
    expect(navigate).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Home' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Settings' }) as HTMLButtonElement).disabled).toBe(
      false
    )
  })

  it.each(['available', 'downloaded'] as const)(
    'shows the update dot on Settings while an update is %s, and says so in the title',
    (state) => {
      update.status = { state } as UpdateStatus
      render(<Sidebar />)
      const settings = screen.getByRole('button', { name: 'Settings' })
      expect(within(settings).getByTestId('rail-update-dot')).toBeTruthy()
      expect(settings.getAttribute('title')).toBe('Settings — update available')
    }
  )

  it('shows no update dot and no title while there is no update', () => {
    update.status = { state: 'idle' } as UpdateStatus
    render(<Sidebar />)
    expect(screen.queryByTestId('rail-update-dot')).toBeNull()
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('title')).toBeNull()
  })

  // The Captures screen and the Capture Session dock subtract this width from the window's.
  it('is as wide as the constant the Captures columns measure against', () => {
    render(<Sidebar />)
    expect(SIDE_RAIL_PX).toBe(72)
    expect(screen.getByRole('navigation', { name: 'Sections' }).className).toContain(
      `w-[${SIDE_RAIL_PX}px]`
    )
  })
})
