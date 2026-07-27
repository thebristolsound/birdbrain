import { app, BrowserWindow, dialog, shell } from 'electron'
import { join, resolve } from 'path'
import { is } from '@electron-toolkit/utils'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { initStorage } from '@main/services/storage'
import {
  startCaptureServer,
  stopCaptureServer,
  setMainWindow,
  startExtensionConnectionCheck,
  stopExtensionConnectionCheck
} from '@main/services/captureServer'
import { registerIpcHandlers } from '@main/ipcHandlers'
import { initSettings, getSettings } from '@main/services/settings'
import { initInstallationId, getInstallationId } from '@main/services/installationId'
import { initSigningKey } from '@main/services/signingKey'
import { initServerToken } from '@main/services/serverToken'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import { createTimestampWorker } from '@main/services/timestampWorker'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { createRecaptureService } from '@main/services/recapture'
import { createUpdaterService, type UpdaterService } from '@main/services/updater'
import { renderPageInHiddenWindow } from '@main/services/backgroundRenderer'
import { DEEP_LINK_SCHEME, parseDeepLink, findDeepLinkInArgv } from '@main/services/deepLink'
import {
  flushSync,
  initLogger,
  logger,
  disposeLogger,
  setMainWindow as setLoggerWindow
} from '@main/services/logger'
import { ident, tag } from '@main/services/logSafe'
import { detectInstallFormat } from '@main/services/diagnostics'
import { markCleanExit, startSession } from '@main/services/sessionLog'
import { IPC_CHANNELS, type DeepLinkTarget, type SelectorRematchedEvent } from '@shared/ipc'
import { sendEvent } from '@main/ipcWrap'

let mainWindow: BrowserWindow | null = null
// Deep link received before the renderer was ready (cold start); flushed once
// the window finishes loading.
let pendingNavigate: DeepLinkTarget | null = null
// Update-delivery service; disposed on quit.
let updaterService: UpdaterService | null = null

// Registered before whenReady so a failure during startup is still captured.
// logger.* is a no-op until initLogger runs, which is safe by construction.
process.on('uncaughtException', (err) => {
  logger.error('app', 'app.uncaught_exception', undefined, err)
  flushSync()
  dialog.showErrorBox(
    'Birdbrain encountered a fatal error',
    'The app must close. A diagnostic log has been saved — you can attach it to a bug report from Settings → Diagnostics after restarting.'
  )
  // app.exit, NOT app.quit — and this is load-bearing, not a style choice.
  // app.quit() emits 'before-quit', which calls markCleanExit() and deletes
  // session.lock. A fatal crash would then look identical to a normal quit on
  // the next launch and the recovery prompt would never appear. app.exit()
  // skips the lifecycle events, leaving the lock in place, which is exactly
  // the signal the next launch needs.
  app.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logger.error('app', 'app.unhandled_rejection', undefined, reason)
  flushSync()
})

app.on('render-process-gone', (_event, contents, details) => {
  // 'clean-exit' and 'killed' are ordinary shutdown paths. Classify BEFORE
  // logging, not after: Task 12b toasts every main-process error, so logging
  // these at error level would tell a tester "The window stopped responding"
  // during a normal quit. They are still recorded, at info, because knowing
  // the renderer went away is useful context around a nearby failure.
  const ordinary = details.reason === 'clean-exit' || details.reason === 'killed'
  const level = ordinary ? 'info' : 'error'
  logger[level]('app', 'app.render_process_gone', {
    reason: tag(details.reason, 'renderGoneReason'),
    exitCode: details.exitCode
  })
  flushSync()

  // Logging alone leaves the tester staring at a dead window until they
  // restart the app by hand.
  if (ordinary) return

  const win = BrowserWindow.fromWebContents(contents)
  if (!win || win.isDestroyed()) return

  const { response } = dialog.showMessageBoxSync
    ? {
        response: dialog.showMessageBoxSync(win, {
          type: 'error',
          buttons: ['Reload', 'Ignore'],
          defaultId: 0,
          title: 'Birdbrain stopped responding',
          message: 'The window crashed. Reloading recovers it — your captures are unaffected.'
        })
      }
    : { response: 1 }

  if (response === 0) win.reload()
})

app.on('child-process-gone', (_event, details) => {
  // tag(), NOT ident(): Electron's child-process type labels contain spaces
  // ('Pepper Plugin', 'Sandbox helper'), which ident() rejects — and a
  // rejection throws outside production, escalating a child-process failure
  // into a fatal main-process exception from inside the crash handler itself.
  logger.error('app', 'app.child_process_gone', {
    processType: tag(details.type, 'childProcessType'),
    reason: tag(details.reason, 'childGoneReason'),
    exitCode: details.exitCode
  })
  flushSync()
})

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Birdbrain',
    backgroundColor: '#000000',
    ...(process.platform === 'linux' || process.platform === 'win32'
      ? { icon: join(__dirname, '../../resources/icon.png') }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  mainWindow = win

  win.on('ready-to-show', () => {
    win.show()
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // Flush a deep link that arrived before the renderer was listening (cold start).
  win.webContents.on('did-finish-load', () => {
    if (pendingNavigate) {
      sendEvent(win.webContents, IPC_CHANNELS.DEEP_LINK_NAVIGATE, pendingNavigate)
      pendingNavigate = null
    }
  })

  win.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(details.url)
      }
    } catch {
      // ignore invalid URLs
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// Bring the existing window to the foreground (used when a deep link arrives).
function focusMainWindow(): void {
  const win = mainWindow ?? BrowserWindow.getAllWindows()[0] ?? null
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// Focus the app and route the renderer in response to a birdbrain:// URL.
function dispatchDeepLink(url: string | null): void {
  if (!url) return
  const target = parseDeepLink(url)
  focusMainWindow()
  if (!target) return
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    sendEvent(mainWindow.webContents, IPC_CHANNELS.DEEP_LINK_NAVIGATE, target)
  } else {
    pendingNavigate = target
  }
}

function registerProtocolClient(): void {
  if (process.defaultApp) {
    // electron-vite dev: register the electron binary plus the entry script so
    // the OS relaunches the right target.
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [resolve(process.argv[1])])
    }
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
  }
}

// Enforce security on all web contents (defense-in-depth for webviews)
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'webview') {
    // Allow the initial file:// load, block all subsequent navigations
    let initialLoadDone = false
    contents.on('will-navigate', (event, url) => {
      if (!initialLoadDone && url.startsWith('file://')) {
        initialLoadDone = true
        return
      }
      event.preventDefault()
    })
  }
})

// A single-instance lock is required so a deep link launched while the app is
// already running routes into this process (via second-instance) instead of
// spawning a second window.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  registerProtocolClient()

  // Windows/Linux: the second launch hands its argv to the primary instance.
  app.on('second-instance', (_event, argv) => {
    dispatchDeepLink(findDeepLinkInArgv(argv))
  })

  // macOS delivers deep links through open-url, whether or not the app is running.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    dispatchDeepLink(url)
  })

  app
    .whenReady()
    .then(async () => {
      // Initialize database
      const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')

      // Logger init must run before anything else in this block that can
      // throw during startup — otherwise the startup crash the feature exists
      // to capture is the one case it cannot capture. initInstallationId does
      // uncaught synchronous fs reads/writes under userData; if that throws
      // before the logger exists, the uncaughtException handler shows a
      // dialog claiming a diagnostic log was saved while logger is still the
      // no-op singleton and nothing was written.
      //
      // detectInstallFormat, not process.platform: SessionRecord promises the
      // package format, and on Linux the AppImage/deb/archive distinction is
      // exactly what a crash report needs. Export the existing helper from
      // diagnostics.ts rather than reimplementing it — it already reads the
      // APPIMAGE env var and the electron-builder package-type marker.
      const session = startSession(join(userDataPath, 'logs'), {
        version: app.getVersion(),
        platform: process.platform,
        installFormat: detectInstallFormat(app.isPackaged)
      })
      initLogger(userDataPath, session.sessionId)
      // A Phase 1 tester sends only birdbrain.log via Reveal, so this entry is
      // the ONLY place installation, platform and package format are recorded.
      // Without them a standalone log cannot correlate repeat reports to one
      // installation or distinguish appimage/deb/nsis failures.
      logger.info('app', 'app.session_start', {
        version: ident(app.getVersion().replace(/\./g, '-')),
        platform: tag(process.platform, 'platform'),
        installFormat: tag(session.installFormat, 'installFormat'),
        packaged: app.isPackaged
      })

      initDatabase(join(userDataPath, 'birdbrain.db'))
      initSettings(userDataPath)
      initInstallationId(userDataPath)
      // Splitting this into a second entry is the cost of initialising the
      // logger first — the alternative is initialising the installation id
      // first and losing crash capture for the window in which it runs. A bug
      // report reads both lines from the same sessionId, so nothing is lost
      // analytically.
      logger.info('app', 'app.installation_id', { installationId: ident(getInstallationId()) })
      initSigningKey(userDataPath)
      initServerToken(userDataPath)

      // Use storagePath from settings, fall back to default if empty or unwritable
      const settings = getSettings()
      const defaultCapturesDir = join(userDataPath, 'captures')
      const capturesDir = settings.storagePath || defaultCapturesDir
      try {
        initStorage(capturesDir)
      } catch (err) {
        logger.warn('app', 'app.storage_init_failed', undefined, err)
        initStorage(defaultCapturesDir)
      }

      // Build the Selector Lifecycle. Its emitter broadcasts rematched events
      // to every renderer; injecting via factory keeps Electron out of the
      // lifecycle module and lets tests pass a recording fake.
      const selectorLifecycle = createSelectorLifecycle({
        emitRematched: (event: SelectorRematchedEvent) => {
          for (const win of BrowserWindow.getAllWindows()) {
            sendEvent(win.webContents, IPC_CHANNELS.SELECTOR_REMATCHED, event)
          }
        }
      })

      // Trusted-timestamp worker (#120). Stamps captures out-of-band so the capture
      // path never blocks on the TSA; rebuilds the mirror + retries pending on start.
      const timestampWorker = createTimestampWorker()
      timestampWorker.start()

      const captureLifecycle = createCaptureLifecycle({
        selectorLifecycle,
        enqueueTimestamp: (captureId) => timestampWorker.enqueue(captureId)
      })

      // Background recapture queue (#recapture). Renders pages in a hidden window
      // and reuses the capture pipeline's observability events, mirroring how the
      // capture server broadcasts to the (lazily created) main window.
      const recaptureService = createRecaptureService({
        renderPage: renderPageInHiddenWindow,
        captureLifecycle,
        emitEvent: (event) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            sendEvent(mainWindow.webContents, IPC_CHANNELS.CAPTURE_ACTIVITY, event)
          }
        },
        emitNewCapture: (capture) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            sendEvent(mainWindow.webContents, IPC_CHANNELS.NEW_CAPTURE, capture)
          }
        }
      })

      // Update-delivery service (notify/check-only). Broadcasts status transitions
      // to the renderer; reads the release channel + auto-check policy from settings.
      updaterService = createUpdaterService({
        emit: (updateStatus) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            sendEvent(mainWindow.webContents, IPC_CHANNELS.UPDATE_STATUS, updateStatus)
          }
        },
        getChannel: () => getSettings().releaseChannel,
        isAutoCheckEnabled: () => getSettings().autoCheckForUpdates
      })

      // Register IPC handlers
      registerIpcHandlers({ selectorLifecycle, captureLifecycle, recaptureService, updaterService })

      // Start capture server and extension connection monitor
      await startCaptureServer({ selectorLifecycle, captureLifecycle })
      startExtensionConnectionCheck()

      // Create window and connect to capture server
      const win = createWindow()
      setMainWindow(win)
      setLoggerWindow(win)

      // Arm the updater once the window exists so status events have a target.
      updaterService.start()

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          const next = createWindow()
          setMainWindow(next)
          setLoggerWindow(next)
        }
      })

      // Windows/Linux cold start: the deep link is in this process's argv.
      if (process.platform !== 'darwin') {
        dispatchDeepLink(findDeepLinkInArgv(process.argv))
      }
    })
    .catch((err) => {
      // Startup failures are fatal by definition — there is no window to recover
      // into. Log, tell the tester where the log is, and exit rather than linger
      // holding the single-instance lock with nothing on screen.
      logger.error('app', 'app.startup_failed', undefined, err)
      flushSync()
      dialog.showErrorBox(
        'Birdbrain could not start',
        'A diagnostic log has been saved. You can attach it to a bug report — see the logs folder in your Birdbrain data directory.'
      )
      // Same reasoning as the uncaughtException handler above: exit, not quit,
      // so before-quit does not clear the lock on a startup crash.
      app.exit(1)
    })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', async () => {
    // markCleanExit MUST run first and synchronously. Electron does not await
    // an async before-quit listener, so anything sequenced after `await
    // stopCaptureServer()` may never run — which would leave session.lock in
    // place and make every ordinary quit look like a crash on next launch.
    markCleanExit(join(process.env.BIRDBRAIN_USER_DATA || app.getPath('userData'), 'logs'))
    disposeLogger()

    stopExtensionConnectionCheck()
    updaterService?.dispose()
    await stopCaptureServer()
    closeDatabase()
  })
}
