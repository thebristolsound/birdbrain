import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'

const log = vi.fn().mockResolvedValue('cid')

function Boom({ message = 'render exploded' }: { message?: string }): JSX.Element {
  throw new Error(message)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('birdbrain', { diagnostics: { log } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary source="test">
        <p>fine</p>
      </ErrorBoundary>
    )
    expect(screen.getByText('fine')).toBeTruthy()
  })

  it('shows recovery UI and logs when a child throws', () => {
    render(
      <ErrorBoundary source="test">
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeTruthy()
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        code: 'react.render_error',
        context: { boundary: 'test' }
      })
    )
  })

  it('does not send the thrown message to the log', () => {
    render(
      <ErrorBoundary source="test">
        <Boom message="cannot render Operation Blackbird" />
      </ErrorBoundary>
    )
    expect(JSON.stringify(log.mock.calls[0][0])).not.toContain('Blackbird')
  })
})
