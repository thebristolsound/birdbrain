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
import { withDeletionEntry, ManifestRollback } from '@main/services/manifest'
import { getInstallationId } from '@main/services/installationId'
import { CAPTURE_SERVER_PORT, getSessionState } from '@main/services/captureServer'
import { extractData } from '@main/services/dataExtractor'
import { readExtractionHtml } from '@main/services/extraction/extractionSource'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import type { BirdbrainSettings, ExportOptions, CaptureAnalysis } from '@shared/types'

type IpcResult<T = unknown> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      error: string
      code?: string
    }

function ipcResult<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

function ipcError(err: unknown): IpcResult<never> {
  const sqliteErr = err as { code?: string; message?: string }
  if (sqliteErr.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return { ok: false, error: 'A record with that value already exists', code: sqliteErr.code }
  }
  if (sqliteErr.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return { ok: false, error: 'Referenced record does not exist', code: sqliteErr.code }
  }
  if (sqliteErr.code === 'SQLITE_BUSY') {
    return { ok: false, error: 'Database is busy, please try again', code: sqliteErr.code }
  }
  if (typeof sqliteErr.code === 'string' && sqliteErr.code.startsWith('SQLITE_')) {
    return { ok: false, error: sqliteErr.message ?? 'Database error', code: sqliteErr.code }
  }
  throw err
}

export function registerIpcHandlers(deps: { selectorLifecycle: SelectorLifecycle }): void {
  const { selectorLifecycle } = deps
  // Cases
  ipcMain.handle(IPC_CHANNELS.CASES_LIST, () => db.listCases())
  ipcMain.handle(IPC_CHANNELS.CASES_GET, (_, id: string) => db.getCase(id))
  ipcMain.handle(IPC_CHANNELS.CASES_CREATE, (_, params: CreateCaseParams) => {
    try {
      return ipcResult(db.createCase(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.CASES_UPDATE, (_, params: UpdateCaseParams) => {
    try {
      return ipcResult(db.updateCase(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.CASES_DELETE, (_, id: string) => {
    try {
      return ipcResult(db.deleteCase(id))
    } catch (err) {
      return ipcError(err)
    }
  })

  // Captures
  ipcMain.handle(IPC_CHANNELS.CAPTURES_LIST, (_, caseId: string) => db.listCaptures(caseId))
  ipcMain.handle(IPC_CHANNELS.CAPTURES_GET, (_, id: string) => db.getCapture(id))
  ipcMain.handle(IPC_CHANNELS.CAPTURES_DELETE, (_, id: string) => {
    try {
      const capture = db.getCapture(id)
      if (!capture) return ipcResult(false)

      if (capture.format === 'mhtml') {
        const caseDir = join(storage.getStorageRoot(), capture.caseId)
        try {
          withDeletionEntry(
            caseDir,
            {
              captureId: id,
              caseId: capture.caseId,
              contentHash: capture.hash,
              operatorId: getInstallationId(),
              operatorName: settings.getSettings().operatorName ?? '',
              toolVersion:
                typeof app?.getVersion === 'function'
                  ? app.getVersion()
                  : (process.env.npm_package_version ?? '0.0.0')
            },
            () => {
              const deleted = db.deleteCapture(id)
              if (!deleted) throw new ManifestRollback()
              storage.deleteCaptureFiles(capture.caseId, id)
            }
          )
          return ipcResult(true)
        } catch (err) {
          if (err instanceof ManifestRollback) return ipcResult(false)
          throw err
        }
      }

      const deleted = db.deleteCapture(id)
      if (deleted) storage.deleteCaptureFiles(capture.caseId, id)
      return ipcResult(deleted)
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURES_COUNTS_BY_CASE, () => {
    try {
      return ipcResult(db.getCaptureCountsByCase())
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURES_DOWNLOAD, async (_, captureId: string) => {
    try {
      const capture = db.getCapture(captureId)
      if (!capture) return ipcResult(null)
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: `${capture.title || 'capture'}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }]
      })
      if (canceled || !filePath) return ipcResult(null)
      const buffer = storage.readCaptureFile(capture.caseId, captureId, 'html')
      if (!buffer) return { ok: false, error: 'HTML file not found' }
      const { writeFileSync } = await import('fs')
      writeFileSync(filePath, buffer)
      return ipcResult(filePath)
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURES_OPEN_EXTERNAL, async (_, url: string) => {
    try {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return {
          ok: false,
          error: 'Invalid URL',
          code: 'INVALID_URL'
        } as IpcResult
      }

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
          ok: false,
          error: 'URL protocol not allowed',
          code: 'INVALID_URL_PROTOCOL'
        } as IpcResult
      }

      await shell.openExternal(url)
      return ipcResult(undefined)
    } catch (err) {
      return ipcError(err)
    }
  })

  // Capture pipeline test
  ipcMain.handle(IPC_CHANNELS.CAPTURES_TEST_PIPELINE, async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${CAPTURE_SERVER_PORT}/api/captures/test`)
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
  ipcMain.handle(IPC_CHANNELS.TAGS_CREATE, (_, params: CreateTagParams) => {
    try {
      return ipcResult(db.createTag(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.TAGS_UPDATE, (_, params: UpdateTagParams) => {
    try {
      return ipcResult(db.updateTag(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.TAGS_DELETE, (_, id: string) => {
    try {
      return ipcResult(db.deleteTag(id))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.TAGS_ADD_TO_CAPTURE, (_, params: CaptureTagParams) => {
    try {
      db.addTagToCapture(params)
      return ipcResult(undefined)
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.TAGS_REMOVE_FROM_CAPTURE, (_, params: CaptureTagParams) => {
    try {
      db.removeTagFromCapture(params)
      return ipcResult(undefined)
    } catch (err) {
      return ipcError(err)
    }
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
  ipcMain.handle(IPC_CHANNELS.SELECTORS_CREATE, (_, params: CreateSelectorParams) => {
    try {
      return ipcResult(selectorLifecycle.createSelector(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.SELECTORS_BULK_CREATE, (_, params: BulkCreateSelectorsParams) => {
    try {
      return ipcResult(selectorLifecycle.bulkCreateSelectors(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.SELECTORS_UPDATE, (_, params: UpdateSelectorParams) => {
    try {
      return ipcResult(selectorLifecycle.updateSelector(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.SELECTORS_DELETE, (_, id: string) => {
    try {
      return ipcResult(db.deleteSelector(id))
    } catch (err) {
      return ipcError(err)
    }
  })
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
  ipcMain.handle(IPC_CHANNELS.SELECTORS_EXPORT_MATCHES, async (_, caseId: string) => {
    try {
      const caseRow = db.getCase(caseId)
      if (!caseRow) return ipcResult({ exported: false })
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
      if (canceled || !filePath) return ipcResult({ exported: false })
      const { writeFileSync } = await import('fs')
      writeFileSync(filePath, csv, 'utf-8')
      return ipcResult({ exported: true, path: filePath })
    } catch (err) {
      return ipcError(err)
    }
  })

  // Notes
  ipcMain.handle(IPC_CHANNELS.NOTES_LIST, (_, caseId: string) => db.listNotes(caseId))
  ipcMain.handle(IPC_CHANNELS.NOTES_GET, (_, id: string) => db.getNote(id))
  ipcMain.handle(IPC_CHANNELS.NOTES_CREATE, (_, params: CreateNoteParams) => {
    try {
      return ipcResult(db.createNote(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.NOTES_UPDATE, (_, params: UpdateNoteParams) => {
    try {
      return ipcResult(db.updateNote(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.NOTES_DELETE, (_, id: string) => {
    try {
      return ipcResult(db.deleteNote(id))
    } catch (err) {
      return ipcError(err)
    }
  })
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
  ipcMain.handle(IPC_CHANNELS.ANNOTATIONS_SAVE, (_, params: SaveAnnotationsParams) => {
    try {
      return ipcResult(annotations.saveAnnotations(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.ANNOTATIONS_DELETE, (_, captureId: string) => {
    try {
      annotations.deleteAnnotations(captureId)
      return ipcResult(undefined)
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.ANNOTATIONS_UPSERT_PIN, (_, params: UpsertAnnotationPinParams) => {
    try {
      return ipcResult(annotations.upsertPin(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.ANNOTATIONS_DELETE_PIN, (_, pinId: string) => {
    try {
      annotations.deletePin(pinId)
      return ipcResult(undefined)
    } catch (err) {
      return ipcError(err)
    }
  })

  // Extension
  ipcMain.handle(IPC_CHANNELS.EXTENSION_PATH, () => {
    try {
      if (!extensionPathExists()) {
        return { ok: false, error: 'Extension directory not found', code: 'EXT_NOT_FOUND' }
      }
      return ipcResult(getExtensionPath())
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.EXTENSION_OPEN_FOLDER, async () => {
    try {
      const extPath = getExtensionPath()
      if (!extensionPathExists()) {
        return { ok: false, error: 'Extension directory not found', code: 'EXT_NOT_FOUND' }
      }
      const openError = await shell.openPath(extPath)
      if (openError) {
        return { ok: false, error: openError, code: 'OPEN_PATH_FAILED' }
      }
      return ipcResult(undefined)
    } catch (err) {
      return ipcError(err)
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
  ipcMain.handle(IPC_CHANNELS.CAPTURES_TOGGLE_FAVORITE, (_, captureId: string) => {
    try {
      return ipcResult(db.toggleFavorite(captureId))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURES_IS_FAVORITE, (_, captureId: string) => {
    try {
      return ipcResult(db.isFavorite(captureId))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURES_LIST_FAVORITES, (_, caseId: string) => {
    try {
      return ipcResult(db.listFavorites(caseId))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURES_GET_MHTML_URL, (_, captureId: string) => {
    try {
      const capture = db.getCapture(captureId)
      if (!capture || !capture.mhtmlPath) return ipcResult<string | null>(null)
      const abs = join(storage.getStorageRoot(), capture.mhtmlPath)
      if (!existsSync(abs)) return ipcResult<string | null>(null)
      return ipcResult<string | null>(pathToFileURL(abs).toString())
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURES_VERIFY, async (_, captureId: string) => {
    try {
      const mod = await import('@main/services/mhtmlIngest')
      return ipcResult(await mod.verifyCapture(captureId))
    } catch (err) {
      return ipcError(err)
    }
  })

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
  ipcMain.handle(
    IPC_CHANNELS.EXPORT_GENERATE,
    async (_, caseId: string, options: ExportOptions) => {
      try {
        const { canceled, filePath } = await dialog.showSaveDialog({
          defaultPath: options.outputPath || 'report.html',
          filters: [{ name: 'HTML', extensions: ['html'] }]
        })
        if (canceled || !filePath) return ipcResult(undefined)
        await generateReport(caseId, { ...options, outputPath: filePath })
        return ipcResult(undefined)
      } catch (err) {
        return ipcError(err)
      }
    }
  )

  // AI Analysis
  ipcMain.handle(IPC_CHANNELS.AI_ANALYZE, async (_, params: AnalyzeCaptureParams) => {
    try {
      const currentSettings = settings.getSettings()
      const apiKey = currentSettings.openRouterApiKey
      if (!apiKey) throw new Error('No OpenRouter API key configured')
      const systemPrompt = currentSettings.analysisSystemPrompt?.trim()
        ? currentSettings.analysisSystemPrompt
        : DEFAULT_ANALYSIS_SYSTEM_PROMPT
      return ipcResult(
        await analysisService.analyzeCapture(
          params.captureId,
          params.caseId,
          params.model,
          apiKey,
          systemPrompt
        )
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message } as IpcResult<never>
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_SAVE_ANALYSIS, (_, analysis: CaptureAnalysis) => {
    try {
      analysisService.saveAnalysis(analysis)
      return ipcResult(undefined)
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_GET_ANALYSIS, (_, params: { captureId: string }) => {
    try {
      return ipcResult(analysisService.getAnalysis(params.captureId))
    } catch (err) {
      return ipcError(err)
    }
  })

  // Database Admin
  ipcMain.handle(IPC_CHANNELS.DB_STATS, () => {
    try {
      const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
      const dbPath = join(userDataPath, 'birdbrain.db')
      return ipcResult(dbAdmin.getDbStats(dbPath))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_TABLE_ROWS, (_, params: DbTableRowsParams) => {
    try {
      return ipcResult(dbAdmin.getTableRows(params))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_CREATE_ROW, (_, params: DbCreateRowParams) => {
    try {
      return ipcResult(dbAdmin.createRow(params.table, params.data))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_UPDATE_ROW, (_, params: DbUpdateRowParams) => {
    try {
      return ipcResult(dbAdmin.updateRow(params.table, params.pk, params.data))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_ROW, (_, params: DbRowIdentifier) => {
    try {
      return ipcResult(dbAdmin.deleteRow(params.table, params.pk))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_VACUUM, () => {
    try {
      const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
      const dbPath = join(userDataPath, 'birdbrain.db')
      return ipcResult(dbAdmin.vacuumDb(dbPath))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_REBUILD_FTS, () => {
    try {
      return ipcResult(dbAdmin.rebuildFts())
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_PURGE_ARCHIVED, () => {
    try {
      return ipcResult(dbAdmin.purgeArchived())
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_FIND_ORPHANS, () => {
    try {
      return ipcResult(dbAdmin.findOrphans())
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_CLEAN_ORPHANS, (_, report: OrphanReport) => {
    try {
      return ipcResult(dbAdmin.cleanOrphans(report))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_BACKUP, async () => {
    try {
      const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
      const dbPath = join(userDataPath, 'birdbrain.db')
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: 'birdbrain-backup.db',
        filters: [{ name: 'SQLite Database', extensions: ['db'] }]
      })
      if (canceled || !filePath) return ipcResult(null)
      dbAdmin.backupDatabase(dbPath, filePath)
      return ipcResult({ path: filePath })
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_RESTORE, async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        filters: [{ name: 'SQLite Database', extensions: ['db'] }],
        properties: ['openFile']
      })
      if (canceled || filePaths.length === 0) return ipcResult({ restored: false })

      const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
      const dbPath = join(userDataPath, 'birdbrain.db')
      const { closeDatabase, initDatabase } = await import('@main/services/database')
      const { copyFileSync } = await import('fs')

      closeDatabase()
      copyFileSync(filePaths[0], dbPath)
      initDatabase(dbPath)

      return ipcResult({ restored: true })
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_EXPORT_TABLE, async (_, params: DbExportTableParams) => {
    try {
      const content = dbAdmin.exportTableData(params.table, params.format)
      const ext = params.format === 'csv' ? 'csv' : 'json'
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: `${params.table}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
      })
      if (canceled || !filePath) return ipcResult(null)
      const { writeFileSync } = await import('fs')
      writeFileSync(filePath, content, 'utf-8')
      return ipcResult({ path: filePath })
    } catch (err) {
      return ipcError(err)
    }
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
  ipcMain.handle(IPC_CHANNELS.EXTRACTED_DATA_REPROCESS, async (_, caseId: string) => {
    try {
      const captures = db.listCaptures(caseId)
      // Yield to the event loop between captures so the main process stays
      // responsive. Await completion before returning, otherwise the renderer's
      // onSuccess invalidation races the inserts and caches an empty result.
      for (const cap of captures) {
        await new Promise<void>((resolve) => setImmediate(resolve))
        try {
          // Always clear first so legacy rows don't linger when a capture has
          // no readable source file anymore.
          db.deleteExtractedDataForCapture(cap.id)
          const html = readExtractionHtml(caseId, cap.id)
          if (html) {
            const extracted = extractData(html)
            db.insertExtractedData(cap.id, caseId, cap.url, extracted)
          }
        } catch (err) {
          console.error('Reprocess extraction error for capture', cap.id, err)
        }
      }
      return ipcResult({ processed: captures.length })
    } catch (err) {
      return ipcError(err)
    }
  })
}
