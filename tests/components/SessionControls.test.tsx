// @vitest-environment jsdom
// The toggle sets sessionActive and nothing else, so its label has to say
// session (#813). "Auto-capture" is the Signals setting, written elsewhere.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [{ id: 'case-a', name: 'Case A' }] })
}))
const route = vi.hoisted(() => ({ caseId: 'case-a' as string | undefined }))

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: route.caseId })
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
  route.caseId = 'case-a'
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

  // Off a case route (Settings) a running session still has to be stoppable;
  // only starting one needs a case to activate.
  it('leaves a running session stoppable off a case route', () => {
    route.caseId = undefined
    useAppStore.setState({ sessionActive: true })

    render(<SessionControls />)

    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(false)
  })

  it('cannot start a session off a case route', () => {
    route.caseId = undefined

    render(<SessionControls />)

    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
  })
})
