// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ConnectionStatus } from '@renderer/components/status/ConnectionStatus'
import { useAppStore } from '@renderer/stores/appStore'

beforeEach(() => {
  useAppStore.setState({ connectedToExtension: false, sessionActive: false })
})

afterEach(() => {
  cleanup()
})

describe('ConnectionStatus', () => {
  it('shows the Connected chip while a session is active (#702)', () => {
    useAppStore.setState({ connectedToExtension: true, sessionActive: true })

    render(<ConnectionStatus />)

    expect(screen.getByText('Connected')).toBeDefined()
  })

  it('shows the Connected chip when connected and idle', () => {
    useAppStore.setState({ connectedToExtension: true, sessionActive: false })

    render(<ConnectionStatus />)

    expect(screen.getByText('Connected')).toBeDefined()
  })

  it('renders nothing while disconnected', () => {
    const { container } = render(<ConnectionStatus />)

    expect(container.firstChild).toBeNull()
    expect(screen.queryByText('Connected')).toBeNull()
  })
})
