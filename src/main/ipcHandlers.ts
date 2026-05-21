import { app, ipcMain, dialog, shell } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { DEFAULT_ANALYSIS_SYSTEM_PROMPT } from '@shared/constants'
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
  OrphanReport,
  AnalyzeCaptureParams,
  SaveAnnotationsParams,
  UpsertAnnotationPinParams
} from '@shared/ipc'
import * as dbAdmin from '@main/services/dbAdmin'
import { existsSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import * as db from '@main/services/database'
import * as annotations from '@main/services/annotations'
import * as storage from '@main/services/storage'
import * as settings from '@main/services/settings'
import * as openrouter from '@main/services/openrouter'
import * as analysisService from '@main/services/ai/analysisService'
import { generateReport } from '@main/services/export'
import { getExtensionPath, extensionPathExists } from '@main/services/extensionPath'
import { buildCsv } from '@main/services/csvEscape'
import { getInstallationId } from '@main/services/installationId'
import { CAPTURE_SERVER_PORT, getSessionState } from '@main/services/captureServer'
import { getServerToken } from '@main/services/serverToken'
import type { CaptureLifecycle } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { handle, IpcFailure } from '@main/ipcWrap'
import type { BirdbrainSettings, ExportOptions, CaptureAnalysis } from '@shared/types'

export function registerIpcHandlers(deps: {
  selectorLifecycle: SelectorLifecycle
  captureLifecycle: CaptureLifecycle
}): void {
  const { selectorLifecycle, captureLifecycle } = deps
  // Cases
  ipcMain.handle(IPC_CHANNELS.CASES_LIST, () => db.listCases())
  ipcMain.handle(IPC_CHANNELS.CASES_GET, (_, id: string) => db.getCase(id))
  handle(IPC_CHANNELS.CASES_CREATE, (_, params: CreateCaseParams) => db.createCase(params))
  handle(IPC_CHANNELS.CASES_UPDATE, (_, params: UpdateCaseParams) => db.updateCase(params))
  handle(IPC_CHANNELS.CASES_DELETE, (_, id: string) => db.deleteCase(id))

  // Captures
  ipcMain.handle(IPC_CHANNELS.CAPTURES_LIST, (_, caseId: string) => db.listCaptures(caseId))
  ipcMain.handle(IPC_CHANNELS.CAPTURES_GET, (_, id: string) => db.getCapture(id))
  handle(IPC_CHANNELS.CAPTURES_DELETE, (_, id: string) => captureLifecycle.delete(id))

  handle(IPC_CHANNELS.CAPTURES_COUNTS_BY_CASE, () => db.getCaptureCountsByCase())

  handle(IPC_CHANNELS.CAPTURES_DOWNLOAD, async (_, captureId: string): Promise<string | null> => {
    const capture = db.getCapture(captureId)
    if (!capture) return null
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `${capture.title || 'capture'}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }]
    })
    if (canceled || !filePath) return null
    const buffer = storage.readCaptureFile(capture.caseId, captureId, 'html')
    if (!buffer) throw new IpcFailure('HTML file not found')
    const { writeFileSync } = await import('fs')
    writeFileSync(filePath, buffer)
    return filePath
  })

  handle(IPC_CHANNELS.CAPTURES_OPEN_EXTERNAL, async (_, url: string) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new IpcFailure('Invalid URL', 'INVALID_URL')
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new IpcFailure('URL protocol not allowed', 'INVALID_URL_PROTOCOL')
    }

    await shell.openExternal(url)
  })

  // Capture pipeline test
  ipcMain.handle(IPC_CHANNELS.CAPTURES_TEST_PIPELINE, async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${CAPTURE_SERVER_PORT}/api/captures/test`, {
        headers: { 'X-Birdbrain-Token': getServerToken() }
      })
      return res.json()
    } catch (err) {
      return { success: false, durationMs: 0, error: String(err) }
    }
  })

  // HTTP test (verifies Hono server is reachable)
  ipcMain.handle(IPC_CHANNELS.CAPTURES_TEST_HTTP, async () => {
    const start = Date.now()
    try {
      const res = await fetch(`http://127.0.0.1:${CAPTURE_SERVER_PORT}/api/status`)
      const ok = res.ok
      return {
        success: ok,
        durationMs: Date.now() - start,
        error: ok ? undefined : `HTTP ${res.status}`
      }
    } catch (err) {
      return { success: false, durationMs: Date.now() - start, error: String(err) }
    }
  })

  // Tags
  ipcMain.handle(IPC_CHANNELS.TAGS_LIST, () => db.listTags())
  handle(IPC_CHANNELS.TAGS_CREATE, (_, params: CreateTagParams) => db.createTag(params))
  handle(IPC_CHANNELS.TAGS_UPDATE, (_, params: UpdateTagParams) => db.updateTag(params))
  handle(IPC_CHANNELS.TAGS_DELETE, (_, id: string) => db.deleteTag(id))
  handle(IPC_CHANNELS.TAGS_ADD_TO_CAPTURE, (_, params: CaptureTagParams) => {
    db.addTagToCapture(params)
  })
  handle(IPC_CHANNELS.TAGS_REMOVE_FROM_CAPTURE, (_, params: CaptureTagParams) => {
    db.removeTagFromCapture(params)
  })
  ipcMain.handle(IPC_CHANNELS.TAGS_GET_FOR_CAPTURE, (_, captureId: string) =>
    db.getTagsForCapture(captureId)
  )
  ipcMain.handle(IPC_CHANNELS.TAGS_COUNT_FOR_CASE, (_, caseId: string) =>
    db.getTagCountForCase(caseId)
  )
  ipcMain.handle(IPC_CHANNELS.TAGS_USAGE_COUNTS_FOR_CASE, (_, caseId: string) =>
    db.getTagUsageCountsForCase(caseId)
  )

  // Selectors
  ipcMain.handle(IPC_CHANNELS.SELECTORS_LIST, (_, caseId: string) => db.listSelectors(caseId))
  ipcMain.handle(IPC_CHANNELS.SELECTORS_GET, (_, id: string) => db.getSelector(id))
  handle(IPC_CHANNELS.SELECTORS_CREATE, (_, params: CreateSelectorParams) =>
    selectorLifecycle.createSelector(params)
  )
  handle(IPC_CHANNELS.SELECTORS_BULK_CREATE, (_, params: BulkCreateSelectorsParams) =>
    selectorLifecycle.bulkCreateSelectors(params)
  )
  handle(IPC_CHANNELS.SELECTORS_UPDATE, (_, params: UpdateSelectorParams) =>
    selectorLifecycle.updateSelector(params)
  )
  handle(IPC_CHANNELS.SELECTORS_DELETE, (_, id: string) => db.deleteSelector(id))
  ipcMain.handle(IPC_CHANNELS.SELECTORS_LIST_ACTIVE, () => {
    const { activeCaseId } = getSessionState()
    return db.listActiveSelectors(activeCaseId ?? undefined)
  })
  ipcMain.handle(IPC_CHANNELS.SELECTORS_MATCH_COUNTS, (_, caseId: string) =>
    db.getSelectorMatchCounts(caseId)
  )
  ipcMain.handle(
    IPC_CHANNELS.SELECTORS_MATCHING_CAPTURES,
    (_, caseId: string, selectorIds: string[]) =>
      db.getCapturesMatchingSelectors(caseId, selectorIds)
  )
  ipcMain.handle(IPC_CHANNELS.SELECTORS_COVERAGE, (_, caseId: string) =>
    db.getSelectorCoverage(caseId)
  )
  handle(IPC_CHANNELS.SELECTORS_EXPORT_MATCHES, async (_, caseId: string) => {
    const caseRow = db.getCase(caseId)
    if (!caseRow) return { exported: false }
    const rows = db.getSelectorMatchesForExport(caseId)
    const csv = buildCsv(
      [
        'Selector Pattern',
        'Selector Label',
        'Type',
        'Capture URL',
        'Capture Title',
        'Capture Timestamp'
      ],
      rows.map((r) => [
        r.selectorPattern,
        r.selectorLabel ?? '',
        r.isRegex ? 'regex' : 'text',
        r.captureUrl,
        r.captureTitle ?? '',
        r.captureTimestamp
      ])
    )
    const safeName = caseRow.name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'case'
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `${safeName}_selector_matches.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (canceled || !filePath) return { exported: false }
    const { writeFileSync } = await import('fs')
    writeFileSync(filePath, csv, 'utf-8')
    return { exported: true, path: filePath }
  })

  // Notes
  ipcMain.handle(IPC_CHANNELS.NOTES_LIST, (_, caseId: string) => db.listNotes(caseId))
  ipcMain.handle(IPC_CHANNELS.NOTES_GET, (_, id: string) => db.getNote(id))
  handle(IPC_CHANNELS.NOTES_CREATE, (_, params: CreateNoteParams) => db.createNote(params))
  handle(IPC_CHANNELS.NOTES_UPDATE, (_, params: UpdateNoteParams) => db.updateNote(params))
  handle(IPC_CHANNELS.NOTES_DELETE, (_, id: string) => db.deleteNote(id))
  ipcMain.handle(IPC_CHANNELS.NOTES_COUNT, (_, caseId: string) => db.getNoteCount(caseId))
  ipcMain.handle(IPC_CHANNELS.NOTES_SEARCH, (_, caseId: string, query: string) => {
    try {
      return db.searchNotes(caseId, query)
    } catch {
      // FTS5 can throw on malformed queries (e.g. unmatched quotes, reserved keywords).
      // Return empty results so the UI gracefully handles bad input.
      return []
    }
  })

  // Annotations
  ipcMain.handle(IPC_CHANNELS.ANNOTATIONS_GET, (_, captureId: string) =>
    annotations.getAnnotations(captureId)
  )
  handle(IPC_CHANNELS.ANNOTATIONS_SAVE, (_, params: SaveAnnotationsParams) =>
    annotations.saveAnnotations(params)
  )
  handle(IPC_CHANNELS.ANNOTATIONS_DELETE, (_, captureId: string) => {
    annotations.deleteAnnotations(captureId)
  })
  handle(IPC_CHANNELS.ANNOTATIONS_UPSERT_PIN, (_, params: UpsertAnnotationPinParams) =>
    annotations.upsertPin(params)
  )
  handle(IPC_CHANNELS.ANNOTATIONS_DELETE_PIN, (_, pinId: string) => {
    annotations.deletePin(pinId)
  })

  // Extension
  handle(IPC_CHANNELS.EXTENSION_PATH, () => {
    if (!extensionPathExists()) {
      throw new IpcFailure('Extension directory not found', 'EXT_NOT_FOUND')
    }
    return getExtensionPath()
  })

  handle(IPC_CHANNELS.EXTENSION_OPEN_FOLDER, async () => {
    const extPath = getExtensionPath()
    if (!extensionPathExists()) {
      throw new IpcFailure('Extension directory not found', 'EXT_NOT_FOUND')
    }
    const openError = await shell.openPath(extPath)
    if (openError) {
      throw new IpcFailure(openError, 'OPEN_PATH_FAILED')
    }
  })

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

  // Captures - get thumbnail
  ipcMain.handle(IPC_CHANNELS.CAPTURES_GET_THUMBNAIL, (_, captureId: string) => {
    try {
      const capture = db.getCapture(captureId)
      if (!capture) return null
      const buffer = storage.getThumbnail(capture.caseId, captureId)
      if (!buffer) return null
      return buffer.toString('base64')
    } catch (err) {
      console.error('Error getting thumbnail:', err)
      return null
    }
  })

  // Captures - get matching selectors
  ipcMain.handle(IPC_CHANNELS.CAPTURES_GET_MATCHING_SELECTORS, (_, captureId: string) => {
    return db.getCaptureMatchingSelectors(captureId)
  })

  // Captures - favorites
  handle(IPC_CHANNELS.CAPTURES_TOGGLE_FAVORITE, (_, captureId: string) =>
    db.toggleFavorite(captureId)
  )

  handle(IPC_CHANNELS.CAPTURES_IS_FAVORITE, (_, captureId: string) => db.isFavorite(captureId))

  handle(IPC_CHANNELS.CAPTURES_LIST_FAVORITES, (_, caseId: string) => db.listFavorites(caseId))

  handle(IPC_CHANNELS.CAPTURES_GET_MHTML_URL, (_, captureId: string): string | null => {
    const capture = db.getCapture(captureId)
    if (!capture || !capture.mhtmlPath) return null
    const abs = join(storage.getStorageRoot(), capture.mhtmlPath)
    if (!existsSync(abs)) return null
    return pathToFileURL(abs).toString()
  })

  handle(IPC_CHANNELS.CAPTURES_VERIFY, (_, captureId: string) => captureLifecycle.verify(captureId))

  // Search
  ipcMain.handle(IPC_CHANNELS.SEARCH, (_, query: string) => {
    try {
      return db.searchCaptures(query)
    } catch {
      // FTS5 can throw on malformed queries (e.g. unmatched quotes, reserved keywords).
      // Return empty results so the UI gracefully handles bad input.
      return []
    }
  })

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
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_IDENTITY, () => {
    return {
      installationId: getInstallationId(),
      operatorName: settings.getSettings().operatorName ?? ''
    }
  })
  ipcMain.handle(IPC_CHANNELS.SETTINGS_CHOOSE_STORAGE_PATH, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Choose Storage Location'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Export
  handle(IPC_CHANNELS.EXPORT_GENERATE, async (_, caseId: string, options: ExportOptions) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: options.outputPath || 'report.html',
      filters: [{ name: 'HTML', extensions: ['html'] }]
    })
    if (canceled || !filePath) return
    await generateReport(caseId, { ...options, outputPath: filePath }, captureLifecycle)
  })

  // AI Analysis
  handle(IPC_CHANNELS.AI_ANALYZE, async (_, params: AnalyzeCaptureParams) => {
    const currentSettings = settings.getSettings()
    const apiKey = currentSettings.openRouterApiKey
    if (!apiKey) throw new IpcFailure('No OpenRouter API key configured')
    const systemPrompt = currentSettings.analysisSystemPrompt?.trim()
      ? currentSettings.analysisSystemPrompt
      : DEFAULT_ANALYSIS_SYSTEM_PROMPT
    try {
      return await analysisService.analyzeCapture(
        params.captureId,
        params.caseId,
        params.model,
        apiKey,
        systemPrompt
      )
    } catch (err) {
      throw new IpcFailure(err instanceof Error ? err.message : String(err))
    }
  })

  handle(IPC_CHANNELS.AI_SAVE_ANALYSIS, (_, analysis: CaptureAnalysis) => {
    analysisService.saveAnalysis(analysis)
  })

  handle(IPC_CHANNELS.AI_GET_ANALYSIS, (_, params: { captureId: string }) =>
    analysisService.getAnalysis(params.captureId)
  )

  // Database Admin
  handle(IPC_CHANNELS.DB_STATS, () => {
    const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
    const dbPath = join(userDataPath, 'birdbrain.db')
    return dbAdmin.getDbStats(dbPath)
  })

  handle(IPC_CHANNELS.DB_TABLE_ROWS, (_, params: DbTableRowsParams) => dbAdmin.getTableRows(params))

  handle(IPC_CHANNELS.DB_CREATE_ROW, (_, params: DbCreateRowParams) =>
    dbAdmin.createRow(params.table, params.data)
  )

  handle(IPC_CHANNELS.DB_UPDATE_ROW, (_, params: DbUpdateRowParams) =>
    dbAdmin.updateRow(params.table, params.pk, params.data)
  )

  handle(IPC_CHANNELS.DB_DELETE_ROW, (_, params: DbRowIdentifier) =>
    dbAdmin.deleteRow(params.table, params.pk)
  )

  handle(IPC_CHANNELS.DB_VACUUM, () => {
    const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
    const dbPath = join(userDataPath, 'birdbrain.db')
    return dbAdmin.vacuumDb(dbPath)
  })

  handle(IPC_CHANNELS.DB_REBUILD_FTS, () => dbAdmin.rebuildFts())

  handle(IPC_CHANNELS.DB_PURGE_ARCHIVED, () => dbAdmin.purgeArchived())

  handle(IPC_CHANNELS.DB_FIND_ORPHANS, () => dbAdmin.findOrphans())

  handle(IPC_CHANNELS.DB_CLEAN_ORPHANS, (_, report: OrphanReport) => dbAdmin.cleanOrphans(report))

  handle(IPC_CHANNELS.DB_BACKUP, async () => {
    const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
    const dbPath = join(userDataPath, 'birdbrain.db')
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: 'birdbrain-backup.db',
      filters: [{ name: 'SQLite Database', extensions: ['db'] }]
    })
    if (canceled || !filePath) return null
    dbAdmin.backupDatabase(dbPath, filePath)
    return { path: filePath }
  })

  handle(IPC_CHANNELS.DB_RESTORE, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return { restored: false }

    const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
    const dbPath = join(userDataPath, 'birdbrain.db')
    const { closeDatabase, initDatabase } = await import('@main/services/database')
    const { copyFileSync } = await import('fs')

    closeDatabase()
    copyFileSync(filePaths[0], dbPath)
    initDatabase(dbPath)

    return { restored: true }
  })

  handle(IPC_CHANNELS.DB_EXPORT_TABLE, async (_, params: DbExportTableParams) => {
    const content = dbAdmin.exportTableData(params.table, params.format)
    const ext = params.format === 'csv' ? 'csv' : 'json'
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `${params.table}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
    })
    if (canceled || !filePath) return null
    const { writeFileSync } = await import('fs')
    writeFileSync(filePath, content, 'utf-8')
    return { path: filePath }
  })

  // Extracted Data
  ipcMain.handle(IPC_CHANNELS.EXTRACTED_DATA_CATEGORIES, (_, caseId: string) =>
    db.getExtractedCategories(caseId)
  )
  ipcMain.handle(IPC_CHANNELS.EXTRACTED_DATA_SUBCATEGORIES, (_, caseId: string, category: string) =>
    db.getExtractedSubcategories(caseId, category)
  )
  ipcMain.handle(
    IPC_CHANNELS.EXTRACTED_DATA_ITEMS,
    (_, caseId: string, category: string, subcategory: string) =>
      db.getExtractedItems(caseId, category, subcategory)
  )
  ipcMain.handle(IPC_CHANNELS.EXTRACTED_DATA_COUNT, (_, caseId: string) =>
    db.getExtractedDataCountForCase(caseId)
  )
  handle(IPC_CHANNELS.EXTRACTED_DATA_REPROCESS, (_, caseId: string) =>
    captureLifecycle.reprocessCase(caseId)
  )
}
