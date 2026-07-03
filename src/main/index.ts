import { app, BrowserWindow, shell } from 'electron'
import { join, resolve } from 'path'
import { is } from '@electron-toolkit/utils'
import { initDatabase, closeDatabase } from '@main/services/database'
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
import { initInstallationId } from '@main/services/installationId'
import { initSigningKey } from '@main/services/signingKey'
import { initServerToken } from '@main/services/serverToken'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import { createTimestampWorker } from '@main/services/timestampWorker'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { DEEP_LINK_SCHEME, parseDeepLink, findDeepLinkInArgv } from '@main/services/deepLink'
import { IPC_CHANNELS, type DeepLinkTarget, type SelectorRematchedEvent } from '@shared/ipc'

let mainWindow: BrowserWindow | null = null
// Deep link received before the renderer was ready (cold start); flushed once
// the window finishes loading.
let pendingNavigate: DeepLinkTarget | null = null

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
      win.webContents.send(IPC_CHANNELS.DEEP_LINK_NAVIGATE, pendingNavigate)
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
    mainWindow.webContents.send(IPC_CHANNELS.DEEP_LINK_NAVIGATE, target)
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

// Deny renderer permission requests (geolocation, media, notifications, ...)
// on every session, including webview partitions. The only capability the app
// uses is sanitized clipboard writes (copy-to-clipboard in the analysis tab).
app.on('session-created', (ses) => {
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write')
  })
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write')
})

// Enforce security on all web contents (defense-in-depth for webviews)
app.on('web-contents-created', (_event, contents) => {
  // Main-process backstop for any <webview> the renderer attaches: strip
  // dangerous prefs and reject anything that isn't a local file:// document.
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    if (typeof params.src !== 'string' || !params.src.startsWith('file://')) {
      event.preventDefault()
    }
  })

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
    focusMainWindow()
    dispatchDeepLink(findDeepLinkInArgv(argv))
  })

  // macOS delivers deep links through open-url, whether or not the app is running.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    dispatchDeepLink(url)
  })

  app.whenReady().then(async () => {
    // Initialize database
    const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
    initDatabase(join(userDataPath, 'birdbrain.db'))
    initSettings(userDataPath)
    initInstallationId(userDataPath)
    initSigningKey(userDataPath)
    initServerToken(userDataPath)

    // Use storagePath from settings, fall back to default if empty or unwritable
    const settings = getSettings()
    const defaultCapturesDir = join(userDataPath, 'captures')
    const capturesDir = settings.storagePath || defaultCapturesDir
    try {
      initStorage(capturesDir)
    } catch (err) {
      console.warn(
        `Failed to initialize storage at "${capturesDir}", falling back to default:`,
        err
      )
      initStorage(defaultCapturesDir)
    }

    // Build the Selector Lifecycle. Its emitter broadcasts rematched events
    // to every renderer; injecting via factory keeps Electron out of the
    // lifecycle module and lets tests pass a recording fake.
    const selectorLifecycle = createSelectorLifecycle({
      emitRematched: (event: SelectorRematchedEvent) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC_CHANNELS.SELECTOR_REMATCHED, event)
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

    // Register IPC handlers
    registerIpcHandlers({ selectorLifecycle, captureLifecycle })

    // Start capture server and extension connection monitor
    await startCaptureServer({ selectorLifecycle, captureLifecycle })
    startExtensionConnectionCheck()

    // Create window and connect to capture server
    const win = createWindow()
    setMainWindow(win)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        setMainWindow(createWindow())
      }
    })

    // Windows/Linux cold start: the deep link is in this process's argv.
    if (process.platform !== 'darwin') {
      dispatchDeepLink(findDeepLinkInArgv(process.argv))
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', async () => {
    stopExtensionConnectionCheck()
    await stopCaptureServer()
    closeDatabase()
  })
}
