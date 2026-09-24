import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AnnotationShape } from '@shared/types'
import { annotationsQueryOptions, useAnnotationsMutations } from '@renderer/lib/queries'
import { AnnotationCanvas } from '@renderer/components/captures/annotation/AnnotationCanvas'
import { PinCommentPopover } from '@renderer/components/captures/annotation/PinCommentPopover'
import { PinLegend, type PinLegendRow } from '@renderer/components/captures/annotation/PinLegend'
import {
  isPin,
  pinPopoverStyle,
  type PinAnnotation
} from '@renderer/components/captures/annotation/pinGeometry'
import { formatRelativeTime } from '@renderer/lib/formatRelativeTime'
import { useAnnotationKeyboardShortcuts } from '@renderer/components/captures/annotation/keyboardShortcuts'
import type { useAnnotationEditor } from '@renderer/components/captures/annotation/useAnnotationEditor'
import type { useZoomPan } from '@renderer/components/captures/annotation/useZoomPan'

type EditorApi = ReturnType<typeof useAnnotationEditor>
type ZoomPanApi = ReturnType<typeof useZoomPan>

interface Props {
  captureId: string
  imageUrl: string
  imageWidth: number
  imageHeight: number
  containerWidth: number
  containerHeight: number
  editor: EditorApi
  zoomPan: ZoomPanApi
  overlayVisible: boolean
}

const EMPTY_ANNOTATIONS_VERSION_MARKER = '__empty__'

export function AnnotationEditor(props: Props) {
  const {
    captureId,
    imageUrl,
    imageWidth,
    imageHeight,
    containerWidth,
    containerHeight,
    editor,
    zoomPan,
    overlayVisible
  } = props

  const { data: bundle, isSuccess } = useQuery(annotationsQueryOptions(captureId))
  const mutations = useAnnotationsMutations(captureId)
  const { setShapes, select, dirty } = editor

  const [popoverPinShapeId, setPopoverPinShapeId] = useState<string | null>(null)
  // The pin dropped in this sitting whose note has not been added yet.
  const [draftPinShapeId, setDraftPinShapeId] = useState<string | null>(null)
  const [legendOpenShapeId, setLegendOpenShapeId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncedAnnotationsVersionRef = useRef<string | null>(null)
  const annotationsVersion = bundle?.annotations?.updatedAt ?? EMPTY_ANNOTATIONS_VERSION_MARKER

  useEffect(() => {
    if (!isSuccess || dirty) return
    if (syncedAnnotationsVersionRef.current === annotationsVersion) return
    setShapes(bundle?.annotations?.shapes ?? [])
    select(null)
    syncedAnnotationsVersionRef.current = annotationsVersion
  }, [isSuccess, dirty, setShapes, select, bundle?.annotations?.shapes, annotationsVersion])

  const closePopover = () => {
    setPopoverPinShapeId(null)
    setDraftPinShapeId(null)
  }
  const removePin = (shape: PinAnnotation) => {
    editor.removeShape(shape.id)
    mutations.deletePin.mutate(shape.pinId)
  }
  const handleZoomAt = (delta: number, cx: number, cy: number) => {
    closePopover()
    zoomPan.zoomAt(delta, cx, cy)
  }
  const handlePan = (dx: number, dy: number) => {
    closePopover()
    zoomPan.setPan(dx, dy)
  }
  const handleResetView = () => {
    closePopover()
    zoomPan.reset()
  }

  useAnnotationKeyboardShortcuts({
    enabled: true,
    setTool: editor.setTool,
    getTool: () => editor.tool,
    deselect: () => {
      editor.select(null)
      closePopover()
    },
    removeSelected: () => {
      if (!editor.selectedId) return
      const shape = editor.shapes.find((s) => s.id === editor.selectedId)
      if (shape && isPin(shape)) {
        removePin(shape)
        if (shape.id === popoverPinShapeId) closePopover()
      } else {
        editor.removeShape(editor.selectedId)
      }
    },
    undo: editor.undo,
    redo: editor.redo,
    zoomIn: () => handleZoomAt(1.25, containerWidth / 2, containerHeight / 2),
    zoomOut: () => handleZoomAt(0.8, containerWidth / 2, containerHeight / 2),
    resetView: handleResetView,
    oneToOne: () =>
      handleZoomAt(
        1 / zoomPan.fitScale / zoomPan.userScale,
        containerWidth / 2,
        containerHeight / 2
      )
  })

  useEffect(() => {
    if (!editor.dirty) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      mutations.save.mutate(
        { captureId, shapes: editor.shapes, imageWidth, imageHeight },
        { onSuccess: () => editor.clearDirty() }
      )
    }, 800)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [editor.dirty, editor.shapes, captureId, imageWidth, imageHeight, mutations.save])

  // Flush on unmount if dirty. Use a ref so the cleanup reads the latest state,
  // not state captured at mount time.
  const editorRef = useRef(editor)
  editorRef.current = editor
  // Intentional empty deps: this effect's cleanup must run only on unmount.
  // The cleanup reads the latest editor state via editorRef to avoid stale closure.
  useEffect(() => {
    return () => {
      const e = editorRef.current
      if (e.dirty) {
        mutations.save.mutate({ captureId, shapes: e.shapes, imageWidth, imageHeight })
      }
    }
  }, [])

  const onPinDrop = async (x: number, y: number) => {
    const tempPinId = crypto.randomUUID()
    const pin = await mutations.upsertPin.mutateAsync({ captureId, id: tempPinId, body: '' })
    const draft: AnnotationShape = {
      kind: 'pin',
      id: crypto.randomUUID(),
      pinId: pin.id,
      x,
      y,
      number: pin.number
    }
    editor.beginDraft(draft)
    editor.commitDraft()
    setPopoverPinShapeId(draft.id)
    setDraftPinShapeId(draft.id)
  }

  const pinShapes = editor.shapes.filter(isPin).sort((a, b) => a.number - b.number)
  const pinMeta = (shape: PinAnnotation) => {
    const pin = bundle?.pins.find((p) => p.id === shape.pinId)
    const when = pin ? formatRelativeTime(pin.createdAt) : ''
    return when ? `Pin ${shape.number} · ${when}` : `Pin ${shape.number}`
  }
  const legendRows: PinLegendRow[] = pinShapes.map((shape) => ({
    shapeId: shape.id,
    number: shape.number,
    body: bundle?.pins.find((p) => p.id === shape.pinId)?.body ?? '',
    meta: pinMeta(shape)
  }))
  const toggleLegendRow = (shapeId: string) => {
    const next = legendOpenShapeId === shapeId ? null : shapeId
    setLegendOpenShapeId(next)
    // Selecting the pin draws its ring on the canvas, which is how the open
    // row points at the mark it describes.
    editor.select(next)
  }

  const popoverShape = pinShapes.find((s) => s.id === popoverPinShapeId)
  const popoverPin = popoverShape
    ? bundle?.pins.find((p) => p.id === popoverShape.pinId)
    : undefined

  return (
    <div className="relative h-full w-full">
      <AnnotationCanvas
        imageUrl={imageUrl}
        imageWidth={imageWidth}
        imageHeight={imageHeight}
        shapes={overlayVisible ? editor.shapes : []}
        draft={overlayVisible ? editor.draft : null}
        selectedId={editor.selectedId}
        onSelect={(id) => {
          editor.select(id)
          if (id === null) closePopover()
        }}
        onShapeChange={editor.updateShape}
        editable={overlayVisible}
        tool={editor.tool}
        color={editor.color}
        strokeWidth={editor.strokeWidth}
        onDraftBegin={editor.beginDraft}
        onDraftExtend={editor.extendDraft}
        onDraftCommit={editor.commitDraft}
        onPinDrop={onPinDrop}
        onPinClick={(pinId) => {
          const shape = pinShapes.find((s) => s.pinId === pinId)
          if (!shape) return
          setPopoverPinShapeId(shape.id)
          if (shape.id !== draftPinShapeId) setDraftPinShapeId(null)
        }}
        containerWidth={containerWidth}
        containerHeight={containerHeight}
        scale={zoomPan.scale}
        panX={zoomPan.panX}
        panY={zoomPan.panY}
        onZoomAt={handleZoomAt}
        onPan={handlePan}
        onResetView={handleResetView}
      />
      {overlayVisible && legendRows.length > 0 && (
        <PinLegend rows={legendRows} openShapeId={legendOpenShapeId} onToggle={toggleLegendRow} />
      )}
      <PinCommentPopover
        // Remounted per pin, so moving straight from one pin to another never
        // carries the first one's half-typed note or edit state across.
        key={popoverShape?.id ?? 'none'}
        open={overlayVisible && popoverShape !== undefined}
        isDraft={popoverShape !== undefined && popoverShape.id === draftPinShapeId}
        initialBody={popoverPin?.body ?? ''}
        meta={popoverShape ? pinMeta(popoverShape) : ''}
        style={
          popoverShape
            ? pinPopoverStyle(popoverShape, zoomPan, imageHeight, containerWidth)
            : undefined
        }
        saving={mutations.upsertPin.isPending}
        onSave={(body) => {
          if (!popoverShape) return
          mutations.upsertPin.mutate({ captureId, id: popoverShape.pinId, body })
          closePopover()
        }}
        onCancelDraft={() => {
          if (popoverShape) removePin(popoverShape)
          closePopover()
        }}
        onDelete={() => {
          if (popoverShape) removePin(popoverShape)
          closePopover()
        }}
        onClose={closePopover}
      />
    </div>
  )
}
