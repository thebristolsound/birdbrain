import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence } from 'motion/react'
import {
  Archive,
  ArrowLeftRight,
  ChevronsUpDown,
  FileText,
  FolderInput,
  Loader2,
  LoaderCircle,
  MoreVertical,
  Settings,
  TriangleAlert,
  Users,
  X
} from 'lucide-react'
import type { Case } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { accelerator } from '@renderer/lib/accelerator'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger
} from '@renderer/components/ui'
import { captureCountsQueryOptions } from '@renderer/lib/api/captures'
import {
  membersQueryOptions,
  sharingAvailableQueryOptions,
  syncStateQueryOptions
} from '@renderer/lib/api/sharing'
import { useTimeTick } from '@renderer/hooks/useTimeTick'
import { useAppStore } from '@renderer/stores/appStore'
import { ExportDialog } from '@renderer/components/export/ExportDialog'
import { useCaseExport } from '@renderer/components/export/useCaseExport'
import { ImportCaseDialog } from '@renderer/components/dashboard/cases/ImportCaseDialog'
import { useCaseArchiveImport } from '@renderer/components/dashboard/cases/useCaseArchiveImport'
import { MemberCodeChip } from '@renderer/components/sharing/MemberCodeChip'
import {
  caseMenuSharingLabel,
  COPY,
  egressLabel,
  networkNoticeShort,
  sharePillModel,
  youAreLine,
  type SharePill
} from '@renderer/components/sharing/memberModel'

// A Case's menu, one component with its items by place. On the dashboard card it is the kebab:
// Rename, the sharing item, and Delete behind a confirmation. The card reveals the kebab on hover
// and the Older Cases list keeps it visible (docs/design-handoff/2026-10-28-share-a-case/,
// frame E). On the Case name in the top bar it holds what acts on the open Case: Switch Case, the
// sharing item, the two exports, Import and Case settings. The sharing item is the same in both:
// "Share this Case…" until the Case is shared, then "Members".
type CaseMenuProps =
  | {
      place: 'card'
      caseData: Case
      alwaysVisible?: boolean
      className?: string
      onRenameStart: () => void
      onDelete: (id: string) => void
    }
  | {
      place: 'name'
      caseId: string
      /** Undefined while the Case loads, and when the address names no Case. */
      caseData: Case | undefined
    }

export function CaseMenu(props: CaseMenuProps) {
  return props.place === 'card' ? <CardMenu {...props} /> : <NameMenu {...props} />
}

function SharingItem({
  caseId,
  shared,
  className,
  testId,
  title,
  children
}: {
  caseId: string
  shared: boolean
  className?: string
  testId?: string
  title?: string
  children?: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <MenuItem
      data-testid={testId}
      title={title}
      className={className}
      onSelect={() => navigate({ to: '/cases/$caseId/settings', params: { caseId } })}
    >
      {children}
      {caseMenuSharingLabel(shared)}
    </MenuItem>
  )
}

const CARD_ITEM_CLASS = 'px-3 py-1.5 text-[11px] data-[highlighted]:text-text-primary'

function CardMenu({
  caseData,
  alwaysVisible = false,
  className,
  onRenameStart,
  onDelete
}: Extract<CaseMenuProps, { place: 'card' }>) {
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const firstRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLDivElement>(null)
  const wasDeleting = useRef(false)

  // The delete confirmation swaps the items for Confirm and Cancel. Focus lands on Cancel, so a
  // second Enter cannot delete a Case by momentum, and returns to the first item on Cancel.
  useEffect(() => {
    if (deleting) cancelRef.current?.focus()
    else if (wasDeleting.current && open) firstRef.current?.focus()
    wasDeleting.current = deleting
  }, [deleting, open])

  return (
    <div className={className}>
      <Menu
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setDeleting(false)
        }}
      >
        <MenuTrigger
          data-testid="case-card-menu-btn"
          aria-label={`Actions for ${caseData.name}`}
          className={cn(
            'rounded-md hover:bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent transition-[opacity,background-color]',
            alwaysVisible
              ? 'grid h-6 w-6 place-items-center'
              : 'p-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100'
          )}
          // The card under the kebab opens the Case on a click.
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="h-4 w-4 text-text-muted" />
        </MenuTrigger>
        <MenuContent
          aria-label={`Actions for ${caseData.name}`}
          className="w-40 bg-surface"
          // The menu is drawn outside the card, yet React hands its clicks and keys on to the
          // card it was opened from, which would open the Case.
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {deleting ? (
            <div className="px-2 py-1.5">
              <p className="mb-2 text-[11px] font-bold text-danger-fg">Delete?</p>
              <div className="flex gap-1.5">
                <MenuItem
                  data-testid="case-card-delete-confirm-btn"
                  className="w-auto flex-1 justify-center rounded border border-danger-line bg-danger-surface px-2 py-1 text-[10px] font-bold text-danger-fg data-[highlighted]:bg-danger-line"
                  onSelect={() => onDelete(caseData.id)}
                >
                  Confirm
                </MenuItem>
                <MenuItem
                  ref={cancelRef}
                  keepOpen
                  className="w-auto flex-1 justify-center rounded bg-elevated px-2 py-1 text-[10px] font-bold text-text-muted"
                  onSelect={() => setDeleting(false)}
                >
                  Cancel
                </MenuItem>
              </div>
            </div>
          ) : (
            <>
              <MenuItem
                ref={firstRef}
                data-testid="case-card-rename-btn"
                className={CARD_ITEM_CLASS}
                onSelect={onRenameStart}
              >
                Rename
              </MenuItem>
              <SharingItem
                caseId={caseData.id}
                shared={Boolean(caseData.sharedAt)}
                testId="case-card-members-btn"
                className={CARD_ITEM_CLASS}
              />
              <MenuItem
                data-testid="case-card-delete-btn"
                danger
                keepOpen
                className="px-3 py-1.5 text-[11px]"
                onSelect={() => setDeleting(true)}
              >
                Delete
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>
    </div>
  )
}

// What the Case menu says about sharing under the Case's name: where the Case lives, what it
// waits on, or how its sync stands. A Case that was shared and has nobody connected now is not
// on this machine only, since a Member who left can still hold a copy, so it gets no line.
function sharingLine(pill: SharePill | null, shared: boolean): string | null {
  if (!pill) return null
  switch (pill.state) {
    case 'share':
      return shared ? null : COPY.localOnly
    case 'unavailable':
      return COPY.unavailableTitle
    case 'synced':
      return `${pill.a} · ${pill.b}`
    default:
      return pill.b
  }
}

const NAME_ITEM_ICON = 'h-3.5 w-3.5 shrink-0 text-text-muted'

function NameMenu({ caseId, caseData }: Extract<CaseMenuProps, { place: 'name' }>) {
  const navigate = useNavigate()
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)
  // The Share mark rings the Case name while it shows, since Share is in this menu.
  const marked = useAppStore((s) => s.shareMarkOpen)
  // The export dialog keeps the Case it was opened for. The palette can change the Case on
  // screen while the dialog is up, and the form must not then export the other Case.
  const [reportFor, setReportFor] = useState<{ id: string; name: string } | null>(null)
  const noticeTipId = useId()
  const exporting = useCaseExport(caseId)
  const importing = useCaseArchiveImport()

  const { data: available } = useQuery(sharingAvailableQueryOptions)
  const { data: roster } = useQuery(membersQueryOptions(caseId))
  // Only a Case with a roster polls its sync state, as the Members tab does.
  const shared = roster !== undefined && roster.members.length > 0
  const { data: syncState } = useQuery({ ...syncStateQueryOptions(caseId), enabled: shared })
  const { data: captureCounts } = useQuery(captureCountsQueryOptions)
  const nowMs = useTimeTick(60_000)
  const pill = sharePillModel({ available, members: roster, syncState, nowMs })
  const sync = pill?.sync ?? null
  // This installation's Member Code leads the Case name on a shared Case
  // (docs/design-handoff/2026-10-28-share-a-case/, frame C); a Case nobody
  // shared has an empty roster and no chip.
  const self = roster?.members.find((m) => m.installationId === roster.installationId) ?? null

  const name = caseData?.name ?? ''
  const count = captureCounts?.[caseId]
  const about = [
    count === undefined ? null : `${count} ${count === 1 ? 'Capture' : 'Captures'}`,
    sharingLine(pill, Boolean(caseData?.sharedAt))
  ]
    .filter(Boolean)
    .join(' · ')
  // The name can hide on a narrow window, so the tooltip carries it in full.
  const title = [name, 'Case menu', self && youAreLine(self.memberCode)].filter(Boolean).join(' · ')
  // One failure shows at a time, the export's first, and Dismiss clears only the one shown.
  const failure = exporting.archiveError || importing.error
  const dismissFailure = exporting.archiveError
    ? exporting.dismissArchiveError
    : importing.dismissError

  return (
    <div className="relative flex min-w-0 items-center gap-1.5">
      <Menu>
        <MenuTrigger
          data-testid="topbar-case-name"
          data-tour="caseswitcher"
          data-marked={marked ? 'true' : undefined}
          title={title}
          className={cn(
            'flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-elevated aria-expanded:bg-elevated',
            marked && 'ring-[3px] ring-accent/30'
          )}
        >
          {self && (
            <MemberCodeChip
              code={self.memberCode}
              hue="accent"
              size={18}
              data-testid="topbar-member-code"
            />
          )}
          <span
            data-testid="topbar-case-name-text"
            className="min-w-16 max-w-[220px] truncate font-display text-xs font-semibold text-text-primary max-[1000px]:hidden"
          >
            {name}
          </span>
          {/* Below 1,000 pixels the name hides, and the button still has to say which Case. */}
          <span className="sr-only min-[1000px]:hidden">{name}</span>
          {exporting.progressLabel && (
            <span
              data-testid="case-export-progress"
              title={exporting.progressLabel}
              className="inline-flex min-w-0 items-center gap-1 text-[11px] text-text-muted"
            >
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" strokeWidth={1.8} />
              <span className="sr-only xl:not-sr-only xl:max-w-44 xl:truncate">
                {exporting.progressLabel}
              </span>
            </span>
          )}
          {sync?.chrome === 'error' ? (
            // A sync that has stopped stays in view with the menu closed, beside a running
            // export too. Below xl the name's track is too narrow for the words, so the icon
            // stands alone and the title has them.
            <span
              data-testid="case-sync-state"
              data-chrome="error"
              title={`${sync.a} · ${sync.b}`}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-medium text-danger-fg"
            >
              <TriangleAlert size={11} aria-hidden="true" />
              <span className="sr-only xl:not-sr-only">{sync.a}</span>
            </span>
          ) : sync?.chrome === 'active' && !exporting.progressLabel ? (
            <span
              data-testid="case-sync-state"
              data-chrome="active"
              title={`${sync.a} · ${sync.b}`}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-text-muted"
            >
              <LoaderCircle size={11} className="animate-spin" aria-hidden="true" />
              <span className="sr-only xl:not-sr-only">{sync.a}</span>
            </span>
          ) : null}
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        </MenuTrigger>
        <MenuContent
          align="start"
          aria-label={[name || 'Case menu', about].filter(Boolean).join(': ')}
          className="w-[264px]"
        >
          <MenuLabel>
            <span className="block truncate text-xs font-semibold text-text-primary">{name}</span>
            {about && (
              <span
                data-testid="case-menu-about"
                className="mt-0.5 block text-[10px] text-text-faint"
              >
                {about}
              </span>
            )}
          </MenuLabel>
          <MenuItem data-testid="case-menu-switch" onSelect={() => setCommandPaletteOpen(true)}>
            <ArrowLeftRight className={NAME_ITEM_ICON} strokeWidth={1.8} />
            Switch Case…
            <MenuShortcut>{accelerator('K')}</MenuShortcut>
          </MenuItem>
          <MenuSeparator />
          <SharingItem
            caseId={caseId}
            shared={Boolean(caseData?.sharedAt)}
            testId="case-menu-sharing"
            // Sharing ships as early access, so its tooltip leads with that.
            title={pill ? `${COPY.earlyAccess}. ${pill.title}` : COPY.earlyAccess}
          >
            <Users className={NAME_ITEM_ICON} strokeWidth={1.8} />
          </SharingItem>
          <MenuItem
            data-testid="case-menu-export-report"
            disabled={!caseData || exporting.isExporting}
            onSelect={() => caseData && setReportFor({ id: caseData.id, name: caseData.name })}
          >
            <FileText className={NAME_ITEM_ICON} strokeWidth={1.8} />
            Export evidence report
          </MenuItem>
          <MenuItem
            data-testid="case-menu-export-archive"
            disabled={!caseData || exporting.isExporting}
            onSelect={() => void exporting.startArchive()}
          >
            <Archive className={NAME_ITEM_ICON} strokeWidth={1.8} />
            Export case file
          </MenuItem>
          <MenuItem data-testid="case-menu-import" onSelect={() => void importing.start()}>
            <FolderInput className={NAME_ITEM_ICON} strokeWidth={1.8} />
            Import Case Archive…
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            data-testid="case-menu-settings"
            onSelect={() => navigate({ to: '/cases/$caseId/settings', params: { caseId } })}
          >
            <Settings className={NAME_ITEM_ICON} strokeWidth={1.8} />
            Case settings
          </MenuItem>
        </MenuContent>
      </Menu>

      {/* The top bar drags the window, and its rule exempts controls such as buttons, inputs and
          links. This notice is a span, so it opts out itself, or the pointer could not reach its
          tooltip. */}
      {sync?.glyph && (
        <span
          tabIndex={0}
          aria-label={COPY.glyphLabel}
          aria-describedby={noticeTipId}
          data-testid="case-network-notice"
          className="group/notice relative shrink-0 [app-region:no-drag]"
        >
          <TriangleAlert size={12} className="text-warning-fg" />
          <span
            id={noticeTipId}
            role="tooltip"
            className="absolute left-0 top-full z-50 hidden w-[300px] rounded border border-border-strong bg-elevated px-3 py-2.5 text-left text-[11px] text-text-secondary shadow-xl group-hover/notice:block group-focus/notice:block"
          >
            {networkNoticeShort(egressLabel(syncState?.egress ?? 'unavailable'))}
            <span className="mt-1 block text-accent">{COPY.detailsInMembers}</span>
          </span>
        </span>
      )}

      {/* A failed export or import stays up until dismissed rather than timing out: an error is
          not a transient notice. */}
      {failure && (
        <div
          role="alert"
          aria-live="assertive"
          className="absolute left-0 top-full z-40 mt-1 flex w-max max-w-[260px] items-start gap-1.5 rounded border border-danger-line bg-danger-surface py-1 pl-2.5 pr-1 text-xs text-danger-fg"
        >
          <span className="min-w-0 flex-1">{failure}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="grid h-4 w-4 shrink-0 place-items-center rounded hover:bg-red-500/20"
            onClick={dismissFailure}
          >
            <X size={11} strokeWidth={2} />
          </button>
        </div>
      )}

      {/* The dialogs render at the end of the document. Inside the bar they would come before
          the search, which keeps a layer of its own, and its results would sit over them. */}
      {createPortal(
        <>
          <AnimatePresence>
            {reportFor && (
              <ExportDialog
                caseId={reportFor.id}
                caseName={reportFor.name}
                onClose={() => setReportFor(null)}
              />
            )}
          </AnimatePresence>
          {/* Keyed by the archive, so the tamper override ticked for one never carries to
              another. */}
          {importing.report && (
            <ImportCaseDialog
              key={importing.report.archivePath}
              report={importing.report}
              onClose={importing.close}
            />
          )}
        </>,
        document.body
      )}
    </div>
  )
}
