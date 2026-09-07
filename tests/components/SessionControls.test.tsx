// @vitest-environment jsdom
// The toggle sets sessionActive and nothing else, so its label has to say
// session (#813). "Auto-Capture" is the Signals setting, written elsewhere.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [{ id: 'case-a', name: 'Case A' }] })
}))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: 'case-a' })
}))
vi.mock('@renderer/lib/queries', () => ({
  casesQueryOptions: {},
  useSessionMutations: () => ({
    activateCase: { mutateAsync: vi.fn() },
    start: { mutateAsync: vi.fn() },
    stop: { mutateAsync: vi.fn() }
  })
}))

import { SessionControls } from '@renderer/components/status/SessionControls'
import { useAppStore } from '@renderer/stores/appStore'

beforeEach(() => {
  useAppStore.setState({ connectedToExtension: true, sessionActive: false })
})

afterEach(() => {
  cleanup()
})

describe('SessionControls', () => {
  it('labels the toggle Capture Session, not Auto-Capture (#813)', () => {
    render(<SessionControls />)

    expect(screen.getByText('Capture Session')).toBeDefined()
    expect(screen.getByRole('switch', { name: 'Capture Session' })).toBeDefined()
    expect(screen.queryByText('Auto-Capture')).toBeNull()
  })

  it('reflects the session state on the switch', () => {
    useAppStore.setState({ sessionActive: true })

    render(<SessionControls />)

    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })
})
