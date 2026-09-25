// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import {
  Badge,
  Button,
  CardPanel,
  CardTitle,
  Dialog,
  DialogContent,
  SectionLabel
} from '@renderer/components/ui'
import { useAppStore } from '@renderer/stores/appStore'

describe('design-system primitives', () => {
  afterEach(() => {
    cleanup()
    useAppStore.setState({ openDialogCount: 0 })
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

  describe('Button', () => {
    // The default variant's shadow token is `none`, which invalidates a
    // box-shadow ring composed with it, so the ring painted nothing (#1536).
    // An outline in the ring token is drawn whatever the variant's shadow.
    it.each(['default', 'outline', 'ghost', 'destructive'] as const)(
      'draws its keyboard focus as an outline in the ring token (%s)',
      (variant) => {
        render(<Button variant={variant}>Save</Button>)
        const { className } = screen.getByRole('button', { name: 'Save' })
        expect(className).toContain('focus-visible:outline-2')
        expect(className).toContain('focus-visible:outline-ring')
        expect(className).not.toContain('focus-visible:outline-none')
        expect(className).not.toContain('focus-visible:ring-2')
      }
    )
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

  describe('CardTitle', () => {
    it('renders a level-3 heading at the 12px display step', () => {
      render(<CardTitle>Chain of custody</CardTitle>)
      const el = screen.getByRole('heading', { level: 3 })
      expect(el.textContent).toBe('Chain of custody')
      expect(el.className).toContain('text-xs')
      expect(el.className).toContain('tracking-display')
    })

    // The documented escape hatch for a head that needs to stay larger — it
    // only works if the merge drops the default rather than emitting both.
    it('lets a call site override the size instead of stacking both', () => {
      render(<CardTitle className="text-sm">Hash chain</CardTitle>)
      const el = screen.getByRole('heading', { level: 3 })
      expect(el.className).toContain('text-sm')
      expect(el.className).not.toContain('text-xs')
    })
  })

  describe('Dialog', () => {
    it('closes on Escape', () => {
      const onOpenChange = vi.fn()
      render(
        <Dialog open onOpenChange={onOpenChange}>
          <p>body</p>
        </Dialog>
      )

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    // A Mention autocomplete inside the dialog dismisses itself on Escape and
    // marks the event handled. The listener is on the window, so it still
    // fires — and closing the dialog here would throw away the note being
    // written, which is exactly what dismissing a popup must not do.
    it('leaves an Escape something inside it already handled alone', () => {
      const onOpenChange = vi.fn()
      render(
        <Dialog open onOpenChange={onOpenChange}>
          <p>body</p>
        </Dialog>
      )

      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
      event.preventDefault()
      window.dispatchEvent(event)

      expect(onOpenChange).not.toHaveBeenCalled()
    })

    // AnimatePresence keeps the content mounted for the exit animation, so
    // role="dialog" outlives the close by ~150ms and a DOM query for it is not
    // a truthful "a dialog is up" signal. The registration is, and it has to
    // track `open` rather than the unmount (#686).
    it('registers while open and releases on close, before the exit animation ends', () => {
      const { rerender } = render(
        <Dialog open onOpenChange={() => {}}>
          <DialogContent onClose={() => {}}>body</DialogContent>
        </Dialog>
      )
      expect(useAppStore.getState().openDialogCount).toBe(1)

      rerender(
        <Dialog open={false} onOpenChange={() => {}}>
          <DialogContent onClose={() => {}}>body</DialogContent>
        </Dialog>
      )

      expect(document.querySelector('[role="dialog"]')).not.toBeNull()
      expect(useAppStore.getState().openDialogCount).toBe(0)
    })

    it('counts nested dialogs so closing the inner one leaves the outer registered', () => {
      const { rerender } = render(
        <>
          <Dialog open onOpenChange={() => {}}>
            <p>outer</p>
          </Dialog>
          <Dialog open onOpenChange={() => {}}>
            <p>inner</p>
          </Dialog>
        </>
      )
      expect(useAppStore.getState().openDialogCount).toBe(2)

      rerender(
        <>
          <Dialog open onOpenChange={() => {}}>
            <p>outer</p>
          </Dialog>
          <Dialog open={false} onOpenChange={() => {}}>
            <p>inner</p>
          </Dialog>
        </>
      )
      expect(useAppStore.getState().openDialogCount).toBe(1)
    })

    it('releases the registration when an open dialog unmounts', () => {
      const { unmount } = render(
        <Dialog open onOpenChange={() => {}}>
          <p>body</p>
        </Dialog>
      )
      expect(useAppStore.getState().openDialogCount).toBe(1)

      unmount()

      expect(useAppStore.getState().openDialogCount).toBe(0)
    })
  })
})
