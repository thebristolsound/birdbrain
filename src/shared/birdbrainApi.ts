import type {
  Case,
  CaseAutoCapturePolicy,
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
  ExtractedDataSearchResult,
  NoteBacklink,
  NoteBacklinkCount,
  NoteReference,
  NoteReferenceEdge,
  AnnotationsBundle,
  CaptureAnnotations,
  AnnotationPin,
  OperatorIdentity,
  CaseWaybackRef,
  WaybackRef,
  WaybackLookupResult,
  ArchiveInspectReport,
  UpdateStatus,
  DiagnosticsSnapshot,
  UnreconciledDeletionReport,
  LogEntry,
  SessionRecord,
  BugReportInput,
  BugReportResult,
  RecentActivityEvent,
  CaseInventory,
  ExhibitVerification
} from '@shared/types'
import type { CaseManifestSnapshot } from '@shared/manifestSnapshot'
import type {
  CreateCaseParams,
  UpdateCaseParams,
  SetAutoCapturePolicyParams,
  CreateTagParams,
  UpdateTagParams,
  CaptureTagParams,
  NoteTagParams,
  ApplyTagToNoteParams,
  ApplyTagToNoteResult,
  MergeTagsParams,
  MergeTagsResult,
  CreateSelectorParams,
  UpdateSelectorParams,
  CreateNoteParams,
  UpdateNoteParams,
  NoteBacklinksParams,
  BulkCreateSelectorsParams,
  DbStats,
  DbTableRowsParams,
  DbTableRowsResult,
  DbCreateRowParams,
  DbUpdateRowParams,
  DbRowIdentifier,
  DbExportTableParams,
  DbSnapshot,
  DbRestoreSnapshotParams,
  OrphanReport,
  AnalyzeCaptureParams,
  SaveAnnotationsParams,
  UpsertAnnotationPinParams,
  SelectorRematchedEvent,
  ExtensionAttachEvent,
  DeepLinkTarget,
  ExportProgressEvent,
  ExportResult,
  PinWaybackSnapshotParams,
  ArchiveProgressEvent,
  ArchiveExportResult,
  RecaptureEnqueuePayload,
  EnqueueResult,
  RecaptureQueueStatus,
  RendererLogPayload,
  SessionStateEvent,
  CaptureBatchPayload,
  BatchDeleteResult,
  BatchCountResult,
  DuplicateCaptureResult
} from '@shared/ipc'

export interface BirdbrainAPI {
  cases: {
    list(): Promise<Case[]>
    get(id: string): Promise<Case | undefined>
    create(params: CreateCaseParams): Promise<Case>
    update(params: UpdateCaseParams): Promise<Case | undefined>
    delete(id: string): Promise<boolean>
    exportArchive(caseId: string): Promise<ArchiveExportResult>
    inspectArchive(): Promise<ArchiveInspectReport | null>
    importArchive(archivePath: string, overrideTamper: boolean): Promise<{ newCaseId: string }>
    recentActivity(limit?: number): Promise<RecentActivityEvent[]>
    getAutoCapturePolicy(caseId: string): Promise<CaseAutoCapturePolicy>
    setAutoCapturePolicy(params: SetAutoCapturePolicyParams): Promise<CaseAutoCapturePolicy>
  }
  captures: {
    list(caseId: string): Promise<Capture[]>
    get(id: string): Promise<Capture | undefined>
    delete(id: string): Promise<boolean>
    getContent(captureId: string, type: 'html' | 'png' | 'txt'): Promise<string | null>
    getThumbnail(captureId: string): Promise<string | null>
    getMatchingSelectors(captureId: string): Promise<Selector[]>
    download(captureId: string): Promise<string | null>
    downloadPdf(captureId: string): Promise<string | null>
    downloadScreenshot(captureId: string): Promise<string | null>
    openExternal(url: string): Promise<void>
    countsByCase(): Promise<Record<string, number>>
    toggleFavorite(captureId: string): Promise<boolean>
    isFavorite(captureId: string): Promise<boolean>
    listFavorites(caseId: string): Promise<string[]>
    verify(captureId: string): Promise<HashVerification>
    getMhtmlUrl(captureId: string): Promise<string | null>
    getHtmlUrl(captureId: string): Promise<string | null>
    deleteMany(payload: CaptureBatchPayload): Promise<BatchDeleteResult>
    duplicate(captureId: string): Promise<DuplicateCaptureResult>
    setFavoriteMany(payload: CaptureBatchPayload & { favorite: boolean }): Promise<BatchCountResult>
  }
  recapture: {
    enqueue(payload: RecaptureEnqueuePayload): Promise<EnqueueResult>
    queueStatus(): Promise<RecaptureQueueStatus>
    enqueueCaptures(payload: CaptureBatchPayload): Promise<EnqueueResult>
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
    captureMatrix(caseId: string, limit: number): Promise<Record<string, string[]>>
    addToCaptures(payload: CaptureBatchPayload & { tagId: string }): Promise<BatchCountResult>
    removeFromCaptures(payload: CaptureBatchPayload & { tagId: string }): Promise<BatchCountResult>
    countsForCaptures(payload: CaptureBatchPayload): Promise<Record<string, number>>
    findOrCreate(params: CreateTagParams): Promise<Tag>
    applyToNote(params: ApplyTagToNoteParams): Promise<ApplyTagToNoteResult>
    removeFromNote(params: NoteTagParams): Promise<void>
    getForNote(noteId: string): Promise<Tag[]>
    merge(params: MergeTagsParams): Promise<MergeTagsResult>
    capturesWithAnyTag(caseId: string, tagIds: string[]): Promise<string[]>
  }
  selectors: {
    list(caseId: string): Promise<Selector[]>
    get(id: string): Promise<Selector | undefined>
    create(params: CreateSelectorParams): Promise<Selector>
    update(params: UpdateSelectorParams): Promise<Selector | undefined>
    rescan(id: string): Promise<boolean>
    delete(id: string): Promise<boolean>
    listActive(): Promise<ActiveCaseSelectors[]>
    matchCounts(caseId: string): Promise<Record<string, number>>
    matchingCaptures(caseId: string, selectorIds: string[]): Promise<string[]>
    coverage(caseId: string): Promise<{ matched: number; total: number }>
    captureMatrix(caseId: string, limit: number): Promise<Record<string, string[]>>
    bulkCreate(params: BulkCreateSelectorsParams): Promise<Selector[]>
    exportMatches(caseId: string, selectorId?: string): Promise<{ exported: boolean; path?: string }>
  }
  notes: {
    list(caseId: string): Promise<Note[]>
    get(id: string): Promise<Note | undefined>
    create(params: CreateNoteParams): Promise<Note>
    update(params: UpdateNoteParams): Promise<Note | undefined>
    delete(id: string): Promise<boolean>
    count(caseId: string): Promise<number>
    search(caseId: string, query: string): Promise<Note[]>
    references(noteId: string): Promise<NoteReference[]>
    backlinks(params: NoteBacklinksParams): Promise<NoteBacklink[]>
    backlinkCounts(caseId: string): Promise<NoteBacklinkCount[]>
    referenceEdges(caseId: string): Promise<NoteReferenceEdge[]>
  }
  wayback: {
    lookup(captureId: string): Promise<WaybackLookupResult>
    list(captureId: string): Promise<WaybackRef[]>
    listForCase(caseId: string): Promise<CaseWaybackRef[]>
    pin(params: PinWaybackSnapshotParams): Promise<WaybackRef>
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
  session: {
    snapshot(): Promise<SessionStateEvent>
    activateCase(caseId: string): Promise<SessionStateEvent>
    start(): Promise<SessionStateEvent>
    stop(): Promise<SessionStateEvent>
  }
  search(caseId: string, query: string): Promise<Capture[]>
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
    preflight(caseId: string, captureIds?: string[]): Promise<ExportPreflight>
    generateReport(caseId: string, options: ExportOptions): Promise<ExportResult>
  }
  shell: {
    showItemInFolder(path: string): Promise<void>
    openPath(path: string): Promise<void>
  }
  exhibits: {
    inventory(caseId: string): Promise<CaseInventory>
    verify(caseId: string, exhibitId: string): Promise<ExhibitVerification>
  }
  manifest: {
    snapshot(caseId: string): Promise<CaseManifestSnapshot>
  }
  app: {
    getVersion(): Promise<string>
  }
  diagnostics: {
    get(): Promise<DiagnosticsSnapshot>
    log(payload: RendererLogPayload): Promise<string>
    recentEntries(limit: number): Promise<LogEntry[]>
    revealLog(): Promise<void>
    openStorageRoot(): Promise<void>
    lastSession(): Promise<SessionRecord | null>
    createReport(input: BugReportInput): Promise<BugReportResult | null>
    unreconciledDeletions(): Promise<UnreconciledDeletionReport>
  }
  updates: {
    getStatus(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    download(): Promise<void>
    install(): Promise<void>
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
    rebuildFts(): Promise<{ rowsIndexed: number; textsHealed: number }>
    purgeArchived(): Promise<{ casesDeleted: number; capturesDeleted: number }>
    findOrphans(): Promise<OrphanReport>
    cleanOrphans(report: OrphanReport): Promise<{ dbRecordsRemoved: number; filesRemoved: number }>
    backup(): Promise<{ path: string } | null>
    restore(): Promise<{ restored: boolean }>
    snapshots(): Promise<DbSnapshot[]>
    restoreSnapshot(params: DbRestoreSnapshotParams): Promise<{ restored: boolean }>
    exportTable(params: DbExportTableParams): Promise<{ path: string } | null>
  }
  onExportProgress(callback: (event: ExportProgressEvent) => void): () => void
  onArchiveProgress(callback: (event: ArchiveProgressEvent) => void): () => void
  onNewCapture(callback: (capture: Capture) => void): () => void
  onSessionStateChanged(
    callback: (state: {
      sessionActive: boolean
      activeCaseId: string | null
      captureCount: number
    }) => void
  ): () => void
  onExtensionConnection(callback: (data: { connected: boolean }) => void): () => void
  onExtensionAttach(callback: (event: ExtensionAttachEvent) => void): () => void
  onCaptureActivity(callback: (event: CaptureEvent) => void): () => void
  onLogEntry(callback: (entry: LogEntry) => void): () => void
  onSelectorRematched(callback: (event: SelectorRematchedEvent) => void): () => void
  onDeepLinkNavigate(callback: (target: DeepLinkTarget) => void): () => void
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void
  testPipeline(): Promise<{ success: boolean; durationMs: number; error?: string }>
  testHttp(): Promise<{ success: boolean; durationMs: number; error?: string }>
  extractedData: {
    categories(caseId: string): Promise<ExtractedDataCategory[]>
    subcategories(caseId: string, category: string): Promise<ExtractedDataSubcategory[]>
    items(caseId: string, category: string, subcategory: string): Promise<ExtractedDataItem[]>
    count(caseId: string): Promise<number>
    search(caseId: string, query: string): Promise<ExtractedDataSearchResult[]>
    reprocess(caseId: string): Promise<{ processed: number }>
  }
}
