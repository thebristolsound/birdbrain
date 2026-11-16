import type { InsertCaptureParams } from '@main/services/db/captureRepo'
import type { ExhibitAuthor } from '@main/services/db/exhibitRepo'
import type { AppendResult, CaptureEntryContext } from '@main/services/manifest'

// The Capture row a signed `capture` entry describes: the one statement of which Manifest Entry
// fields a row mirrors, and in which columns. The ingest, a Duplicate and the row sync writes
// for another member's Capture each pass the entry, what no entry signs, and where its row
// departs from the entry on purpose. A field the row mirrors is added here once, not once per
// writer. A received row leaves the six capture engine fields out (#2206).

// The entry fields the row mirrors. A `capture` entry read from a chain has them, and so does
// the context a writer signs once the append has returned its index and hashes.
export type MirroredCaptureEntry = Pick<
  CaptureEntryContext,
  | 'captureId'
  | 'url'
  | 'timestamp'
  | 'contentHash'
  | 'screenshotHash'
  | 'textHash'
  | 'headers'
  | 'httpStatus'
  | 'tls'
  | 'sizeBytes'
  | 'method'
  | 'supersedesCaptureId'
  | 'duplicateOfCaptureId'
  | 'consentSuppression'
  | 'exhibitNumber'
  | 'linkedFromCaptureId'
  | 'linkedFromContentHash'
  | 'linkHref'
  | 'personaId'
  | 'personaLabel'
  | 'inventory'
  | 'scrollToLoad'
  | 'transactionRecordHash'
  | 'boundTls'
  | 'boundTlsAbsent'
  | 'pdfHash'
  | 'operatorId'
  | 'operatorName'
  | 'toolVersion'
> &
  Pick<AppendResult, 'index' | 'prevHash' | 'entryHash'>

// What a row holds that its entry does not sign, and where a writer's row departs from the
// entry on purpose.
export interface CaptureRowLocal {
  // The Case on this installation. An entry an archive import brought keeps its source's id.
  caseId: string
  title: string
  textContent?: string
  mhtmlPath: string
  screenshotPath?: string
  // The acquiring browser, as the writer knows it: what this installation saw for the ingest,
  // the source's row for a Duplicate, and for a received row only the user agent its author's
  // entry signs. No entry signs the extension's version, and an entry signs the user agent only
  // when the Egress was not Direct and the browser version only for a launched browser, so the
  // row takes all three from the writer.
  extensionVersion?: string
  browserVersion?: string
  userAgent?: string
  // True when the writer received a response header set and it was empty. The row then stores
  // `{}`, as the ingest's always has, where the entry omits the field. The flag cannot add a
  // header the entry does not sign.
  emptyHeaderSet?: boolean
  // The row a link Capture's source is held under (ADR-0040), when the writer resolved one.
  // Absent, the row keeps the id the entry signs; the two differ after an import renamed the
  // source's row.
  linkedFromRowId?: string
  // The number a later `renumber` entry gave the Exhibit, used only when its own entry carries
  // none. It never replaces a number the entry signs.
  renumberedTo?: number
  // Another member's Capture, received by sync (#1811), and the `committed_at` its Exhibit row
  // takes.
  author?: ExhibitAuthor
  committedAt?: string
  // False leaves the six capture engine columns empty whatever the entry carries, as the
  // received-row writer has since before those columns existed (#2206).
  captureEngineFields?: false
}

export function captureRowOf(
  entry: MirroredCaptureEntry,
  local: CaptureRowLocal
): InsertCaptureParams & { id: string } {
  const engine = local.captureEngineFields !== false
  return {
    id: entry.captureId,
    caseId: local.caseId,
    url: entry.url,
    title: local.title,
    hash: entry.contentHash,
    timestamp: entry.timestamp,
    htmlPath: undefined,
    screenshotPath: local.screenshotPath,
    headers:
      entry.headers !== undefined
        ? JSON.stringify(entry.headers)
        : local.emptyHeaderSet
          ? '{}'
          : undefined,
    textContent: local.textContent,
    format: 'mhtml' as const,
    mhtmlPath: local.mhtmlPath,
    screenshotHash: entry.screenshotHash,
    textHash: entry.textHash,
    tlsCertChain: entry.tls !== undefined ? JSON.stringify(entry.tls) : undefined,
    sizeBytes: entry.sizeBytes,
    manifestIndex: entry.index,
    prevHash: entry.prevHash,
    entryHash: entry.entryHash,
    toolVersion: entry.toolVersion,
    extensionVersion: local.extensionVersion,
    browserVersion: local.browserVersion,
    userAgent: local.userAgent,
    httpStatus: entry.httpStatus,
    operatorId: entry.operatorId,
    operatorName: entry.operatorName,
    method: entry.method,
    supersedesCaptureId: entry.supersedesCaptureId,
    duplicateOfCaptureId: entry.duplicateOfCaptureId,
    linkedFromCaptureId: local.linkedFromRowId ?? entry.linkedFromCaptureId,
    linkedFromContentHash: entry.linkedFromContentHash,
    linkHref: entry.linkHref,
    personaId: entry.personaId,
    personaLabel: entry.personaLabel,
    consentSuppression: entry.consentSuppression,
    inventory: engine ? entry.inventory : undefined,
    scrollToLoad: engine ? entry.scrollToLoad : undefined,
    transactionRecordHash: engine ? entry.transactionRecordHash : undefined,
    boundTls: engine ? entry.boundTls : undefined,
    boundTlsAbsent: engine ? entry.boundTlsAbsent : undefined,
    pdfHash: engine ? entry.pdfHash : undefined,
    exhibitNumber: entry.exhibitNumber ?? local.renumberedTo,
    author: local.author,
    committedAt: local.committedAt
    // Every insert parameter named, so a new one fails the build until this says where it comes
    // from. A column added without a parameter is not caught here.
  } satisfies Record<keyof InsertCaptureParams | 'id', unknown>
}
