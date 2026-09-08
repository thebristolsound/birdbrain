// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Dialog, DialogContent } from '@renderer/components/ui'
import { useAppStore } from '@renderer/stores/appStore'

afterEach(() => {
  cleanup()
  useAppStore.setState({ openDialogCount: 0 })
})

// The surface behind the dialog. `onDelete` appends to a log rather than
// setting a flag, so a second firing is visible: the tag-delete case that
// found this could not tell the difference, because re-arming the same pending
// tag is idempotent (#1043).
function DeleteHarness() {
  const [open, setOpen] = useState(false)
  const [log, setLog] = useState<string[]>([])

  return (
    <>
      <button
        data-testid="row"
        onKeyDown={(e) => {
          if (e.key !== 'Delete') return
          setLog((entries) => [...entries, `delete-${entries.length}`])
          setOpen(true)
        }}
      >
        osint
      </button>
      <span data-testid="log">{log.join(',')}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onClose={() => setOpen(false)} data-testid="confirm">
          <button data-testid="confirm-cancel">Cancel</button>
          <button data-testid="confirm-delete">Delete</button>
        </DialogContent>
      </Dialog>
    </>
  )
}

function OpenerHarness({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button data-testid="opener" onClick={() => setOpen(true)}>
        Open
      </button>
      <button data-testid="behind">Behind</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onClose={() => setOpen(false)} data-testid="content">
          {children ?? (
            <>
              <button data-testid="first">First</button>
              <button data-testid="last" onClick={() => setOpen(false)}>
                Last
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

describe('Dialog focus trap', () => {
  it('moves focus to the first focusable inside when it opens', () => {
    render(<OpenerHarness />)

    screen.getByTestId('opener').focus()
    fireEvent.click(screen.getByTestId('opener'))

    expect(document.activeElement).toBe(screen.getByTestId('first'))
  })

  it('falls back to the dialog container when nothing inside can take focus', () => {
    render(<OpenerHarness>nothing focusable here</OpenerHarness>)

    fireEvent.click(screen.getByTestId('opener'))

    expect(document.activeElement).toBe(screen.getByTestId('content'))
  })

  it('wraps Tab from the last control back to the first instead of leaving the dialog', () => {
    render(<OpenerHarness />)
    fireEvent.click(screen.getByTestId('opener'))

    screen.getByTestId('last').focus()
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab' })

    expect(document.activeElement).toBe(screen.getByTestId('first'))
    expect(document.activeElement).not.toBe(screen.getByTestId('behind'))
  })

  it('wraps Shift-Tab from the first control round to the last', () => {
    render(<OpenerHarness />)
    fireEvent.click(screen.getByTestId('opener'))

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab', shiftKey: true })

    expect(document.activeElement).toBe(screen.getByTestId('last'))
  })

  it('pulls Tab from the container itself onto the first control', () => {
    render(<OpenerHarness />)
    fireEvent.click(screen.getByTestId('opener'))

    const content = screen.getByTestId('content')
    content.focus()
    fireEvent.keyDown(content, { key: 'Tab' })

    expect(document.activeElement).toBe(screen.getByTestId('first'))
  })

  it('keeps Tab on the container when the dialog has no controls at all', () => {
    render(<OpenerHarness>nothing focusable here</OpenerHarness>)
    fireEvent.click(screen.getByTestId('opener'))

    const content = screen.getByTestId('content')
    fireEvent.keyDown(content, { key: 'Tab' })

    expect(document.activeElement).toBe(content)
  })

  // The Mention autocomplete accepts its highlighted suggestion on Tab and
  // marks the event handled. Redirecting focus on top of that would move the
  // caret out of the note being written.
  it('leaves a Tab something inside it already handled alone', () => {
    render(
      <OpenerHarness>
        <button data-testid="editor" onKeyDown={(e) => e.preventDefault()}>
          Editor
        </button>
        <button data-testid="other">Other</button>
      </OpenerHarness>
    )
    fireEvent.click(screen.getByTestId('opener'))

    fireEvent.keyDown(screen.getByTestId('editor'), { key: 'Tab' })

    expect(document.activeElement).toBe(screen.getByTestId('editor'))
  })

  it('ignores keys that are not Tab', () => {
    render(<OpenerHarness />)
    fireEvent.click(screen.getByTestId('opener'))

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'a' })

    expect(document.activeElement).toBe(screen.getByTestId('first'))
  })

  // AnimatePresence keeps the content mounted for ~150ms after `open` goes
  // false. Focus goes back when the dialog stops owning the keyboard, not when
  // the exit animation finally ends.
  it('returns focus to the opener on close, before the exit animation ends', () => {
    render(<OpenerHarness />)
    const opener = screen.getByTestId('opener')
    opener.focus()
    fireEvent.click(opener)
    expect(document.activeElement).toBe(screen.getByTestId('first'))

    fireEvent.click(screen.getByTestId('last'))

    expect(document.activeElement).toBe(opener)
    expect(screen.getByTestId('content')).toBeTruthy()
  })

  // ConfirmDialog and RowEditModal both land focus on a control of their own
  // choosing from a passive effect. The trap runs in the layout phase so those
  // still get the last word.
  it('lets a dialog that picks its own landing control keep it', () => {
    function OwnLanding() {
      const cancel = useRef<HTMLButtonElement>(null)
      useEffect(() => {
        cancel.current?.focus()
      }, [])

      return (
        <>
          <button data-testid="first">First</button>
          <button data-testid="cancel" ref={cancel}>
            Cancel
          </button>
        </>
      )
    }

    render(
      <OpenerHarness>
        <OwnLanding />
      </OpenerHarness>
    )

    fireEvent.click(screen.getByTestId('opener'))

    expect(document.activeElement).toBe(screen.getByTestId('cancel'))
  })

  it('leaves an autoFocus control inside it holding focus', () => {
    render(
      <OpenerHarness>
        <button data-testid="first">First</button>
        <input data-testid="field" autoFocus />
      </OpenerHarness>
    )

    fireEvent.click(screen.getByTestId('opener'))

    expect(document.activeElement).toBe(screen.getByTestId('field'))
  })

  it('leaves focus where the dialog put it if the dialog moved it out itself', () => {
    function HandoffHarness() {
      const [open, setOpen] = useState(false)
      const elsewhere = useRef<HTMLButtonElement>(null)

      return (
        <>
          <button data-testid="opener" onClick={() => setOpen(true)}>
            Open
          </button>
          <button data-testid="elsewhere" ref={elsewhere}>
            Elsewhere
          </button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent onClose={() => setOpen(false)}>
              <button
                data-testid="hand-off"
                onClick={() => {
                  elsewhere.current?.focus()
                  setOpen(false)
                }}
              >
                Hand off
              </button>
            </DialogContent>
          </Dialog>
        </>
      )
    }

    render(<HandoffHarness />)
    screen.getByTestId('opener').focus()
    fireEvent.click(screen.getByTestId('opener'))

    fireEvent.click(screen.getByTestId('hand-off'))

    expect(document.activeElement).toBe(screen.getByTestId('elsewhere'))
  })
})

describe('Dialog keyboard containment', () => {
  // The falsifiable one: remove the trap and the second Delete lands on the
  // row again, because focus never left it.
  it('does not re-fire the action behind it when the same key is pressed again', async () => {
    render(<DeleteHarness />)
    const row = screen.getByTestId('row')
    row.focus()

    fireEvent.keyDown(row, { key: 'Delete' })

    expect(screen.getByTestId('log').textContent).toBe('delete-0')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('confirm-cancel')))

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Delete' })

    expect(screen.getByTestId('log').textContent).toBe('delete-0')
  })
})
