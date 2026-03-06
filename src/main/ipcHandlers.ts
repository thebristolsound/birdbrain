import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type {
  CreateCaseParams,
  UpdateCaseParams,
  CreateTagParams,
  UpdateTagParams,
  CaptureTagParams
} from '@shared/ipc'
import * as db from '@main/services/database'
import * as storage from '@main/services/storage'
import * as settings from '@main/services/settings'
import * as openrouter from '@main/services/openrouter'
import { extractEntities } from '@main/services/ai/entityExtraction'
import type { BirdbrainSettings } from '@shared/types'

export function registerIpcHandlers(): void {
  // Cases
  ipcMain.handle(IPC_CHANNELS.CASES_LIST, () => db.listCases())
  ipcMain.handle(IPC_CHANNELS.CASES_GET, (_, id: string) => db.getCase(id))
  ipcMain.handle(IPC_CHANNELS.CASES_CREATE, (_, params: CreateCaseParams) => db.createCase(params))
  ipcMain.handle(IPC_CHANNELS.CASES_UPDATE, (_, params: UpdateCaseParams) => db.updateCase(params))
  ipcMain.handle(IPC_CHANNELS.CASES_DELETE, (_, id: string) => db.deleteCase(id))

  // Captures
  ipcMain.handle(IPC_CHANNELS.CAPTURES_LIST, (_, caseId: string) => db.listCaptures(caseId))
  ipcMain.handle(IPC_CHANNELS.CAPTURES_GET, (_, id: string) => db.getCapture(id))
  ipcMain.handle(IPC_CHANNELS.CAPTURES_DELETE, (_, id: string) => db.deleteCapture(id))

  // Tags
  ipcMain.handle(IPC_CHANNELS.TAGS_LIST, () => db.listTags())
  ipcMain.handle(IPC_CHANNELS.TAGS_CREATE, (_, params: CreateTagParams) => db.createTag(params))
  ipcMain.handle(IPC_CHANNELS.TAGS_UPDATE, (_, params: UpdateTagParams) => db.updateTag(params))
  ipcMain.handle(IPC_CHANNELS.TAGS_DELETE, (_, id: string) => db.deleteTag(id))
  ipcMain.handle(IPC_CHANNELS.TAGS_ADD_TO_CAPTURE, (_, params: CaptureTagParams) =>
    db.addTagToCapture(params)
  )
  ipcMain.handle(IPC_CHANNELS.TAGS_REMOVE_FROM_CAPTURE, (_, params: CaptureTagParams) =>
    db.removeTagFromCapture(params)
  )
  ipcMain.handle(IPC_CHANNELS.TAGS_GET_FOR_CAPTURE, (_, captureId: string) =>
    db.getTagsForCapture(captureId)
  )

  // Captures - get content
  ipcMain.handle(
    IPC_CHANNELS.CAPTURES_GET_CONTENT,
    (_, captureId: string, type: 'html' | 'png' | 'txt') => {
      const capture = db.getCapture(captureId)
      if (!capture) return null
      const buffer = storage.readCaptureFile(capture.caseId, captureId, type)
      if (!buffer) return null
      if (type === 'png') return buffer.toString('base64')
      return buffer.toString('utf-8')
    }
  )

  // Search
  ipcMain.handle(IPC_CHANNELS.SEARCH, (_, query: string) => db.searchCaptures(query))

  // Settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => settings.getSettings())
  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, (_, partial: Partial<BirdbrainSettings>) =>
    settings.updateSettings(partial)
  )
  ipcMain.handle(IPC_CHANNELS.SETTINGS_RESET, () => settings.resetSettings())
  ipcMain.handle(IPC_CHANNELS.SETTINGS_TEST_OPENROUTER, (_, apiKey: string) =>
    openrouter.testApiKey(apiKey)
  )
  ipcMain.handle(IPC_CHANNELS.SETTINGS_LIST_MODELS, (_, apiKey: string) =>
    openrouter.listModels(apiKey)
  )

  // AI
  ipcMain.handle(IPC_CHANNELS.AI_EXTRACT_ENTITIES, (_, captureId: string) =>
    extractEntities(captureId)
  )
  ipcMain.handle(IPC_CHANNELS.AI_GET_ENTITIES, (_, captureId: string) =>
    db.getEntitiesByCapture(captureId)
  )
}
