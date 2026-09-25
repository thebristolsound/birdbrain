// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { AnnotationPin, AnnotationShape, AnnotationsBundle } from '@shared/types'

// Konva draws to a canvas jsdom does not have. The stub stands in for the
// stage with one control per gesture the editor listens for.
vi.mock('@renderer/components/captures/annotation/AnnotationCanvas', () => ({
  AnnotationCanvas: (props: {
    shapes: AnnotationShape[]
    selectedId?: string | null
    onSelect?: (id: string | null) => void
    onPinDrop?: (x: number, y: number) => void
    onPinClick?: (pinId: string) => void
    onShapeChange?: (next: AnnotationShape) => void
  }) => (
    <div>
      <button onClick={() => props.onPinDrop?.(400, 100)}>drop near top</button>
      <button onClick={() => props.onPinDrop?.(400, 900)}>drop near bottom</button>
      <button onClick={() => props.onSelect?.(null)}>empty stage</button>
      {props.shapes.map((s) =>
        s.kind === 'pin' ? (
          <button
            key={s.id}
            onClick={() => {
              props.onSelect?.(s.id)
              props.onPinClick?.(s.pinId)
            }}
          >
            {`canvas pin ${s.number}`}
          </button>
        ) : null
      )}
      {props.shapes.map((s) =>
        s.kind === 'pin' ? (
          <button key={`drag-${s.id}`} onClick={() => props.onShapeChange?.({ ...s, x: s.x + 20 })}>
            {`drag pin ${s.number}`}
          </button>
        ) : null
      )}
      <span data-testid="selected-shape">{props.selectedId ?? ''}</span>
    </div>
  )
}))

import { AnnotationEditor } from '@renderer/components/captures/annotation/AnnotationEditor'
import { useAnnotationEditor } from '@renderer/components/captures/annotation/useAnnotationEditor'
import { useZoomPan } from '@renderer/components/captures/annotation/useZoomPan'
import { fakeBridge } from '../renderer/fakeBridge'

const NOW = Date.parse('2026-09-20T12:00:00.000Z')

function pin(id: string, number: number, body: string): AnnotationPin {
  return {
    id,
    captureId: 'cap1',
    number,
    body,
    createdAt: new Date(NOW - 2 * 3_600_000).toISOString(),
    updatedAt: new Date(NOW - 2 * 3_600_000).toISOString()
  }
}

function pinShape(pinId: string, number: number, y = 200): AnnotationShape {
  return { kind: 'pin', id: `shape-${pinId}`, pinId, number, x: 300, y }
}

let pins: AnnotationPin[]
let shapes: AnnotationShape[]
let upsertPin: ReturnType<typeof vi.fn>
let deletePin: ReturnType<typeof vi.fn>
let getAnnotations: ReturnType<typeof vi.fn>
let save: ReturnType<typeof vi.fn>

function bundle(): AnnotationsBundle {
  return {
    annotations: {
      captureId: 'cap1',
      schemaVersion: 1,
      shapes,
      imageWidth: 1000,
      imageHeight: 1000,
      updatedAt: '2026-09-20T10:00:00.000Z',
      updatedBy: null
    },
    pins
  }
}

function Harness({ overlayVisible = true }: { overlayVisible?: boolean }) {
  const editor = useAnnotationEditor({ initialShapes: [] })
  const zoomPan = useZoomPan({
    imageWidth: 1000,
    imageHeight: 1000,
    containerWidth: 1000,
    containerHeight: 800
  })
  return (
    <AnnotationEditor
      captureId="cap1"
      imageUrl="data:image/png;base64,"
      imageWidth={1000}
      imageHeight={1000}
      containerWidth={1000}
      containerHeight={800}
      editor={editor}
      zoomPan={zoomPan}
      overlayVisible={overlayVisible}
    />
  )
}

function renderEditor(overlayVisible = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<Harness overlayVisible={overlayVisible} />, { wrapper: Wrapper })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  pins = [pin('p1', 1, 'Support email uses a lookalike domain'), pin('p2', 2, '')]
  shapes = [pinShape('p2', 2, 900), pinShape('p1', 1)]
  upsertPin = vi.fn(async ({ id, body }: { id: string; body: string }) => {
    const created = pin(id, pins.length + 1, body)
    pins = [...pins.filter((p) => p.id !== id), created]
    return created
  })
  deletePin = vi.fn(async () => undefined)
  getAnnotations = vi.fn(async () => bundle())
  save = vi.fn(async () => bundle().annotations)
  fakeBridge({
    annotations: {
      get: getAnnotations,
      save,
      upsertPin,
      deletePin
    }
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('AnnotationEditor pin legend', () => {
  it('lists every pin in number order with its note, and counts them', async () => {
    renderEditor()
    const legend = await screen.findByTestId('pin-legend')

    expect(legend.textContent).toContain('Pins2')
    const rows = within(legend).getAllByRole('button')
    expect(rows.map((r) => r.textContent)).toEqual([
      '1Support email uses a lookalike domain',
      '2No note'
    ])
  })

  it('opens a row to its meta and rings the pin it describes', async () => {
    renderEditor()
    const legend = await screen.findByTestId('pin-legend')
    const [first] = within(legend).getAllByRole('button')

    fireEvent.click(first)
    expect(first.getAttribute('aria-expanded')).toBe('true')
    expect(first.textContent).toContain('Pin 1 · 2 hours ago')
    expect(screen.getByTestId('selected-shape').textContent).toBe('shape-p1')

    fireEvent.click(first)
    expect(first.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByTestId('selected-shape').textContent).toBe('')
  })

  it('hides with the overlay', async () => {
    const { rerender } = renderEditor(false)
    await waitFor(() => expect(getAnnotations).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByTestId('pin-legend')).toBeNull()
    rerender(<Harness overlayVisible />)
    expect(await screen.findByTestId('pin-legend')).toBeDefined()
  })
})

describe('AnnotationEditor pin popover', () => {
  it('opens a saved pin on its note, meta line and delete control', async () => {
    renderEditor()
    fireEvent.click(await screen.findByText('canvas pin 1'))

    const popover = screen.getByTestId('pin-popover')
    expect(popover.textContent).toContain('Support email uses a lookalike domain')
    expect(popover.textContent).toContain('Pin 1 · 2 hours ago')
    expect(within(popover).queryByRole('textbox')).toBeNull()
    // Pin 1 sits in the top half, so the popover hangs below it.
    expect(popover.style.transform).toMatch(/^translate\(-50%, \d/)
  })

  it('flips above a pin in the lower part of the image', async () => {
    renderEditor()
    fireEvent.click(await screen.findByText('canvas pin 2'))
    expect(screen.getByTestId('pin-popover').style.transform).toContain('calc(-100% -')
  })

  it('deletes a saved pin from its popover', async () => {
    renderEditor()
    fireEvent.click(await screen.findByText('canvas pin 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete pin' }))

    await waitFor(() => expect(deletePin).toHaveBeenCalledWith('p1'))
    expect(deletePin).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('pin-popover')).toBeNull()
    expect(screen.queryByText('canvas pin 1')).toBeNull()
    expect(screen.getByText('canvas pin 2')).toBeDefined()
    const legend = screen.getByTestId('pin-legend')
    expect(within(legend).getAllByRole('button').map((r) => r.textContent)).toEqual(['2No note'])
  })

  it('still lets a saved note be corrected', async () => {
    renderEditor()
    fireEvent.click(await screen.findByText('canvas pin 1'))
    fireEvent.click(screen.getByTitle('Edit note'))

    const box = screen.getByPlaceholderText('What does this pin mark?')
    fireEvent.change(box, { target: { value: 'Corrected note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(upsertPin).toHaveBeenCalledWith({
        captureId: 'cap1',
        id: 'p1',
        body: 'Corrected note'
      })
    )
    expect(screen.queryByTestId('pin-popover')).toBeNull()
  })

  it('backs out of an edit without touching the pin', async () => {
    renderEditor()
    fireEvent.click(await screen.findByText('canvas pin 1'))
    fireEvent.click(screen.getByTitle('Edit note'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByTitle('Edit note').textContent).toBe('Support email uses a lookalike domain')
    expect(deletePin).not.toHaveBeenCalled()
    expect(upsertPin).not.toHaveBeenCalled()
  })

  it('closes a saved pin on Escape and on a click on the empty stage', async () => {
    renderEditor()
    fireEvent.click(await screen.findByText('canvas pin 1'))
    fireEvent.keyDown(screen.getByTestId('pin-popover'), { key: 'Escape' })
    expect(screen.queryByTestId('pin-popover')).toBeNull()

    fireEvent.click(screen.getByText('canvas pin 1'))
    fireEvent.click(screen.getByText('empty stage'))
    expect(screen.queryByTestId('pin-popover')).toBeNull()
    expect(deletePin).not.toHaveBeenCalled()
  })

  it('asks for a new pin note with Add pin, and saves what was typed', async () => {
    renderEditor()
    await screen.findByTestId('pin-legend')
    fireEvent.click(screen.getByText('drop near top'))

    const box = await screen.findByPlaceholderText('What does this pin mark?')
    fireEvent.change(box, { target: { value: 'Form posts off-domain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add pin' }))

    const newId = upsertPin.mock.calls[0][0].id as string
    await waitFor(() =>
      expect(upsertPin).toHaveBeenLastCalledWith({
        captureId: 'cap1',
        id: newId,
        body: 'Form posts off-domain'
      })
    )
    expect(screen.queryByTestId('pin-popover')).toBeNull()
  })

  it('discards a new pin when its note is cancelled', async () => {
    renderEditor()
    await screen.findByTestId('pin-legend')
    fireEvent.click(screen.getByText('drop near bottom'))

    await screen.findByPlaceholderText('What does this pin mark?')
    const newId = upsertPin.mock.calls[0][0].id as string
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(deletePin).toHaveBeenCalledWith(newId))
    expect(deletePin).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('pin-popover')).toBeNull()
    expect(screen.queryByText('canvas pin 3')).toBeNull()
    expect(screen.getByText('canvas pin 1')).toBeDefined()
    expect(screen.getByText('canvas pin 2')).toBeDefined()
  })

  it('discards a new pin on Escape as well', async () => {
    renderEditor()
    await screen.findByTestId('pin-legend')
    fireEvent.click(screen.getByText('drop near top'))

    const box = await screen.findByPlaceholderText('What does this pin mark?')
    fireEvent.keyDown(box, { key: 'Escape' })

    const newId = upsertPin.mock.calls[0][0].id as string
    await waitFor(() => expect(deletePin).toHaveBeenCalledWith(newId))
    expect(deletePin).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('canvas pin 3')).toBeNull()
    expect(screen.getByText('canvas pin 1')).toBeDefined()
    expect(screen.getByText('canvas pin 2')).toBeDefined()
  })

  it('keeps a cancelled new pin out of undo, since its record is gone', async () => {
    renderEditor()
    await screen.findByTestId('pin-legend')
    fireEvent.click(screen.getByText('drop near bottom'))

    await screen.findByPlaceholderText('What does this pin mark?')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(deletePin).toHaveBeenCalledTimes(1))

    for (let i = 0; i < 2; i++) {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
      expect(screen.queryByText('canvas pin 3')).toBeNull()
      expect(screen.getByText('canvas pin 1')).toBeDefined()
      expect(screen.getByText('canvas pin 2')).toBeDefined()
    }
  })

  it('keeps a cancelled new pin out of undo after it was moved', async () => {
    renderEditor()
    await screen.findByTestId('pin-legend')
    fireEvent.click(screen.getByText('drop near bottom'))
    await screen.findByPlaceholderText('What does this pin mark?')

    // Clicking the new pin keeps its note box a draft; dragging it then puts
    // a snapshot holding it on the undo stack.
    fireEvent.click(screen.getByText('canvas pin 3'))
    fireEvent.click(screen.getByText('drag pin 3'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(deletePin).toHaveBeenCalledTimes(1))

    for (let i = 0; i < 2; i++) {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
      expect(screen.queryByText('canvas pin 3')).toBeNull()
      expect(screen.getByText('canvas pin 1')).toBeDefined()
      expect(screen.getByText('canvas pin 2')).toBeDefined()
    }
  })

  it('saves the canvas again when a new pin is cancelled after the autosave', async () => {
    renderEditor()
    await screen.findByTestId('pin-legend')
    fireEvent.click(screen.getByText('drop near bottom'))
    await screen.findByPlaceholderText('What does this pin mark?')
    const newId = upsertPin.mock.calls[0][0].id as string

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 3000 })
    // Let the save settle so the editor is clean before the note is cancelled.
    await new Promise((resolve) => setTimeout(resolve, 50))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2), { timeout: 3000 })
    const saved = save.mock.calls[1][0].shapes as AnnotationShape[]
    expect(saved.map((s) => (s.kind === 'pin' ? s.pinId : s.id)).sort()).toEqual(['p1', 'p2'])
    expect(saved.some((s) => s.kind === 'pin' && s.pinId === newId)).toBe(false)
  })
})
