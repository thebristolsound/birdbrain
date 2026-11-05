// The CDP commands the launched-browser engine may send, and the events it reads. Ruling 38b
// keeps `devtools-protocol` out, so these types are written by hand from the protocol
// description Chrome for Testing 149.0.7827.55 serves, and carry only the fields the engine
// sends or reads.
//
// The list holds no command that returns cookie values and no
// `Emulation.setAutomationOverride` (spec, "The CDP client"), no
// `Network.configureDurableMessages` (2026-10-17 ruling), and no `Runtime.enable`,
// `Log.enable`, `Performance.enable` or `Debugger.enable` (spec, "Attach before request").
// The client throws on any method not listed here. Clicked Captures (#1832) add the recording
// setup (`Network.setCacheDisabled`, decision D6; `Page.enable`, the maintainer's P3 ruling of
// 2026-11-05), the body fetch, and the artifact commands. No command that reads a request body
// (`Network.getRequestPostData`) is listed: a launched record holds none (ADR-0051).

export interface TargetInfo {
  targetId: string
  type: string
  title: string
  url: string
  attached: boolean
  openerId?: string
  parentId?: string
  browserContextId?: string
  subtype?: string
}

export interface TargetFilterEntry {
  exclude?: boolean
  type?: string
}

export interface RemoteObject {
  type: 'object' | 'function' | 'undefined' | 'string' | 'number' | 'boolean' | 'symbol' | 'bigint'
  subtype?: string
  value?: unknown
  description?: string
}

export interface ExceptionDetails {
  exceptionId: number
  text: string
  lineNumber: number
  columnNumber: number
  exception?: RemoteObject
}

export interface NetworkResponse {
  url: string
  status: number
  remoteIPAddress?: string
  remotePort?: number
  fromDiskCache?: boolean
  fromServiceWorker?: boolean
  fromPrefetchCache?: boolean
}

export interface FrameInfo {
  id: string
  parentId?: string
  loaderId: string
  url: string
  urlFragment?: string
}

export interface Viewport {
  x: number
  y: number
  width: number
  height: number
  scale: number
}

type NoParams = Record<string, never>
type NoResult = Record<string, never>

export interface CdpCommandMap {
  'Browser.getVersion': {
    params: NoParams
    result: {
      protocolVersion: string
      product: string
      revision: string
      userAgent: string
      jsVersion: string
    }
  }
  'Browser.close': { params: NoParams; result: NoResult }
  'Browser.setPermission': {
    params: {
      permission: { name: string }
      setting: 'granted' | 'denied' | 'prompt'
      origin?: string
      browserContextId?: string
    }
    result: NoResult
  }
  'Target.setDiscoverTargets': {
    params: { discover: boolean; filter?: TargetFilterEntry[] }
    result: NoResult
  }
  // The panel's tab list: the browser reports a title only with a navigation, before the page
  // sets one, so the list is read again.
  'Target.getTargets': {
    params: { filter?: TargetFilterEntry[] }
    result: { targetInfos: TargetInfo[] }
  }
  // `flatten` is fixed to true: the client routes sessions by `sessionId` and has no
  // `Target.sendMessageToTarget` path.
  'Target.setAutoAttach': {
    params: {
      autoAttach: boolean
      waitForDebuggerOnStart: boolean
      flatten: true
      filter?: TargetFilterEntry[]
    }
    result: NoResult
  }
  'Runtime.runIfWaitingForDebugger': { params: NoParams; result: NoResult }
  'Network.enable': {
    params: {
      maxTotalBufferSize?: number
      maxResourceBufferSize?: number
      maxPostDataSize?: number
    }
    result: NoResult
  }
  'Page.createIsolatedWorld': {
    params: { frameId: string; worldName?: string }
    result: { executionContextId: number }
  }
  'Runtime.evaluate': {
    params: {
      expression: string
      contextId?: number
      returnByValue?: boolean
      awaitPromise?: boolean
    }
    result: { result: RemoteObject; exceptionDetails?: ExceptionDetails }
  }
  'Network.setCacheDisabled': { params: { cacheDisabled: boolean }; result: NoResult }
  'Network.getResponseBody': {
    params: { requestId: string }
    result: { body: string; base64Encoded: boolean }
  }
  // For `Page.frameNavigated`, the commit signal of a main-frame document (spec, "From a
  // session-long recording", step 2).
  'Page.enable': { params: NoParams; result: NoResult }
  'Page.getFrameTree': {
    params: NoParams
    result: { frameTree: { frame: FrameInfo } }
  }
  'Page.getLayoutMetrics': {
    params: NoParams
    result: {
      cssContentSize?: { x: number; y: number; width: number; height: number }
      cssLayoutViewport?: { clientWidth: number; clientHeight: number }
    }
  }
  'Page.captureScreenshot': {
    params: {
      format: 'png'
      captureBeyondViewport: boolean
      fromSurface?: boolean
      clip?: Viewport
    }
    result: { data: string }
  }
  'Page.captureSnapshot': { params: { format: 'mhtml' }; result: { data: string } }
  'Page.printToPDF': {
    params: { printBackground?: boolean; transferMode?: 'ReturnAsBase64' }
    result: { data: string }
  }
}

export type CdpMethod = keyof CdpCommandMap
export type CdpParams<M extends CdpMethod> = CdpCommandMap[M]['params']
export type CdpResult<M extends CdpMethod> = CdpCommandMap[M]['result']

export const LAUNCHED_BROWSER_COMMANDS = [
  'Browser.getVersion',
  'Browser.close',
  'Browser.setPermission',
  'Target.setDiscoverTargets',
  'Target.getTargets',
  'Target.setAutoAttach',
  'Runtime.runIfWaitingForDebugger',
  'Network.enable',
  'Page.createIsolatedWorld',
  'Runtime.evaluate',
  'Network.setCacheDisabled',
  'Network.getResponseBody',
  'Page.enable',
  'Page.getFrameTree',
  'Page.getLayoutMetrics',
  'Page.captureScreenshot',
  'Page.captureSnapshot',
  'Page.printToPDF'
] as const satisfies readonly CdpMethod[]

// Parameters the client refuses on a listed command, for a caller that gets past the types.
export const REFUSED_PARAMS: Partial<Record<CdpMethod, readonly string[]>> = {
  'Network.enable': ['enableDurableMessages']
}

interface TypedEvents {
  'Target.attachedToTarget': {
    sessionId: string
    targetInfo: TargetInfo
    waitingForDebugger: boolean
  }
  'Target.detachedFromTarget': { sessionId: string }
  'Target.targetCreated': { targetInfo: TargetInfo }
  'Target.targetInfoChanged': { targetInfo: TargetInfo }
  'Target.targetDestroyed': { targetId: string }
  'Network.responseReceived': {
    requestId: string
    loaderId: string
    timestamp: number
    type: string
    response: NetworkResponse
    frameId?: string
  }
  // A tab's renderer crashed; the target stays until it loads again or closes.
  'Target.targetCrashed': { targetId: string; status: string; errorCode: number }
  // `type` is `BackForwardCacheRestore` for a page the back-forward cache restored.
  'Page.frameNavigated': { frame: FrameInfo; type?: string }
  // A same-document navigation (the history API, a fragment change), with the frame's new URL.
  'Page.navigatedWithinDocument': { frameId: string; url: string }
}

// The `Network` events a tab's recording reads (spec, "From a session-long recording", step 4).
// Each arrives with fields the recording replaces or removes before it holds the event, so they
// are typed at the recording, not here.
export const RECORDED_NETWORK_EVENTS = [
  'Network.requestWillBeSent',
  'Network.requestWillBeSentExtraInfo',
  'Network.responseReceived',
  'Network.responseReceivedExtraInfo',
  'Network.responseReceivedEarlyHints',
  'Network.requestServedFromCache',
  'Network.dataReceived',
  'Network.loadingFinished',
  'Network.loadingFailed',
  'Network.webSocketCreated',
  'Network.webSocketWillSendHandshakeRequest',
  'Network.webSocketHandshakeResponseReceived',
  'Network.signedExchangeReceived'
] as const

export type RecordedNetworkEvent = (typeof RECORDED_NETWORK_EVENTS)[number]

// Every other recorded `Network` event reaches its handler untyped, as the protocol sent it.
export type CdpEventMap = TypedEvents & {
  [E in Exclude<RecordedNetworkEvent, keyof TypedEvents>]: Record<string, unknown>
}

export type CdpEventName = keyof CdpEventMap
