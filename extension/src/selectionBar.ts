// The in-page selection bar (#393): selecting text raises Selector / Tag /
// Quote, styled after the standalone mock's extension bar (template
// 12306-12321). Actions are disabled unless the app is connected with an
// active Case; Tag and Quote ride the auto-capture-then-attach endpoints
// (#392) via the background relay — the content script never fetches.
//
// The bar is injected in-page UI raised by a page gesture, so it participates
// in the capture suppression protocol on both sides (#386): it registers a
// teardown so every strip removes it, and it consults the page-side latch
// before every injection so a mouseup that fires mid-capture cannot put it
// back between the strip and the frames. The host id is mirrored by hand in
// captureHygiene.ts's removeInjectedBirdbrainUi.

import {
  isCaptureUiSuppressed,
  onCaptureUiSuppressionReleased,
  registerCaptureUiTeardown
} from './captureSuppression'
import { isActionableSelection, normalizeSelection } from '@shared/selectionKind'
import type { SelectionActionKind, SelectionActionResponse, SelectionBarState } from './messages'

export const SELECTION_BAR_ID = 'birdbrain-selection-bar'

const SUCCESS_HIDE_MS = 2500
const ERROR_HIDE_MS = 6000
const BAR_HEIGHT = 28
const BAR_GAP = 8

type BarState =
  | { phase: 'hidden' }
  | { phase: 'ready'; text: string; x: number; y: number; enabled: boolean; reason: string }
  | { phase: 'busy'; text: string; x: number; y: number; action: SelectionActionKind }
  | { phase: 'done'; x: number; y: number; ok: boolean; message: string }

let state: BarState = { phase: 'hidden' }
let hideTimeout: ReturnType<typeof setTimeout> | null = null

// Colors match toast.ts's palette rather than the mock's CSS variables: the
// app's theme tokens do not exist on arbitrary pages.
const BAR_STYLES = `
  :host {
    all: initial;
  }
  .bar {
    display: flex;
    height: ${BAR_HEIGHT}px;
    align-items: center;
    overflow: hidden;
    white-space: nowrap;
    border-radius: 6px;
    border: 1px solid #3f3f46;
    background: #131316;
    box-shadow: 0 10px 30px rgba(0,0,0,0.4);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: rise 0.12s ease-out;
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  button {
    display: flex;
    height: 100%;
    align-items: center;
    gap: 6px;
    border: none;
    background: transparent;
    padding: 0 11px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    color: #a1a1aa;
    cursor: pointer;
  }
  button + button {
    border-left: 1px solid #27272a;
  }
  button:hover:enabled {
    background: rgba(255,255,255,0.06);
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  button.primary {
    font-weight: 600;
    color: #818cf8;
  }
  .status {
    display: flex;
    height: 100%;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    font-size: 12px;
    color: #fafafa;
  }
  .status.error {
    color: #f87171;
  }
  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255,255,255,0.2);
    border-top-color: #6467f2;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .icon {
    font-size: 12px;
  }
  .icon.ok {
    color: #34d399;
  }
`

function clearHideTimeout(): void {
  if (hideTimeout) {
    clearTimeout(hideTimeout)
    hideTimeout = null
  }
}

function hide(): void {
  clearHideTimeout()
  state = { phase: 'hidden' }
  render()
}

function scheduleHide(ms: number): void {
  clearHideTimeout()
  hideTimeout = setTimeout(hide, ms)
}

function removeHost(): void {
  document.getElementById(SELECTION_BAR_ID)?.remove()
}

function barMarkup(current: BarState): string {
  if (current.phase === 'ready') {
    const disabled = current.enabled ? '' : 'disabled'
    return `
      <div class="bar">
        <button class="primary" data-action="selector" ${disabled}>Selector</button>
        <button data-action="tag" ${disabled}>Tag</button>
        <button data-action="quote" ${disabled}>Quote</button>
      </div>
    `
  }
  if (current.phase === 'busy') {
    return `
      <div class="bar">
        <div class="status"><div class="spinner"></div><span class="message"></span></div>
      </div>
    `
  }
  if (current.phase === 'done') {
    const statusClass = current.ok ? '' : 'error'
    const icon = current.ok
      ? '<span class="icon ok">&#10003;</span>'
      : '<span class="icon">&#10007;</span>'
    return `
      <div class="bar">
        <div class="status ${statusClass}">${icon}<span class="message"></span></div>
      </div>
    `
  }
  return ''
}

function statusMessage(current: BarState): string {
  if (current.phase === 'busy') {
    return current.action === 'selector'
      ? 'Creating selector...'
      : current.action === 'tag'
        ? 'Tagging page...'
        : 'Saving quote...'
  }
  return current.phase === 'done' ? current.message : ''
}

/**
 * The single injection choke point: every state change routes through here,
 * and it re-checks the suppression latch so no path can put the bar on a page
 * that is inside a capture bracket.
 */
function render(): void {
  if (state.phase === 'hidden' || isCaptureUiSuppressed()) {
    removeHost()
    return
  }

  let host = document.getElementById(SELECTION_BAR_ID)
  if (!host) {
    host = document.createElement('div')
    host.id = SELECTION_BAR_ID
    host.attachShadow({ mode: 'open' })
    document.body.appendChild(host)
  }
  host.style.cssText = `position:absolute;left:${state.x}px;top:${state.y}px;z-index:2147483647;`

  const shadow = host.shadowRoot
  if (!shadow) return
  shadow.innerHTML = `<style>${BAR_STYLES}</style>${barMarkup(state)}`

  // Operator-facing strings go in via textContent: `message` comes back from
  // the background verbatim and may quote server or page-derived text.
  const messageEl = shadow.querySelector('.message')
  if (messageEl) messageEl.textContent = statusMessage(state)

  if (state.phase === 'ready') {
    shadow.querySelectorAll('button').forEach((button) => {
      if (state.phase === 'ready' && !state.enabled) button.title = state.reason
      // Keep the page selection: a mousedown on the bar must not collapse it.
      button.addEventListener('mousedown', (e) => e.preventDefault())
      button.addEventListener('click', () => {
        const action = button.dataset.action as SelectionActionKind | undefined
        if (action) void runAction(action)
      })
    })
  }
}

async function queryBarState(): Promise<SelectionBarState | null> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: 'GET_STATE' })) as
      { connected?: boolean; activeCaseId?: string | null } | undefined
    if (!response || typeof response !== 'object') return null
    return { connected: response.connected === true, activeCaseId: response.activeCaseId ?? null }
  } catch {
    // No receiving end: this content script is orphaned (extension reloaded)
    // and can never be told a capture bracket opened, so it must not inject.
    return null
  }
}

function barPosition(rect: DOMRect): { x: number; y: number } {
  const above = rect.top + window.scrollY - BAR_HEIGHT - BAR_GAP
  const y = above >= window.scrollY ? above : rect.bottom + window.scrollY + BAR_GAP
  const x = Math.max(
    window.scrollX,
    Math.min(rect.left + window.scrollX, window.scrollX + window.innerWidth - 220)
  )
  return { x, y }
}

// A function rather than an inline comparison: `state` is reassigned by a
// concurrently running action while showFromSelection awaits, which TS's
// narrowing of the module variable cannot see.
function isBusy(): boolean {
  return state.phase === 'busy'
}

async function showFromSelection(): Promise<void> {
  // A settled action stays visible until dismissed or timed out; a busy one
  // must never be replaced mid-flight.
  if (isBusy()) return

  const selection = window.getSelection()
  const raw = selection ? selection.toString() : ''
  if (
    !selection ||
    selection.rangeCount === 0 ||
    selection.isCollapsed ||
    !isActionableSelection(raw)
  ) {
    if (state.phase === 'ready') hide()
    return
  }
  if (isCaptureUiSuppressed()) return

  const rect = selection.getRangeAt(0).getBoundingClientRect()
  const barState = await queryBarState()
  // Fail closed on an unreachable worker: no bar at all, not a disabled one.
  if (barState === null) return
  // Re-check after the await: a capture bracket may have opened meanwhile.
  if (isCaptureUiSuppressed()) return
  if (isBusy()) return

  const enabled = barState.connected && barState.activeCaseId !== null
  const { x, y } = barPosition(rect)
  clearHideTimeout()
  state = {
    phase: 'ready',
    text: normalizeSelection(raw),
    x,
    y,
    enabled,
    reason: barState.connected
      ? enabled
        ? ''
        : 'Select an active case in Birdbrain first'
      : 'Birdbrain is not running'
  }
  render()
}

async function runAction(action: SelectionActionKind): Promise<void> {
  if (state.phase !== 'ready' || !state.enabled) return
  const { text, x, y } = state
  state = { phase: 'busy', text, x, y, action }
  render()

  let response: SelectionActionResponse
  try {
    response = (await chrome.runtime.sendMessage({
      type: 'SELECTION_ACTION',
      action,
      text
    })) as SelectionActionResponse
  } catch {
    response = { ok: false, error: "Can't reach the Birdbrain extension" }
  }
  if (!response || typeof response.ok !== 'boolean') {
    response = { ok: false, error: 'No response from the extension' }
  }

  state = {
    phase: 'done',
    x,
    y,
    ok: response.ok,
    message: response.ok ? response.detail : response.error
  }
  render()
  scheduleHide(response.ok ? SUCCESS_HIDE_MS : ERROR_HIDE_MS)
}

function onMouseUp(event: MouseEvent): void {
  // Clicks on the bar itself are handled by its own buttons.
  if (event.composedPath().some((t) => t instanceof HTMLElement && t.id === SELECTION_BAR_ID)) {
    return
  }
  // Let the browser settle the selection this mouseup produced first.
  setTimeout(() => {
    void showFromSelection()
  }, 0)
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && state.phase !== 'hidden' && state.phase !== 'busy') hide()
}

/**
 * Strips the bar for a capture but keeps its state: what the operator saw —
 * a raised bar, or an in-flight action's progress — comes back on release.
 */
function teardownForCapture(): void {
  clearHideTimeout()
  removeHost()
}

export function initSelectionBar(): void {
  document.addEventListener('mouseup', onMouseUp)
  document.addEventListener('keydown', onKeyDown)
  registerCaptureUiTeardown(teardownForCapture)
  // The restore half of the round trip (#386): once the background says no
  // capture on the tab is collecting frames, put back what was stripped —
  // including after a failed capture, whose restore path also releases.
  onCaptureUiSuppressionReleased(() => {
    if (state.phase !== 'hidden') render()
  })
}
