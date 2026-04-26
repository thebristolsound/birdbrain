import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pencil, Eye } from 'lucide-react'
import type { AnnotationShape } from '@shared/types'
import { annotationsQueryOptions, useAnnotationsMutations } from '@renderer/lib/queries'
import { AnnotationCanvas } from './AnnotationCanvas'
import { AnnotationToolbar } from './AnnotationToolbar'
import { PinCommentPopover } from './PinCommentPopover'
import { useAnnotationEditor } from './useAnnotationEditor'
import { useAnnotationKeyboardShortcuts } from './keyboardShortcuts'
import { useZoomPan } from './useZoomPan'

interface Props {
  captureId: string
  imageUrl: string
  imageWidth: number
  imageHeight: number
  containerWidth: number
  containerHeight: number
}

export function AnnotationEditor(props: Props) {
  const { captureId, imageUrl, imageWidth, imageHeight, containerWidth, containerHeight } = props
  const [editing, setEditing] = useState(false)
  const { data: bundle } = useQuery(annotationsQueryOptions(captureId))
  const mutations = useAnnotationsMutations(captureId)
  const editor = useAnnotationEditor({ initialShapes: bundle?.annotations?.shapes ?? [] })
  const zoomPan = useZoomPan({ imageWidth, imageHeight, containerWidth, containerHeight })
  const [popoverPinShapeId, setPopoverPinShapeId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useAnnotationKeyboardShortcuts({
    enabled: editing,
    setTool: editor.setTool,
    deselect: () => editor.select(null),
    removeSelected: () => {
      if (!editor.selectedId) return
      const shape = editor.shapes.find((s) => s.id === editor.selectedId)
      editor.removeShape(editor.selectedId)
      if (shape && shape.kind === 'pin') {
        mutations.deletePin.mutate(shape.pinId)
      }
    },
    undo: editor.undo,
    redo: editor.redo
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
  }

  const popoverShape = editor.shapes.find((s) => s.id === popoverPinShapeId && s.kind === 'pin') as
    | Extract<AnnotationShape, { kind: 'pin' }>
    | undefined
  const popoverPin = popoverShape
    ? bundle?.pins.find((p) => p.id === popoverShape.pinId)
    : undefined

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center justify-end border-b border-border bg-surface px-2 py-1">
        <button
          type="button"
          onClick={() => {
            setEditing((v) => !v)
            editor.select(null)
          }}
          className="flex items-center gap-1 rounded px-2 py-1 text-sm text-text-primary hover:bg-canvas"
        >
          {editing ? (
            <>
              <Eye size={14} /> View mode
            </>
          ) : (
            <>
              <Pencil size={14} /> Edit annotations
            </>
          )}
        </button>
      </div>
      {editing && (
        <AnnotationToolbar
          tool={editor.tool}
          setTool={editor.setTool}
          color={editor.color}
          setColor={editor.setColor}
          strokeWidth={editor.strokeWidth}
          setStrokeWidth={editor.setStrokeWidth}
          canUndo={editor.canUndo}
          canRedo={editor.canRedo}
          onUndo={editor.undo}
          onRedo={editor.redo}
        />
      )}
      <div className="relative flex-1 overflow-hidden bg-canvas">
        <AnnotationCanvas
          imageUrl={imageUrl}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          shapes={editor.shapes}
          draft={editor.draft}
          selectedId={editor.selectedId}
          onSelect={editor.select}
          onShapeChange={editor.updateShape}
          editable={editing}
          tool={editor.tool}
          color={editor.color}
          strokeWidth={editor.strokeWidth}
          onDraftBegin={editor.beginDraft}
          onDraftExtend={editor.extendDraft}
          onDraftCommit={editor.commitDraft}
          onPinDrop={onPinDrop}
          onPinClick={(pinId) => {
            const shape = editor.shapes.find((s) => s.kind === 'pin' && s.pinId === pinId)
            if (shape) setPopoverPinShapeId(shape.id)
          }}
          containerWidth={containerWidth}
          containerHeight={containerHeight}
          scale={zoomPan.scale}
          panX={zoomPan.panX}
          panY={zoomPan.panY}
          onZoomAt={zoomPan.zoomAt}
          onPan={zoomPan.setPan}
        />
        <PinCommentPopover
          open={popoverPinShapeId != null}
          pinNumber={popoverShape?.number || null}
          initialBody={popoverPin?.body ?? ''}
          saving={mutations.upsertPin.isPending}
          onSave={(body) => {
            if (!popoverShape) return
            mutations.upsertPin.mutate({ captureId, id: popoverShape.pinId, body })
            setPopoverPinShapeId(null)
          }}
          onClose={() => setPopoverPinShapeId(null)}
        />
      </div>
    </div>
  )
}
