// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { DeleteTagDialog } from '@renderer/components/signals/DeleteTagDialog'
import { fakeBridge } from '../renderer/fakeBridge'

let remove: ReturnType<typeof vi.fn>

function renderDialog() {
  const onOpenChange = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  render(
    <DeleteTagDialog open onOpenChange={onOpenChange} tag={{ id: 't-src', name: 'osint' }} />,
    {
      wrapper: Wrapper
    }
  )
  return { onOpenChange }
}

beforeEach(() => {
  remove = vi.fn(async () => true)
  fakeBridge({ tags: { delete: remove } })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DeleteTagDialog accessible name (#1537)', () => {
  it('is named by its visible title', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog')
    const title = screen.getByRole('heading', { name: /Delete ‘osint’\?/ })
    expect(title.id).toBeTruthy()
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id)
    expect(dialog.getAttribute('aria-label')).toBeNull()
  })
})

describe('DeleteTagDialog copy', () => {
  // Tags are app-global and the operator is looking at one case. This dialog
  // is the only place the blast radius gets said before the write, so the copy
  // is pinned the same way the merge dialog's is (#828, #957).
  it('warns that the delete reaches every case and takes the tag with it', () => {
    renderDialog()

    expect(screen.getByText(/in every case, not only this one/)).toBeTruthy()
    expect(screen.getByText(/will lose the tag/)).toBeTruthy()
    expect(screen.getByText(/will be\s+deleted/)).toBeTruthy()
    expect(screen.getByText(/cannot be undone/)).toBeTruthy()
  })

  // What a tag delete destroys is the links, not the evidence they point at.
  // A confirmation that overstates the damage is its own defect: the operator
  // cancels a safe action.
  it('says the captures and notes themselves survive', () => {
    renderDialog()

    expect(screen.getByText(/captures and\s+notes themselves are not deleted/)).toBeTruthy()
  })

  it('names the tag in the title and on the button', () => {
    renderDialog()

    expect(screen.getByText(/Delete ‘osint’\?/)).toBeTruthy()
    expect(screen.getByTestId('delete-tag-confirm').textContent).toContain("Delete 'osint'")
  })
})

describe('DeleteTagDialog commit', () => {
  it('deletes the tag and closes on confirm', async () => {
    const { onOpenChange } = renderDialog()

    fireEvent.click(screen.getByTestId('delete-tag-confirm'))

    await waitFor(() => expect(remove).toHaveBeenCalledWith('t-src'))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('cancel closes without deleting', async () => {
    const { onOpenChange } = renderDialog()

    fireEvent.click(screen.getByTestId('delete-tag-cancel'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    await waitFor(() => expect(remove).not.toHaveBeenCalled())
  })

  it('stays open when the delete fails, so the operator can retry', async () => {
    remove.mockRejectedValue(new Error('boom'))
    const { onOpenChange } = renderDialog()

    fireEvent.click(screen.getByTestId('delete-tag-confirm'))

    await waitFor(() => expect(remove).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('delete-tag-dialog')).toBeTruthy()
  })

  it('locks the button out while the delete is in flight', async () => {
    let settle: (value: boolean) => void = () => {}
    remove.mockImplementation(() => new Promise<boolean>((resolve) => (settle = resolve)))
    const { onOpenChange } = renderDialog()

    const confirm = screen.getByTestId('delete-tag-confirm')
    fireEvent.click(confirm)

    await waitFor(() => expect(confirm.textContent).toContain('Deleting…'))
    expect(confirm).toHaveProperty('disabled', true)

    settle(true)
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
