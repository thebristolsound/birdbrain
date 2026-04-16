import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
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
  DbTableRowsParams,
  DbCreateRowParams,
  DbUpdateRowParams,
  DbRowIdentifier,
  DbExportTableParams,
  DbStats,
  DbTableRowsResult,
  OrphanReport,
  AnalyzeCaptureParams,
  UpdateAnalysisParams
} from '@shared/ipc'
import type {
  Case,
  Capture,
  Tag,
  BirdbrainSettings,
  OpenRouterModel,
  ExportOptions,
  Selector,
  ActiveCaseSelectors,
  CaptureEvent,
  Note,
  CaptureAnalysis,
  ExtractedDataCategory,
  ExtractedDataSubcategory,
  ExtractedDataItem
} from '@shared/types'

// Unwrap IpcResult from handlers that return structured results
async function unwrapIpc<T>(promise: Promise<unknown>): Promise<T> {
  const result = await promise
  if (result && typeof result === 'object' && 'ok' in result) {
    if ((result as { ok: boolean }).ok) {
      return (result as { ok: true; data: T }).data
    }
    const err = result as { ok: false; error: string; code?: string }
    const error = new Error(err.error)
    ;(error as unknown as { code?: string }).code = err.code
    throw error
  }
  return result as T
}

const birdbrain = {
  cases: {
    list: (): Promise<Case[]> => ipcRenderer.invoke(IPC_CHANNELS.CASES_LIST),
    get: (id: string): Promise<Case | undefined> => ipcRenderer.invoke(IPC_CHANNELS.CASES_GET, id),
    create: (params: CreateCaseParams): Promise<Case> =>
      unwrapIpc<Case>(ipcRenderer.invoke(IPC_CHANNELS.CASES_CREATE, params)),
    update: (params: UpdateCaseParams): Promise<Case | undefined> =>
      unwrapIpc<Case | undefined>(ipcRenderer.invoke(IPC_CHANNELS.CASES_UPDATE, params)),
    delete: (id: string): Promise<boolean> =>
      unwrapIpc<boolean>(ipcRenderer.invoke(IPC_CHANNELS.CASES_DELETE, id))
  },
  captures: {
    list: (caseId: string): Promise<Capture[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_LIST, caseId),
    get: (id: string): Promise<Capture | undefined> =>
      ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_GET, id),
    delete: (id: string): Promise<boolean> =>
      unwrapIpc<boolean>(ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_DELETE, id)),
    getContent: (captureId: string, type: 'html' | 'png' | 'txt'): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_GET_CONTENT, captureId, type),
    getThumbnail: (captureId: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_GET_THUMBNAIL, captureId),
    getMatchingSelectors: (captureId: string): Promise<Selector[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_GET_MATCHING_SELECTORS, captureId),
    download: (captureId: string): Promise<string | null> =>
      unwrapIpc<string | null>(ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_DOWNLOAD, captureId)),
    openExternal: (url: string): Promise<void> =>
      unwrapIpc<void>(ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_OPEN_EXTERNAL, url)),
    countsByCase: (): Promise<Record<string, number>> =>
      unwrapIpc<Record<string, number>>(ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_COUNTS_BY_CASE)),
    toggleFavorite: (captureId: string): Promise<boolean> =>
      unwrapIpc<boolean>(ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_TOGGLE_FAVORITE, captureId)),
    isFavorite: (captureId: string): Promise<boolean> =>
      unwrapIpc<boolean>(ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_IS_FAVORITE, captureId)),
    listFavorites: (caseId: string): Promise<string[]> =>
      unwrapIpc<string[]>(ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_LIST_FAVORITES, caseId)),
    verify: (captureId: string): Promise<import('@shared/types').HashVerification> =>
      unwrapIpc<import('@shared/types').HashVerification>(
        ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_VERIFY, captureId)
      ),
    getMhtmlUrl: (captureId: string): Promise<string | null> =>
      unwrapIpc<string | null>(ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_GET_MHTML_URL, captureId))
  },
  tags: {
    list: (): Promise<Tag[]> => ipcRenderer.invoke(IPC_CHANNELS.TAGS_LIST),
    create: (params: CreateTagParams): Promise<Tag> =>
      unwrapIpc<Tag>(ipcRenderer.invoke(IPC_CHANNELS.TAGS_CREATE, params)),
    update: (params: UpdateTagParams): Promise<Tag | undefined> =>
      unwrapIpc<Tag | undefined>(ipcRenderer.invoke(IPC_CHANNELS.TAGS_UPDATE, params)),
    delete: (id: string): Promise<boolean> =>
      unwrapIpc<boolean>(ipcRenderer.invoke(IPC_CHANNELS.TAGS_DELETE, id)),
    addToCapture: (params: CaptureTagParams): Promise<void> =>
      unwrapIpc<void>(ipcRenderer.invoke(IPC_CHANNELS.TAGS_ADD_TO_CAPTURE, params)),
    removeFromCapture: (params: CaptureTagParams): Promise<void> =>
      unwrapIpc<void>(ipcRenderer.invoke(IPC_CHANNELS.TAGS_REMOVE_FROM_CAPTURE, params)),
    getForCapture: (captureId: string): Promise<Tag[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.TAGS_GET_FOR_CAPTURE, captureId),
    countForCase: (caseId: string): Promise<number> =>
      ipcRenderer.invoke(IPC_CHANNELS.TAGS_COUNT_FOR_CASE, caseId),
    usageCountsForCase: (caseId: string): Promise<Record<string, number>> =>
      ipcRenderer.invoke(IPC_CHANNELS.TAGS_USAGE_COUNTS_FOR_CASE, caseId)
  },
  selectors: {
    list: (caseId: string): Promise<Selector[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_LIST, caseId),
    get: (id: string): Promise<Selector | undefined> =>
      ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_GET, id),
    create: (params: CreateSelectorParams): Promise<Selector> =>
      unwrapIpc<Selector>(ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_CREATE, params)),
    update: (params: UpdateSelectorParams): Promise<Selector | undefined> =>
      unwrapIpc<Selector | undefined>(ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_UPDATE, params)),
    delete: (id: string): Promise<boolean> =>
      unwrapIpc<boolean>(ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_DELETE, id)),
    listActive: (): Promise<ActiveCaseSelectors[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_LIST_ACTIVE),
    matchCounts: (caseId: string): Promise<Record<string, number>> =>
      ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_MATCH_COUNTS, caseId),
    matchingCaptures: (caseId: string, selectorIds: string[]): Promise<string[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_MATCHING_CAPTURES, caseId, selectorIds),
    coverage: (caseId: string): Promise<{ matched: number; total: number }> =>
      ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_COVERAGE, caseId),
    bulkCreate: (params: BulkCreateSelectorsParams): Promise<Selector[]> =>
      unwrapIpc<Selector[]>(ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_BULK_CREATE, params)),
    exportMatches: (caseId: string): Promise<{ exported: boolean; path?: string }> =>
      unwrapIpc<{ exported: boolean; path?: string }>(
        ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_EXPORT_MATCHES, caseId)
      )
  },
  notes: {
    list: (caseId: string): Promise<Note[]> => ipcRenderer.invoke(IPC_CHANNELS.NOTES_LIST, caseId),
    get: (id: string): Promise<Note | undefined> => ipcRenderer.invoke(IPC_CHANNELS.NOTES_GET, id),
    create: (params: CreateNoteParams): Promise<Note> =>
      unwrapIpc<Note>(ipcRenderer.invoke(IPC_CHANNELS.NOTES_CREATE, params)),
    update: (params: UpdateNoteParams): Promise<Note | undefined> =>
      unwrapIpc<Note | undefined>(ipcRenderer.invoke(IPC_CHANNELS.NOTES_UPDATE, params)),
    delete: (id: string): Promise<boolean> =>
      unwrapIpc<boolean>(ipcRenderer.invoke(IPC_CHANNELS.NOTES_DELETE, id)),
    count: (caseId: string): Promise<number> =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTES_COUNT, caseId),
    search: (caseId: string, query: string): Promise<Note[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTES_SEARCH, caseId, query)
  },

  extension: {
    getPath: (): Promise<string> =>
      unwrapIpc<string>(ipcRenderer.invoke(IPC_CHANNELS.EXTENSION_PATH)),
    openFolder: (): Promise<void> =>
      unwrapIpc<void>(ipcRenderer.invoke(IPC_CHANNELS.EXTENSION_OPEN_FOLDER))
  },

  search: (query: string): Promise<Capture[]> => ipcRenderer.invoke(IPC_CHANNELS.SEARCH, query),

  settings: {
    get: (): Promise<BirdbrainSettings> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
    update: (partial: Partial<BirdbrainSettings>): Promise<BirdbrainSettings> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, partial),
    reset: (): Promise<BirdbrainSettings> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_RESET),
    testOpenRouter: (apiKey: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_TEST_OPENROUTER, apiKey),
    listModels: (apiKey: string): Promise<OpenRouterModel[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_LIST_MODELS, apiKey),
    getIdentity: (): Promise<{ installationId: string; operatorName: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_IDENTITY),
    chooseStoragePath: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_CHOOSE_STORAGE_PATH)
  },

  export: {
    generateReport: (caseId: string, options: ExportOptions): Promise<void> =>
      unwrapIpc<void>(ipcRenderer.invoke(IPC_CHANNELS.EXPORT_GENERATE, caseId, options))
  },

  db: {
    stats: (): Promise<DbStats> => unwrapIpc<DbStats>(ipcRenderer.invoke(IPC_CHANNELS.DB_STATS)),
    tableRows: (params: DbTableRowsParams): Promise<DbTableRowsResult> =>
      unwrapIpc<DbTableRowsResult>(ipcRenderer.invoke(IPC_CHANNELS.DB_TABLE_ROWS, params)),
    createRow: (params: DbCreateRowParams): Promise<Record<string, unknown>> =>
      unwrapIpc<Record<string, unknown>>(ipcRenderer.invoke(IPC_CHANNELS.DB_CREATE_ROW, params)),
    updateRow: (params: DbUpdateRowParams): Promise<boolean> =>
      unwrapIpc<boolean>(ipcRenderer.invoke(IPC_CHANNELS.DB_UPDATE_ROW, params)),
    deleteRow: (params: DbRowIdentifier): Promise<boolean> =>
      unwrapIpc<boolean>(ipcRenderer.invoke(IPC_CHANNELS.DB_DELETE_ROW, params)),
    vacuum: (): Promise<{ freedBytes: number }> =>
      unwrapIpc<{ freedBytes: number }>(ipcRenderer.invoke(IPC_CHANNELS.DB_VACUUM)),
    rebuildFts: (): Promise<{ rowsIndexed: number }> =>
      unwrapIpc<{ rowsIndexed: number }>(ipcRenderer.invoke(IPC_CHANNELS.DB_REBUILD_FTS)),
    purgeArchived: (): Promise<{ casesDeleted: number; capturesDeleted: number }> =>
      unwrapIpc<{ casesDeleted: number; capturesDeleted: number }>(
        ipcRenderer.invoke(IPC_CHANNELS.DB_PURGE_ARCHIVED)
      ),
    findOrphans: (): Promise<OrphanReport> =>
      unwrapIpc<OrphanReport>(ipcRenderer.invoke(IPC_CHANNELS.DB_FIND_ORPHANS)),
    cleanOrphans: (
      report: OrphanReport
    ): Promise<{ dbRecordsRemoved: number; filesRemoved: number }> =>
      unwrapIpc<{ dbRecordsRemoved: number; filesRemoved: number }>(
        ipcRenderer.invoke(IPC_CHANNELS.DB_CLEAN_ORPHANS, report)
      ),
    backup: (): Promise<{ path: string } | null> =>
      unwrapIpc<{ path: string } | null>(ipcRenderer.invoke(IPC_CHANNELS.DB_BACKUP)),
    restore: (): Promise<{ restored: boolean }> =>
      unwrapIpc<{ restored: boolean }>(ipcRenderer.invoke(IPC_CHANNELS.DB_RESTORE)),
    exportTable: (params: DbExportTableParams): Promise<{ path: string } | null> =>
      unwrapIpc<{ path: string } | null>(ipcRenderer.invoke(IPC_CHANNELS.DB_EXPORT_TABLE, params))
  },

  ai: {
    analyze: (
      params: AnalyzeCaptureParams
    ): Promise<{
      content: string
      tokenUsage: { prompt: number; completion: number; total: number }
    }> =>
      unwrapIpc<{
        content: string
        tokenUsage: { prompt: number; completion: number; total: number }
      }>(ipcRenderer.invoke(IPC_CHANNELS.AI_ANALYZE, params)),
    saveAnalysis: (analysis: CaptureAnalysis): Promise<void> =>
      unwrapIpc<void>(ipcRenderer.invoke(IPC_CHANNELS.AI_SAVE_ANALYSIS, analysis)),
    updateAnalysis: (params: UpdateAnalysisParams): Promise<void> =>
      unwrapIpc<void>(ipcRenderer.invoke(IPC_CHANNELS.AI_UPDATE_ANALYSIS, params)),
    getAnalysis: (captureId: string): Promise<CaptureAnalysis | null> =>
      unwrapIpc<CaptureAnalysis | null>(
        ipcRenderer.invoke(IPC_CHANNELS.AI_GET_ANALYSIS, { captureId })
      ),
    deleteAnalysis: (id: string): Promise<void> =>
      unwrapIpc<void>(ipcRenderer.invoke(IPC_CHANNELS.AI_DELETE_ANALYSIS, { id }))
  },

  // Event listeners (main -> renderer)
  onNewCapture: (callback: (capture: Capture) => void) => {
    const handler = (_: unknown, capture: Capture) => callback(capture)
    ipcRenderer.on(IPC_CHANNELS.NEW_CAPTURE, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.NEW_CAPTURE, handler)
  },

  onSessionStateChanged: (
    callback: (state: {
      sessionActive: boolean
      activeCaseId: string | null
      captureCount: number
    }) => void
  ) => {
    const handler = (
      _: unknown,
      state: { sessionActive: boolean; activeCaseId: string | null; captureCount: number }
    ) => callback(state)
    ipcRenderer.on(IPC_CHANNELS.SESSION_STATE_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SESSION_STATE_CHANGED, handler)
  },

  onExtensionConnection: (callback: (data: { connected: boolean }) => void) => {
    const handler = (_: unknown, data: { connected: boolean }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.EXTENSION_CONNECTION, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.EXTENSION_CONNECTION, handler)
  },

  onCaptureActivity: (callback: (event: CaptureEvent) => void) => {
    const handler = (_: unknown, event: CaptureEvent) => callback(event)
    ipcRenderer.on(IPC_CHANNELS.CAPTURE_ACTIVITY, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CAPTURE_ACTIVITY, handler)
  },

  testPipeline: (): Promise<{ success: boolean; durationMs: number; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_TEST_PIPELINE),

  testHttp: (): Promise<{ success: boolean; durationMs: number; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_TEST_HTTP),

  extractedData: {
    categories: (caseId: string): Promise<ExtractedDataCategory[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.EXTRACTED_DATA_CATEGORIES, caseId),
    subcategories: (caseId: string, category: string): Promise<ExtractedDataSubcategory[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.EXTRACTED_DATA_SUBCATEGORIES, caseId, category),
    items: (
      caseId: string,
      category: string,
      subcategory: string
    ): Promise<ExtractedDataItem[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.EXTRACTED_DATA_ITEMS, caseId, category, subcategory),
    count: (caseId: string): Promise<number> =>
      ipcRenderer.invoke(IPC_CHANNELS.EXTRACTED_DATA_COUNT, caseId),
    reprocess: (caseId: string): Promise<{ queued: number }> =>
      unwrapIpc<{ queued: number }>(
        ipcRenderer.invoke(IPC_CHANNELS.EXTRACTED_DATA_REPROCESS, caseId)
      )
  }
}

contextBridge.exposeInMainWorld('birdbrain', birdbrain)
