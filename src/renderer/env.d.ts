/// <reference types="vite/client" />
/// <reference types="electron" />

import type {
  Case,
  Capture,
  Tag,
  BirdbrainSettings,
  OpenRouterModel,
  ExportOptions,
  ExportPreflight,
  Selector,
  ActiveCaseSelectors,
  CaptureEvent,
  Note,
  HashVerification,
  CaptureAnalysis,
  TokenUsage,
  ExtractedDataCategory,
  ExtractedDataSubcategory,
  ExtractedDataItem,
  AnnotationsBundle,
  CaptureAnnotations,
  AnnotationPin,
  OperatorIdentity,
  ArchiveRef,
  WaybackLookupResult
} from '@shared/types'
import type {
  CreateCaseParams,
  UpdateCaseParams,
  CreateTagParams,
  UpdateTagParams,
  CaptureTagParams,
  CreateSelectorParams,
  UpdateSelectorParams,
  CreateNoteParams,
  UpdateNoteParams,
  BulkCreateSelectorsParams,
  DbStats,
  DbTableRowsParams,
  DbTableRowsResult,
  DbCreateRowParams,
  DbUpdateRowParams,
  DbRowIdentifier,
  DbExportTableParams,
  OrphanReport,
  AnalyzeCaptureParams,
  SaveAnnotationsParams,
  UpsertAnnotationPinParams,
  SelectorRematchedEvent,
  DeepLinkTarget,
  PinArchiveSnapshotParams
} from '@shared/ipc'

interface BirdbrainAPI {
  cases: {
    list(): Promise<Case[]>
    get(id: string): Promise<Case | undefined>
    create(params: CreateCaseParams): Promise<Case>
    update(params: UpdateCaseParams): Promise<Case | undefined>
    delete(id: string): Promise<boolean>
  }
  captures: {
    list(caseId: string): Promise<Capture[]>
    get(id: string): Promise<Capture | undefined>
    delete(id: string): Promise<boolean>
    getContent(captureId: string, type: 'html' | 'png' | 'txt'): Promise<string | null>
    getThumbnail(captureId: string): Promise<string | null>
    getMatchingSelectors(captureId: string): Promise<Selector[]>
    download(captureId: string): Promise<string | null>
    openExternal(url: string): Promise<void>
    countsByCase(): Promise<Record<string, number>>
    toggleFavorite(captureId: string): Promise<boolean>
    isFavorite(captureId: string): Promise<boolean>
    listFavorites(caseId: string): Promise<string[]>
    verify(captureId: string): Promise<HashVerification>
    getMhtmlUrl(captureId: string): Promise<string | null>
  }
  tags: {
    list(): Promise<Tag[]>
    create(params: CreateTagParams): Promise<Tag>
    update(params: UpdateTagParams): Promise<Tag | undefined>
    delete(id: string): Promise<boolean>
    addToCapture(params: CaptureTagParams): Promise<void>
    removeFromCapture(params: CaptureTagParams): Promise<void>
    getForCapture(captureId: string): Promise<Tag[]>
    countForCase(caseId: string): Promise<number>
    usageCountsForCase(caseId: string): Promise<Record<string, number>>
  }
  selectors: {
    list(caseId: string): Promise<Selector[]>
    get(id: string): Promise<Selector | undefined>
    create(params: CreateSelectorParams): Promise<Selector>
    update(params: UpdateSelectorParams): Promise<Selector | undefined>
    delete(id: string): Promise<boolean>
    listActive(): Promise<ActiveCaseSelectors[]>
    matchCounts(caseId: string): Promise<Record<string, number>>
    matchingCaptures(caseId: string, selectorIds: string[]): Promise<string[]>
    coverage(caseId: string): Promise<{ matched: number; total: number }>
    bulkCreate(params: BulkCreateSelectorsParams): Promise<Selector[]>
    exportMatches(caseId: string): Promise<{ exported: boolean; path?: string }>
  }
  notes: {
    list(caseId: string): Promise<Note[]>
    get(id: string): Promise<Note | undefined>
    create(params: CreateNoteParams): Promise<Note>
    update(params: UpdateNoteParams): Promise<Note | undefined>
    delete(id: string): Promise<boolean>
    count(caseId: string): Promise<number>
    search(caseId: string, query: string): Promise<Note[]>
  }
  archive: {
    lookup(captureId: string): Promise<WaybackLookupResult>
    list(captureId: string): Promise<ArchiveRef[]>
    pin(params: PinArchiveSnapshotParams): Promise<ArchiveRef>
    unpin(refId: string): Promise<boolean>
  }
  annotations: {
    get(captureId: string): Promise<AnnotationsBundle>
    save(params: SaveAnnotationsParams): Promise<CaptureAnnotations>
    delete(captureId: string): Promise<void>
    upsertPin(params: UpsertAnnotationPinParams): Promise<AnnotationPin>
    deletePin(pinId: string): Promise<void>
  }
  extension: {
    getPath(): Promise<string>
    openFolder(): Promise<void>
  }
  search(query: string): Promise<Capture[]>
  settings: {
    get(): Promise<BirdbrainSettings>
    update(partial: Partial<BirdbrainSettings>): Promise<BirdbrainSettings>
    reset(): Promise<BirdbrainSettings>
    testOpenRouter(apiKey: string): Promise<boolean>
    listModels(apiKey: string): Promise<OpenRouterModel[]>
    getIdentity(): Promise<OperatorIdentity>
    chooseStoragePath(): Promise<string | null>
  }
  export: {
    preflight(caseId: string): Promise<ExportPreflight>
    generateReport(caseId: string, options: ExportOptions): Promise<void>
  }
  ai: {
    analyze(params: AnalyzeCaptureParams): Promise<{ content: string; tokenUsage: TokenUsage }>
    saveAnalysis(analysis: CaptureAnalysis): Promise<void>
    getAnalysis(captureId: string): Promise<CaptureAnalysis | null>
  }
  db: {
    stats(): Promise<DbStats>
    tableRows(params: DbTableRowsParams): Promise<DbTableRowsResult>
    createRow(params: DbCreateRowParams): Promise<Record<string, unknown>>
    updateRow(params: DbUpdateRowParams): Promise<boolean>
    deleteRow(params: DbRowIdentifier): Promise<boolean>
    vacuum(): Promise<{ freedBytes: number }>
    rebuildFts(): Promise<{ rowsIndexed: number }>
    purgeArchived(): Promise<{ casesDeleted: number; capturesDeleted: number }>
    findOrphans(): Promise<OrphanReport>
    cleanOrphans(report: OrphanReport): Promise<{ dbRecordsRemoved: number; filesRemoved: number }>
    backup(): Promise<{ path: string } | null>
    restore(): Promise<{ restored: boolean }>
    exportTable(params: DbExportTableParams): Promise<{ path: string } | null>
  }
  onNewCapture(callback: (capture: Capture) => void): () => void
  onSessionStateChanged(
    callback: (state: {
      sessionActive: boolean
      activeCaseId: string | null
      captureCount: number
    }) => void
  ): () => void
  onExtensionConnection(callback: (data: { connected: boolean }) => void): () => void
  onCaptureActivity(callback: (event: CaptureEvent) => void): () => void
  onSelectorRematched(callback: (event: SelectorRematchedEvent) => void): () => void
  onDeepLinkNavigate(callback: (target: DeepLinkTarget) => void): () => void
  testPipeline(): Promise<{ success: boolean; durationMs: number; error?: string }>
  testHttp(): Promise<{ success: boolean; durationMs: number; error?: string }>
  extractedData: {
    categories(caseId: string): Promise<ExtractedDataCategory[]>
    subcategories(caseId: string, category: string): Promise<ExtractedDataSubcategory[]>
    items(caseId: string, category: string, subcategory: string): Promise<ExtractedDataItem[]>
    count(caseId: string): Promise<number>
    reprocess(caseId: string): Promise<{ processed: number }>
  }
}

declare global {
  interface Window {
    birdbrain: BirdbrainAPI
  }

  // Extend JSX intrinsics in the global namespace so webview attributes are
  // recognized. Without `declare global`, this augmentation would be scoped to
  // this module (because of the top-level imports) and TypeScript would fall
  // back to React's default typings where these attributes are booleans.
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          nodeintegration?: string
          allowpopups?: string
          webpreferences?: string
          partition?: string
        },
        HTMLElement
      >
    }
  }
}
