import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC_CHANNELS } from '@shared/ipc'
import type {
  CreateCaseParams,
  UpdateCaseParams,
  CreateTagParams,
  UpdateTagParams,
  CaptureTagParams,
  CreateSelectorParams,
  UpdateSelectorParams
} from '@shared/ipc'
import type { Case, Capture, Tag, Entity, EntityGraph, CaseAnalysisResult, BirdbrainSettings, OpenRouterModel, ExportOptions, Selector, ActiveCaseSelectors, CaptureEvent } from '@shared/types'

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
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.CASES_DELETE, id)
  },
  captures: {
    list: (caseId: string): Promise<Capture[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_LIST, caseId),
    get: (id: string): Promise<Capture | undefined> =>
      ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_GET, id),
    delete: (id: string): Promise<boolean> => unwrapIpc<boolean>(ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_DELETE, id)),
    getContent: (captureId: string, type: 'html' | 'png' | 'txt'): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_GET_CONTENT, captureId, type)
  },
  tags: {
    list: (): Promise<Tag[]> => ipcRenderer.invoke(IPC_CHANNELS.TAGS_LIST),
    create: (params: CreateTagParams): Promise<Tag> =>
      unwrapIpc<Tag>(ipcRenderer.invoke(IPC_CHANNELS.TAGS_CREATE, params)),
    update: (params: UpdateTagParams): Promise<Tag | undefined> =>
      unwrapIpc<Tag | undefined>(ipcRenderer.invoke(IPC_CHANNELS.TAGS_UPDATE, params)),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.TAGS_DELETE, id),
    addToCapture: (params: CaptureTagParams): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.TAGS_ADD_TO_CAPTURE, params),
    removeFromCapture: (params: CaptureTagParams): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.TAGS_REMOVE_FROM_CAPTURE, params),
    getForCapture: (captureId: string): Promise<Tag[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.TAGS_GET_FOR_CAPTURE, captureId)
  },
  selectors: {
    list: (caseId: string): Promise<Selector[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_LIST, caseId),
    get: (id: string): Promise<Selector | undefined> =>
      ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_GET, id),
    create: (params: CreateSelectorParams): Promise<Selector> =>
      unwrapIpc<Selector>(ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_CREATE, params)),
    update: (params: UpdateSelectorParams): Promise<Selector | undefined> =>
      ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_UPDATE, params),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_DELETE, id),
    listActive: (): Promise<ActiveCaseSelectors[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_LIST_ACTIVE),
    matchCounts: (caseId: string): Promise<Record<string, number>> =>
      ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_MATCH_COUNTS, caseId),
    matchingCaptures: (caseId: string, selectorIds: string[]): Promise<string[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_MATCHING_CAPTURES, caseId, selectorIds)
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
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_LIST_MODELS, apiKey)
  },

  ai: {
    extractEntities: (captureId: string): Promise<Entity[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_EXTRACT_ENTITIES, captureId),
    getEntities: (captureId: string): Promise<Entity[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_GET_ENTITIES, captureId),
    buildGraph: (caseId: string): Promise<EntityGraph> =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_BUILD_GRAPH, caseId),
    analyzeCase: (caseId: string): Promise<CaseAnalysisResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_ANALYZE_CASE, caseId),
    getAnalysis: (caseId: string): Promise<CaseAnalysisResult | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_GET_ANALYSIS, caseId)
  },

  export: {
    generateReport: (caseId: string, options: ExportOptions): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.EXPORT_GENERATE, caseId, options)
  },

  // Event listeners (main -> renderer)
  onNewCapture: (callback: (capture: Capture) => void) => {
    const handler = (_: unknown, capture: Capture) => callback(capture)
    ipcRenderer.on(IPC_CHANNELS.NEW_CAPTURE, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.NEW_CAPTURE, handler)
  },

  onSessionStateChanged: (callback: (state: { sessionActive: boolean; activeCaseId: string | null; captureCount: number }) => void) => {
    const handler = (_: unknown, state: { sessionActive: boolean; activeCaseId: string | null; captureCount: number }) => callback(state)
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
    ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_TEST_HTTP)
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('birdbrain', birdbrain)
