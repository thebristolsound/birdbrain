import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { QueryState, type QueryLike } from '@renderer/components/ui/query-state'

afterEach(() => {
  cleanup()
})

function makeQuery<TData>(overrides: Partial<QueryLike<TData>> = {}): QueryLike<TData> {
  return {
    isPending: false,
    isError: false,
    error: null,
    data: undefined,
    refetch: vi.fn(),
    ...overrides
  }
}

describe('QueryState', () => {
  it('renders the default LoadingState while pending', () => {
    const query = makeQuery<string[]>({ isPending: true })
    render(
      <QueryState query={query}>
        {(data) => <div data-testid="rows">{data.length}</div>}
      </QueryState>
    )
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByTestId('rows')).toBeNull()
  })

  it('renders a custom loading slot when provided', () => {
    const query = makeQuery<string[]>({ isPending: true })
    render(
      <QueryState query={query} loading={<div data-testid="custom-loading">Hold on…</div>}>
        {() => <div />}
      </QueryState>
    )
    expect(screen.getByTestId('custom-loading')).toBeTruthy()
  })

  it('renders the default ErrorState with a wired-up retry button on error', () => {
    const refetch = vi.fn()
    const query = makeQuery<string[]>({
      isError: true,
      error: new Error('boom'),
      refetch
    })
    render(
      <QueryState query={query}>
        {() => <div />}
      </QueryState>
    )
    // role=alert is the ErrorState container
    expect(screen.getByRole('alert')).toBeTruthy()
    // Default title + the underlying error message are rendered
    expect(screen.getByText('Something went wrong')).toBeTruthy()
    expect(screen.getByText('boom')).toBeTruthy()
    // Retry is wired through to refetch
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('renders a custom error render-prop with the error and retry callback', () => {
    const refetch = vi.fn()
    const query = makeQuery<string[]>({
      isError: true,
      error: new Error('kaboom'),
      refetch
    })
    render(
      <QueryState
        query={query}
        error={(err, retry) => (
          <div>
            <span data-testid="err-msg">{(err as Error).message}</span>
            <button data-testid="retry" onClick={retry}>
              Retry
            </button>
          </div>
        )}
      >
        {() => <div />}
      </QueryState>
    )
    expect(screen.getByTestId('err-msg').textContent).toBe('kaboom')
    fireEvent.click(screen.getByTestId('retry'))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('renders the empty slot when isEmpty(data) is true', () => {
    const query = makeQuery<string[]>({ data: [] })
    render(
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={<div data-testid="empty">Nothing here</div>}
      >
        {(data) => <div data-testid="rows">{data.length}</div>}
      </QueryState>
    )
    expect(screen.getByTestId('empty')).toBeTruthy()
    expect(screen.queryByTestId('rows')).toBeNull()
  })

  it('renders children with narrowed data when successful and non-empty', () => {
    const query = makeQuery<string[]>({ data: ['a', 'b', 'c'] })
    render(
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={<div data-testid="empty" />}
      >
        {(data) => <div data-testid="rows">{data.join(',')}</div>}
      </QueryState>
    )
    expect(screen.getByTestId('rows').textContent).toBe('a,b,c')
    expect(screen.queryByTestId('empty')).toBeNull()
  })

  it('treats success without isEmpty as non-empty and invokes children', () => {
    const query = makeQuery<{ name: string }>({ data: { name: 'ok' } })
    render(
      <QueryState query={query}>
        {(data) => <div data-testid="row">{data.name}</div>}
      </QueryState>
    )
    expect(screen.getByTestId('row').textContent).toBe('ok')
  })
})
