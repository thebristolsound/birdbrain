import { useEffect, useMemo, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  capturesQueryOptions,
  settingsQueryOptions,
  useCapturesMutations,
  useSettingsMutations
} from '@renderer/lib/queries'
import { CaptureList } from '@renderer/components/captures/CaptureList'
import { CaptureViewer } from '@renderer/components/captures/CaptureViewer'
import { CaptureDetailsPanel } from '@renderer/components/captures/CaptureDetailsPanel'
import { CaptureDetailsRail } from '@renderer/components/captures/CaptureDetailsRail'
import { CaseHeader } from '@renderer/components/layout/CaseHeader'
import { AddNoteModal } from '@renderer/components/notes/AddNoteModal'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@renderer/components/ui'
import { useAppStore } from '@renderer/stores/appStore'
import { useViewportWidth } from '@renderer/hooks/useViewportWidth'
import { useReduceMotion } from '@renderer/hooks/useReduceMotion'

const COLLAPSE_THRESHOLD = 1100

export function CapturesRoute() {
  const { caseId } = useParams({ from: '/cases/$caseId/captures' })
  const selectedCaptureId = useAppStore((s) => s.selectedCaptureId)
  const setSelectedCaptureId = useAppStore((s) => s.setSelectedCaptureId)
  const selectCapture = useAppStore((s) => s.selectCapture)
  const setPanelCollapsedForced = useAppStore((s) => s.setPanelCollapsedForced)
  const panelCollapsedForced = useAppStore((s) => s.panelCollapsedForced)

  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))
  const { data: settings } = useQuery(settingsQueryOptions)
  const { update: updateSettings } = useSettingsMutations()
  const { remove: removeCapture } = useCapturesMutations(caseId)
  const reduceMotion = useReduceMotion()
  const viewportWidth = useViewportWidth()

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showAddNote, setShowAddNote] = useState(false)

  // Sync forced flag from viewport width.
  useEffect(() => {
    setPanelCollapsedForced(viewportWidth < COLLAPSE_THRESHOLD)
  }, [viewportWidth, setPanelCollapsedForced])

  const userPref = settings?.detailsPanelCollapsed ?? false
  const panelDisplayedCollapsed = panelCollapsedForced || userPref

  const selectedCapture = useMemo(
    () => captures.find((c) => c.id === selectedCaptureId) ?? null,
    [captures, selectedCaptureId]
  )

  function toggleUserPref() {
    updateSettings.mutate({ detailsPanelCollapsed: !userPref })
  }

  async function handleDelete() {
    if (!selectedCaptureId) return
    const id = selectedCaptureId
    await removeCapture.mutateAsync(id)
    setShowDeleteConfirm(false)
    const remaining = captures.filter((c) => c.id !== id)
    if (remaining.length > 0) {
      selectCapture(remaining[0].id)
    } else {
      setSelectedCaptureId(null)
    }
  }

  async function handleDownload() {
    if (!selectedCaptureId) return
    await window.birdbrain.captures.download(selectedCaptureId)
  }

  async function handleOpenExternal() {
    if (!selectedCapture) return
    await window.birdbrain.captures.openExternal(selectedCapture.url)
  }

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      <div className="flex w-[380px] shrink-0 flex-col border-r border-border">
        <CaseHeader />
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <CaptureList caseId={caseId} />
        </div>
      </div>
      <div className="flex flex-1 min-w-0 overflow-hidden">
        <CaptureViewer />
      </div>
      {selectedCapture && (
        <aside
          data-testid="capture-details-aside"
          className={`shrink-0 overflow-hidden border-l border-border bg-surface ${
            reduceMotion ? '' : 'transition-[width] duration-150'
          } ${panelDisplayedCollapsed ? 'w-10' : 'w-[400px] min-w-[400px]'}`}
        >
          {panelDisplayedCollapsed ? (
            <CaptureDetailsRail
              capture={selectedCapture}
              caseId={caseId}
              forced={panelCollapsedForced}
              onExpand={toggleUserPref}
              onOpenExternal={handleOpenExternal}
            />
          ) : (
            <CaptureDetailsPanel
              capture={selectedCapture}
              caseId={caseId}
              onCollapse={toggleUserPref}
              onDownload={handleDownload}
              onOpenExternal={handleOpenExternal}
              onDelete={() => setShowDeleteConfirm(true)}
              onOpenAddNote={() => setShowAddNote(true)}
            />
          )}
        </aside>
      )}

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent onClose={() => setShowDeleteConfirm(false)} className="w-80 max-w-80 p-5">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-sm">Delete Capture?</DialogTitle>
            <DialogDescription className="text-xs">
              This will permanently remove the capture and its files. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {selectedCapture && (
        <AddNoteModal
          open={showAddNote}
          caseId={caseId}
          captureId={selectedCapture.id}
          captureTitle={selectedCapture.title || ''}
          captureUrl={selectedCapture.url}
          onClose={() => setShowAddNote(false)}
        />
      )}
    </div>
  )
}
