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
import { openCaptureExternal } from '@renderer/lib/api/system'
import { notify } from '@renderer/lib/notify'

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
  // When the viewport forces the rail, the panel can still be opened as an
  // overlay so custody/Wayback/tags/notes stay reachable on narrow windows.
  const [forcedPanelOpen, setForcedPanelOpen] = useState(false)

  // Sync forced flag from viewport width.
  useEffect(() => {
    setPanelCollapsedForced(viewportWidth < COLLAPSE_THRESHOLD)
  }, [viewportWidth, setPanelCollapsedForced])

  useEffect(() => {
    if (!panelCollapsedForced) setForcedPanelOpen(false)
  }, [panelCollapsedForced])

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

  async function handleOpenExternal() {
    if (!selectedCapture) return
    try {
      await openCaptureExternal(selectedCapture.url)
    } catch (cause) {
      notify.error("Couldn't open the link in your browser", { cause })
    }
  }

  return (
    <div className="relative flex h-full flex-1 overflow-hidden">
      <div className="flex w-[380px] shrink-0 flex-col border-r border-border">
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
              onExpand={
                panelCollapsedForced ? () => setForcedPanelOpen(true) : toggleUserPref
              }
              onOpenExternal={handleOpenExternal}
            />
          ) : (
            <CaptureDetailsPanel
              capture={selectedCapture}
              caseId={caseId}
              onCollapse={toggleUserPref}
              onOpenExternal={handleOpenExternal}
              onDelete={() => setShowDeleteConfirm(true)}
              onOpenAddNote={() => setShowAddNote(true)}
            />
          )}
        </aside>
      )}

      {/* Overlay details panel for viewports too narrow for the docked panel */}
      {selectedCapture && panelCollapsedForced && forcedPanelOpen && (
        <div
          data-testid="capture-details-overlay"
          className="absolute right-0 top-0 z-40 h-full w-[400px] border-l border-border bg-surface shadow-xl"
        >
          <CaptureDetailsPanel
            capture={selectedCapture}
            caseId={caseId}
            onCollapse={() => setForcedPanelOpen(false)}
            onOpenExternal={handleOpenExternal}
            onDelete={() => setShowDeleteConfirm(true)}
            onOpenAddNote={() => setShowAddNote(true)}
          />
        </div>
      )}

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent onClose={() => setShowDeleteConfirm(false)} className="w-96 max-w-96 p-5">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-sm">Delete Capture?</DialogTitle>
            <DialogDescription className="text-xs">
              This removes the capture and its files from this machine, and cannot be undone.
              <br />
              <br />
              <strong className="text-text-primary">Deleting is not redacting.</strong> The case
              manifest is append-only, so this capture&apos;s URL, capture time and hashes stay in
              it permanently and ship in every export that includes the audit trail. A deletion
              entry is appended recording that you removed it.
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
