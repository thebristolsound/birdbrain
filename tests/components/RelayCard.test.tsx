// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { RelayCard } from '@renderer/components/sharing/RelayCard'
import { RecoveryCard } from '@renderer/components/sharing/RecoveryCard'
import { fakeBridge } from '../renderer/fakeBridge'
import { refusal } from './sharingFixtures'

const RELAY = 'https://use1-1.relay.n0.iroh-canary.iroh.link'

let setRelayUrl: ReturnType<typeof vi.fn>

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  setRelayUrl = vi.fn(async () => undefined)
  fakeBridge({ sharing: { setRelayUrl } })
})

afterEach(cleanup)

describe('RelayCard', () => {
  it('shows the saved relay URL and saves a changed one on blur', async () => {
    render(<RelayCard relayUrl={RELAY} />, { wrapper: Wrapper })
    const input = screen.getByLabelText('Relay URL') as HTMLInputElement
    expect(input.value).toBe(RELAY)
    expect(screen.getByText('Restart Birdbrain to use a changed relay address.')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'https://relay.example.test' } })
    fireEvent.blur(input)
    await waitFor(() => expect(setRelayUrl).toHaveBeenCalledWith('https://relay.example.test'))
  })

  it('saves on Enter and not when nothing changed', async () => {
    render(<RelayCard relayUrl="" />, { wrapper: Wrapper })
    const input = screen.getByLabelText('Relay URL') as HTMLInputElement
    expect(input.placeholder).toBe('default relays')
    fireEvent.blur(input)
    expect(setRelayUrl).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'https://relay.example.test' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(setRelayUrl).toHaveBeenCalledTimes(1))
  })

  it('shows an invalid URL refusal under the field', async () => {
    setRelayUrl.mockRejectedValue(refusal('relay-url-invalid'))
    render(<RelayCard relayUrl="" />, { wrapper: Wrapper })
    const input = screen.getByLabelText('Relay URL')
    fireEvent.change(input, { target: { value: 'not a url' } })
    fireEvent.blur(input)
    expect((await screen.findByTestId('relay-error')).textContent).toBe(
      'That is not a URL this build can use as a relay.'
    )
  })

  it('carries the disclosure line verbatim and no Test button', () => {
    render(<RelayCard relayUrl={RELAY} />, { wrapper: Wrapper })
    expect(
      screen.getByText(
        'Peers connect to each other directly. When a direct connection fails, this relay ' +
          'carries the connection instead. The relay can see which installations connected, ' +
          'when, and how much data passed. It cannot read Case content: the connection is ' +
          'encrypted between the two peers. Case files on this disk are not encrypted by ' +
          'Birdbrain.'
      )
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Test' })).toBeNull()
  })
})

describe('RecoveryCard', () => {
  it('carries the copy verbatim with the action disabled', () => {
    render(<RecoveryCard />)
    expect(screen.getByText('Recovery')).toBeTruthy()
    expect(screen.getByText('Create a new Case from my copy')).toBeTruthy()
    expect(
      screen.getByText(
        'For when the Owner’s machine is lost. Makes a separate Case from the copy on this ' +
          'machine, with you as Owner and a lineage entry pointing back here. This Case is left ' +
          'as it is.'
      )
    ).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Create new Case…' })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.className).toContain('text-danger-fg')
  })
})
