// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { AppToaster, TOAST_DURATION_MS } from '@renderer/components/ui/toaster'
import { notify } from '@renderer/lib/notify'

afterEach(() => {
  act(() => {
    toast.dismiss()
  })
  cleanup()
})

// The mock draws one toast (Birdbrain.dc.html 3907-3923); these pin the parts
// of it that are ours to set rather than sonner's defaults.
describe('AppToaster', () => {
  it('stacks bottom-centre, 22px up, in a 520px lane', async () => {
    render(<AppToaster />)
    act(() => {
      notify.success('Investigation created')
    })

    await screen.findByText('Investigation created')
    const lane = document.querySelector('[data-sonner-toaster]') as HTMLElement
    expect(lane.dataset.yPosition).toBe('bottom')
    expect(lane.dataset.xPosition).toBe('center')
    expect(lane.style.getPropertyValue('--width')).toBe('520px')
    expect(lane.style.getPropertyValue('--offset-bottom')).toBe('22px')
  })

  it('renders a title, a truncated subtitle, a check medallion and a Dismiss control', async () => {
    render(<AppToaster />)
    act(() => {
      notify.success('Export written', { description: 'Evidence package · /tmp/case.zip' })
    })

    const title = await screen.findByText('Export written')
    const item = title.closest('[data-sonner-toast]') as HTMLElement
    // Unstyled: sonner's own skin would outrank these utilities.
    expect(item.dataset.styled).toBe('false')
    expect(item.className).toContain('max-w-[520px]')
    expect(item.className).toContain('bg-card')
    expect(screen.getByText('Evidence package · /tmp/case.zip').className).toContain('truncate')
    const medallion = item.querySelector('[data-testid="toast-medallion"]') as HTMLElement
    expect(medallion.className).toContain('text-success-fg')

    // The X sits after the content, not in sonner's top-left corner badge.
    const dismiss = screen.getByRole('button', { name: 'Dismiss' })
    expect(dismiss.className).toContain('order-last')
    fireEvent.click(dismiss)
    await waitFor(() => expect(screen.queryByText('Export written')).toBeNull())
  })

  it('runs a subtle-accent action and closes the toast', async () => {
    const onClick = vi.fn()
    render(<AppToaster />)
    act(() => {
      notify.success('Archive saved', {
        description: '/tmp/case.bbcase',
        action: { label: 'Show in folder', onClick }
      })
    })

    const action = await screen.findByRole('button', { name: 'Show in folder' })
    expect(action.className).toContain('bg-accent-subtle')
    expect(action.className).not.toMatch(/(^|\s)bg-accent(\s|$)/)
    fireEvent.click(action)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('tints error toasts with the danger medallion', async () => {
    render(<AppToaster />)
    act(() => {
      toast.error('Something failed')
    })

    const title = await screen.findByText('Something failed')
    const item = title.closest('[data-sonner-toast]') as HTMLElement
    const medallion = item.querySelector('[data-testid="toast-medallion"]') as HTMLElement
    expect(medallion.className).toContain('text-danger-fg')
  })

  it('holds toasts for the mock six seconds', () => {
    expect(TOAST_DURATION_MS).toBe(6000)
  })
})
