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
import type { BatchDeleteOutcome, BatchDeleteResult } from '@shared/ipc'

const COLLAPSE_THRESHOLD = 1100

// Prefix-commit result, stated without an atomicity claim (batch-ops brief):
// committed entries, the single rolled-back failure and its stage, the ids
// never attempted, and rejected ids shown but excluded from retry.
function BatchDeleteSummary({ result }: { result: BatchDeleteResult }) {
  const rolledBack = result.outcomes.find(
    (o): o is Extract<BatchDeleteOutcome, { status: 'rolled_back' }> => o.status === 'rolled_back'
  )
  const notAttempted = result.outcomes.filter((o) => o.status === 'not_attempted').length
  const rejectedGone = result.outcomes.filter(
    (o) => o.status === 'rejected' && o.reason === 'not_found'
  ).length
  const rejectedDuplicate = result.outcomes.filter(
    (o) => o.status === 'rejected' && o.reason === 'duplicate'
  ).length
  const { committedEntries } = result.manifest
  const clean = !rolledBack && notAttempted === 0 && rejectedGone === 0 && rejectedDuplicate === 0
  return (
    <>
      {clean && <span>All selected captures were removed from this machine.</span>}
      {committedEntries > 0 && (
        <span>
          {' '}
          {committedEntries} deletion entr{committedEntries === 1 ? 'y was' : 'ies were'} appended
          to the case manifest.
        </span>
      )}
      {rolledBack && (
        <span className="mt-1.5 block">
          One capture could not be deleted
          {rolledBack.stage === 'artifacts'
            ? ' — its files could not be removed, so it is intact'
            : ' — its files were removed but its database record remains'}{' '}
          ({rolledBack.error}). Retry to attempt it again.
        </span>
      )}
      {notAttempted > 0 && (
        <span className="mt-1.5 block">
          {notAttempted} {notAttempted === 1 ? 'capture was' : 'captures were'} not attempted —
          deletion stops at the first failure.
        </span>
      )}
      {rejectedGone > 0 && (
        <span className="mt-1.5 block">
          {rejectedGone} {rejectedGone === 1 ? 'was' : 'were'} already gone (removed elsewhere) and
          will not be retried.
        </span>
      )}
      {rejectedDuplicate > 0 && (
        <span className="mt-1.5 block">
          {rejectedDuplicate} duplicate id{rejectedDuplicate === 1 ? ' was' : 's were'} ignored.
        </span>
      )}
    </>
  )
}

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
  const { remove: removeCapture, removeMany } = useCapturesMutations(caseId)
  const deselectCaptures = useAppStore((s) => s.deselectCaptures)
  const reduceMotion = useReduceMotion()
  const viewportWidth = useViewportWidth()

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showAddNote, setShowAddNote] = useState(false)
  // Batch delete (#396): the selection bar hands its ids up here, so the
  // confirm and result dialogs outlive the bar once the selection empties.
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null)
  const [batchDelete, setBatchDelete] = useState<{
    requested: number
    result: BatchDeleteResult
  } | null>(null)
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

  // Drop deleted rows from the selection and move the detail selection off a
  // deleted capture, mirroring the single-delete logic above.
  function reconcileAfterBatchDelete(deletedIds: string[]) {
    if (deletedIds.length === 0) return
    deselectCaptures(deletedIds)
    if (selectedCaptureId && deletedIds.includes(selectedCaptureId)) {
      const remaining = captures.filter((c) => !deletedIds.includes(c.id))
      if (remaining.length > 0) {
        selectCapture(remaining[0].id)
      } else {
        setSelectedCaptureId(null)
      }
    }
  }

  async function handleBatchDelete() {
    if (!pendingDeleteIds) return
    const ids = pendingDeleteIds
    try {
      const result = await removeMany.mutateAsync(ids)
      setPendingDeleteIds(null)
      setBatchDelete({ requested: ids.length, result })
      reconcileAfterBatchDelete(result.deletedIds)
    } catch {
      // Whole-call failures (cross-case ids, malformed payload) are surfaced
      // by the global mutation error toast; keep the confirm dialog open.
    }
  }

  async function handleRetryFailed() {
    if (!batchDelete || batchDelete.result.failedIds.length === 0) return
    const ids = batchDelete.result.failedIds
    try {
      const result = await removeMany.mutateAsync(ids)
      setBatchDelete({ requested: ids.length, result })
      reconcileAfterBatchDelete(result.deletedIds)
    } catch {
      // Same contract as handleBatchDelete: the toast reports it.
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
          <CaptureList caseId={caseId} onDeleteSelection={setPendingDeleteIds} />
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
              onExpand={panelCollapsedForced ? () => setForcedPanelOpen(true) : toggleUserPref}
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

      {/* Batch delete: confirm with count, keep the manifest disclosure */}
      <Dialog
        open={pendingDeleteIds !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteIds(null)
        }}
      >
        <DialogContent
          onClose={() => setPendingDeleteIds(null)}
          data-testid="batch-delete-confirm"
          className="w-96 max-w-96 p-5"
        >
          <DialogHeader className="mb-2">
            <DialogTitle className="text-sm">
              Delete {pendingDeleteIds?.length ?? 0} capture
              {pendingDeleteIds?.length === 1 ? '' : 's'}?
            </DialogTitle>
            <DialogDescription className="text-xs">
              This removes {pendingDeleteIds?.length === 1 ? 'the capture' : 'these captures'} and
              their files from this machine, and cannot be undone.
              <br />
              <br />
              <strong className="text-text-primary">Deleting is not redacting.</strong> The case
              manifest is append-only, so each capture&apos;s URL, capture time and hashes stay in
              it permanently and ship in every export that includes the audit trail. A deletion
              entry is appended for each capture removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setPendingDeleteIds(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBatchDelete}
              disabled={removeMany.isPending}
            >
              Delete {pendingDeleteIds?.length ?? 0} capture
              {pendingDeleteIds?.length === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch delete result: prefix-commit truth — deleted / rolled back /
          not attempted / rejected, with failedIds as the retry payload */}
      <Dialog
        open={batchDelete !== null}
        onOpenChange={(open) => {
          if (!open) setBatchDelete(null)
        }}
      >
        <DialogContent
          onClose={() => setBatchDelete(null)}
          data-testid="batch-delete-result"
          className="w-[26rem] max-w-[26rem] p-5"
        >
          {batchDelete && (
            <>
              <DialogHeader className="mb-2">
                <DialogTitle className="text-sm">
                  Deleted {batchDelete.result.deletedIds.length} of {batchDelete.requested}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  <BatchDeleteSummary result={batchDelete.result} />
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-4">
                {batchDelete.result.failedIds.length > 0 && (
                  <Button
                    variant="destructive"
                    onClick={handleRetryFailed}
                    disabled={removeMany.isPending}
                  >
                    Retry {batchDelete.result.failedIds.length} failed
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setBatchDelete(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
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
