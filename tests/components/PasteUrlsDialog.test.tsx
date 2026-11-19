// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Each render of the box hands over the way that opening reports a finished queue, as the
// queue's own late answer would still hold it.
const finishes = vi.hoisted(() => [] as Array<() => void>)
vi.mock('@renderer/components/captures/AddUrlsBox', () => ({
  AddUrlsBox: ({ caseId, onQueued }: { caseId: string; onQueued?: () => void }) => {
    // Stands in for what the Operator has typed, which belongs to one opening.
    const [typed, setTyped] = useState('')
    finishes.push(() => onQueued?.())
    return (
      <div data-testid="box">
        {caseId}
        <input aria-label="URLs" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </div>
    )
  }
}))

import { PasteUrlsDialog } from '@renderer/components/captures/PasteUrlsDialog'

beforeEach(() => {
  finishes.length = 0
})

afterEach(cleanup)

describe('PasteUrlsDialog', () => {
  it('closes when the queue of the opening on screen finishes', async () => {
    const onOpenChange = vi.fn()
    render(<PasteUrlsDialog caseId="case-1" open onOpenChange={onOpenChange} />)
    expect((await screen.findByTestId('box')).textContent).toBe('case-1')
    finishes[finishes.length - 1]()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // A queue can finish after its dialog has closed, and another opening can be up by then.
  it('ignores a queue that finishes after its opening has closed', async () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <PasteUrlsDialog caseId="case-1" open onOpenChange={onOpenChange} />
    )
    await screen.findByTestId('box')
    const finishFirst = finishes[finishes.length - 1]

    rerender(<PasteUrlsDialog caseId="case-1" open={false} onOpenChange={onOpenChange} />)
    await waitFor(() => expect(screen.queryByTestId('box')).toBeNull())
    rerender(<PasteUrlsDialog caseId="case-2" open onOpenChange={onOpenChange} />)
    expect((await screen.findByTestId('box')).textContent).toBe('case-2')

    finishFirst()
    expect(onOpenChange).not.toHaveBeenCalled()
    finishes[finishes.length - 1]()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // The closing animation keeps the old content on screen for a moment, and the dialog can be
  // opened again inside that moment.
  it('ignores an earlier queue when the dialog reopens before its content has gone', async () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <PasteUrlsDialog caseId="case-1" open onOpenChange={onOpenChange} />
    )
    await screen.findByTestId('box')
    const finishFirst = finishes[finishes.length - 1]

    rerender(<PasteUrlsDialog caseId="case-1" open={false} onOpenChange={onOpenChange} />)
    rerender(<PasteUrlsDialog caseId="case-1" open onOpenChange={onOpenChange} />)
    await screen.findByTestId('box')

    finishFirst()
    expect(onOpenChange).not.toHaveBeenCalled()
    finishes[finishes.length - 1]()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // The earlier opening's box clears its own field when its queue finishes. A later opening
  // needs a box of its own, or that would clear what is typed into it.
  it('gives each opening a box of its own, even when reopened before the old one has gone', async () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <PasteUrlsDialog caseId="case-1" open onOpenChange={onOpenChange} />
    )
    fireEvent.change(await screen.findByLabelText('URLs'), { target: { value: 'https://a.test' } })
    rerender(<PasteUrlsDialog caseId="case-1" open={false} onOpenChange={onOpenChange} />)
    rerender(<PasteUrlsDialog caseId="case-1" open onOpenChange={onOpenChange} />)
    expect((await screen.findByLabelText<HTMLInputElement>('URLs')).value).toBe('')
  })

  it('ignores a queue that finishes while the dialog is closed', async () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <PasteUrlsDialog caseId="case-1" open onOpenChange={onOpenChange} />
    )
    await screen.findByTestId('box')
    const finishFirst = finishes[finishes.length - 1]
    rerender(<PasteUrlsDialog caseId="case-1" open={false} onOpenChange={onOpenChange} />)
    finishFirst()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
