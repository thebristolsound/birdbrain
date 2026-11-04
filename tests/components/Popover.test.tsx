// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { useAppStore } from '@renderer/stores/appStore'
import { stubResizeObserver } from './resizeObserverStub'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button">Outside</button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger>Capture Session</PopoverTrigger>
        <PopoverContent aria-label="Panel">
          <button type="button">Inside</button>
        </PopoverContent>
      </Popover>
    </>
  )
}

beforeEach(() => {
  stubResizeObserver()
})

afterEach(() => {
  cleanup()
})

describe('Popover', () => {
  it('opens from its trigger and counts as an open dialog while it is open', async () => {
    render(<Harness />)
    expect(useAppStore.getState().openDialogCount).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Capture Session' }))
    expect(await screen.findByRole('dialog', { name: 'Panel' })).toBeTruthy()
    expect(useAppStore.getState().openDialogCount).toBe(1)
  })

  it('closes on Escape and releases the open-dialog count', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture Session' }))
    const panel = await screen.findByRole('dialog', { name: 'Panel' })
    act(() => {
      fireEvent.keyDown(panel, { key: 'Escape' })
    })
    expect(screen.queryByRole('dialog', { name: 'Panel' })).toBeNull()
    expect(useAppStore.getState().openDialogCount).toBe(0)
  })

  it('closes on a press outside it', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture Session' }))
    await screen.findByRole('dialog', { name: 'Panel' })
    // Radix starts listening for a press outside on the turn after it opens.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    const outside = screen.getByRole('button', { name: 'Outside' })
    act(() => {
      fireEvent.pointerDown(outside)
      fireEvent.click(outside)
    })
    expect(screen.queryByRole('dialog', { name: 'Panel' })).toBeNull()
  })

  it('marks itself for the guards that stand down while an overlay owns Escape', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture Session' }))
    const panel = await screen.findByRole('dialog', { name: 'Panel' })
    expect(panel.closest('[data-selection-escape-guard]')).not.toBeNull()
  })
})
