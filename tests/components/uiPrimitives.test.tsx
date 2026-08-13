// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Badge, CardPanel, SectionLabel } from '@renderer/components/ui'

describe('design-system primitives', () => {
  afterEach(() => {
    cleanup()
  })

  describe('SectionLabel', () => {
    it('renders the faint eyebrow by default', () => {
      render(<SectionLabel>Chain of custody</SectionLabel>)
      const el = screen.getByText('Chain of custody')
      expect(el.className).toContain('text-[10px]')
      expect(el.className).toContain('text-text-faint')
      expect(el.className).toContain('tracking-label')
    })

    it('lifts to the strong step on request', () => {
      render(<SectionLabel emphasis="strong">Hash chain</SectionLabel>)
      const el = screen.getByText('Hash chain')
      expect(el.className).toContain('text-[11px]')
      expect(el.className).toContain('text-text-secondary')
    })
  })

  describe('Badge', () => {
    it('renders a status variant as a tinted triple', () => {
      render(<Badge variant="success">Connected</Badge>)
      const el = screen.getByText('Connected')
      expect(el.className).toContain('bg-success-surface')
      expect(el.className).toContain('border-success-line')
      expect(el.className).toContain('text-success-fg')
    })

    it('omits the leading dot unless asked for it', () => {
      const { container } = render(<Badge variant="success">Connected</Badge>)
      expect(container.querySelectorAll('[aria-hidden]')).toHaveLength(0)
    })

    it('renders a pulsing dot when asked for it', () => {
      const { container } = render(
        <Badge variant="success" size="pill" dot pulse>
          Connected
        </Badge>
      )
      const dot = container.querySelector('[aria-hidden]')
      expect(dot).not.toBeNull()
      expect(dot?.className).toContain('rounded-full')
      expect(dot?.className).toContain('animate-pulse')
      expect(screen.getByText('Connected').textContent).toBe('Connected')
    })
  })

  describe('CardPanel', () => {
    it('inverts Card: stronger border on the dimmer surface', () => {
      render(<CardPanel data-testid="panel">nested</CardPanel>)
      const el = screen.getByTestId('panel')
      expect(el.className).toContain('border-border-strong')
      expect(el.className).toContain('bg-surface')
      expect(el.className).toContain('rounded-lg')
    })
  })
})
