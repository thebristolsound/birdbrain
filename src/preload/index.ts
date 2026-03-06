import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC_CHANNELS } from '@shared/ipc'
import type {
  CreateCaseParams,
  UpdateCaseParams,
  CreateTagParams,
  UpdateTagParams,
  CaptureTagParams
} from '@shared/ipc'
import type { Case, Capture, Tag, Entity, BirdbrainSettings, OpenRouterModel } from '@shared/types'

const birdbrain = {
  cases: {
    list: (): Promise<Case[]> => ipcRenderer.invoke(IPC_CHANNELS.CASES_LIST),
    get: (id: string): Promise<Case | undefined> => ipcRenderer.invoke(IPC_CHANNELS.CASES_GET, id),
    create: (params: CreateCaseParams): Promise<Case> =>
      ipcRenderer.invoke(IPC_CHANNELS.CASES_CREATE, params),
    update: (params: UpdateCaseParams): Promise<Case | undefined> =>
      ipcRenderer.invoke(IPC_CHANNELS.CASES_UPDATE, params),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.CASES_DELETE, id)
  },
  captures: {
    list: (caseId: string): Promise<Capture[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_LIST, caseId),
    get: (id: string): Promise<Capture | undefined> =>
      ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_GET, id),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_DELETE, id),
    getContent: (captureId: string, type: 'html' | 'png' | 'txt'): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_GET_CONTENT, captureId, type)
  },
  tags: {
    list: (): Promise<Tag[]> => ipcRenderer.invoke(IPC_CHANNELS.TAGS_LIST),
    create: (params: CreateTagParams): Promise<Tag> =>
      ipcRenderer.invoke(IPC_CHANNELS.TAGS_CREATE, params),
    update: (params: UpdateTagParams): Promise<Tag | undefined> =>
      ipcRenderer.invoke(IPC_CHANNELS.TAGS_UPDATE, params),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.TAGS_DELETE, id),
    addToCapture: (params: CaptureTagParams): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.TAGS_ADD_TO_CAPTURE, params),
    removeFromCapture: (params: CaptureTagParams): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.TAGS_REMOVE_FROM_CAPTURE, params),
    getForCapture: (captureId: string): Promise<Tag[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.TAGS_GET_FOR_CAPTURE, captureId)
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
      ipcRenderer.invoke(IPC_CHANNELS.AI_GET_ENTITIES, captureId)
  },

  // Event listeners (main -> renderer)
  onNewCapture: (callback: (capture: Capture) => void) => {
    const handler = (_: unknown, capture: Capture) => callback(capture)
    ipcRenderer.on(IPC_CHANNELS.NEW_CAPTURE, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.NEW_CAPTURE, handler)
  }
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('birdbrain', birdbrain)
