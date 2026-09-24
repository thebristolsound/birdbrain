import { isCaptureUiSuppressed, registerCaptureUiTeardown } from './captureSuppression'
import type { CaptureCardDetails } from '@shared/schemas'

const TOAST_ID = 'birdbrain-capture-toast'

interface ToastOptions {
  status: 'capturing' | 'success' | 'degraded' | 'error' | 'skipped'
  message?: string
  card?: CaptureCardDetails
  scrolling?: boolean
}

let removeTimeout: ReturnType<typeof setTimeout> | null = null

function getOrCreateHost(): ShadowRoot {
  let host = document.getElementById(TOAST_ID)
  if (host?.shadowRoot) return host.shadowRoot

  host = document.createElement('div')
  host.id = TOAST_ID
  const shadow = host.attachShadow({ mode: 'open' })
  document.body.appendChild(host)
  return shadow
}

const TOAST_STYLES = `
  :host {
    all: initial;
  }
  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    line-height: 1;
    color: #fafafa;
    background: #131316;
    border: 1px solid #27272a;
    box-shadow: 0 10px 30px rgba(0,0,0,0.4);
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 0.2s, transform 0.2s;
  }
  .toast.visible {
    opacity: 1;
    transform: translateY(0);
  }
  .toast.success {
    border-color: rgba(34, 197, 94, 0.4);
  }
  .toast.error {
    border-color: rgba(239, 68, 68, 0.4);
  }
  .toast.degraded {
    border-color: rgba(251, 191, 36, 0.4);
  }
  .toast.skipped {
    border-color: rgba(148, 163, 184, 0.4);
  }
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255,255,255,0.2);
    border-top-color: #6467f2;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .icon {
    font-size: 14px;
  }
`

export function showToast(options: ToastOptions): void {
  const shadow = getOrCreateHost()

  const icon =
    options.status === 'capturing'
      ? '<div class="spinner"></div>'
      : options.status === 'success'
        ? '<span class="icon">&#10003;</span>'
        : options.status === 'degraded'
          ? '<span class="icon">&#9888;</span>'
          : options.status === 'skipped'
            ? '<span class="icon">&#8505;</span>'
            : '<span class="icon">&#10007;</span>'

  const message =
    options.message ??
    (options.status === 'capturing'
      ? 'Capturing page...'
      : options.status === 'success'
        ? 'Page captured'
        : options.status === 'degraded'
          ? 'Captured (basic snapshot)'
          : options.status === 'skipped'
            ? 'Already captured'
            : 'Capture failed')

  const statusClass = options.status === 'capturing' ? '' : options.status

  shadow.innerHTML = `
    <style>${TOAST_STYLES}</style>
    <div class="toast ${statusClass}">
      ${icon}
      <span class="message"></span>
    </div>
  `

  // Set message via textContent to prevent DOM XSS
  const messageEl = shadow.querySelector('.message') as HTMLSpanElement | null
  if (messageEl) {
    messageEl.textContent = message
  }

  requestAnimationFrame(() => {
    const toast = shadow.querySelector('.toast') as HTMLElement
    toast?.classList.add('visible')
  })
}

export function updateToast(options: ToastOptions): void {
  if (removeTimeout) {
    clearTimeout(removeTimeout)
    removeTimeout = null
  }

  if (options.card) {
    showCaptureCard(options.card, options.scrolling ?? false, options.message)
    return
  }
  showToast(options)

  const dismissMs =
    options.status === 'success'
      ? 3000
      : options.status === 'degraded'
        ? 5000
        : options.status === 'skipped'
          ? 2000
          : options.status === 'error'
            ? 5000
            : 0

  if (dismissMs > 0) {
    removeTimeout = setTimeout(removeToast, dismissMs)
  }
}

// Capture hygiene (#379): the animated removeToast leaves the host in the DOM
// for its 200ms fade, long enough to be serialised into an MHTML snapshot or
// screenshot taken right after — capture paths need the host gone synchronously.
function removeToastImmediately(): void {
  if (removeTimeout) {
    clearTimeout(removeTimeout)
    removeTimeout = null
  }
  document.getElementById(TOAST_ID)?.remove()
}

// The toast is in-page UI, so it tears itself down on the capture-suppression
// boundary (#386) rather than relying on each capture path to remember it.
registerCaptureUiTeardown(removeToastImmediately)

export function removeToast(): void {
  removeTimeout = null
  const host = document.getElementById(TOAST_ID)
  if (!host?.shadowRoot) return

  const toast = host.shadowRoot.querySelector('.toast') as HTMLElement
  if (toast) {
    toast.classList.remove('visible')
    setTimeout(() => host.remove(), 200)
  }
}

// Text from pages, cases and tags is assigned through textContent, never markup.
function showCaptureCard(card: CaptureCardDetails, scrolling: boolean, warning?: string): void {
  if (isCaptureUiSuppressed()) return
  const shadow = getOrCreateHost()
  shadow.innerHTML = `
    <style>${TOAST_STYLES}
      .card { display: block; box-sizing: border-box; width: 296px; max-width: calc(100vw - 32px); padding: 0;
        bottom: 16px; right: 16px; border-radius: 6px; overflow: hidden; line-height: 1.5; }
      .heading { display: flex; align-items: center; gap: 8px; padding: 10px 12px 0; font-size: 12px; font-weight: 600; }
      .check { display: inline-flex; align-items: center; justify-content: center; width: 16px;
        height: 16px; flex-shrink: 0; border-radius: 50%; background: #10b98124; color: #34d399; }
      .heading-text { min-width: 0; flex: 1; overflow-wrap: anywhere; }
      button { font: inherit; cursor: pointer; color: #a1a1aa; background: transparent;
        border: 1px solid #3f3f46; border-radius: 4px; }
      button:hover { background: #27272a; }
      button:focus-visible { outline: 2px solid #818cf8; outline-offset: 1px; }
      button:disabled { opacity: .5; cursor: wait; }
      .dismiss { width: 20px; height: 20px; border: 0; padding: 0; }
      .title { margin: 6px 12px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: #a1a1aa; }
      .facts, .warning, .error { margin: 3px 12px 0; font-size: 10px; color: #71717a; }
      .warning, .error { color: #fbbf24; }
      .tags { margin: 9px 12px 0; display: flex; flex-wrap: wrap; gap: 5px; }
      .tag { display: inline-flex; align-items: center; gap: 5px; border-radius: 9999px;
        padding: 2px 9px; font-size: 10px; font-weight: 500; }
      .tag[aria-pressed=true] { color: #fafafa; background: #27272a; }
      .dot { width: 5px; height: 5px; border-radius: 50%; }
      .actions { display: flex; gap: 7px; margin-top: 10px; padding: 8px 12px;
        background: #18181b; border-top: 1px solid #27272a; }
      .actions button { height: 28px; font-size: 12px; padding: 0 11px; }
      .actions .view { flex: 1; background: #6467f2; border: 0; color: white; font-weight: 600; }
      @media (prefers-reduced-motion: reduce) { .toast { transition: none; transform: none; } }
    </style>
    <section class="toast card visible" aria-label="Capture saved">
      <div class="heading"><span class="check" aria-hidden="true">✓</span><span class="heading-text"></span><button class="dismiss" aria-label="Dismiss">×</button></div>
      <div class="title"></div><div class="facts"></div><div class="warning"></div>
      <div class="tags"></div><div class="error" role="alert"></div>
      <div class="actions"><button class="view">View in Birdbrain</button><button class="recapture">Recapture</button></div>
    </section>`
  const root = shadow.querySelector<HTMLElement>('.card')!
  shadow.querySelector('.heading-text')!.textContent = `Captured to ${card.caseName}`
  const title = shadow.querySelector<HTMLElement>('.title')!
  title.textContent = card.title
  title.title = card.title
  const facts = shadow.querySelector<HTMLElement>('.facts')!
  facts.textContent = `${scrolling ? 'Full page (scrolling)' : 'Full page'} · ${card.format.toUpperCase()} · sha256 recorded${card.manifestIndex === null ? '' : ` · #${card.manifestIndex}`}`
  facts.title = `SHA-256: ${card.hash}`
  shadow.querySelector('.warning')!.textContent = warning ?? ''
  const error = shadow.querySelector('.error')!
  const pause = (): void => {
    if (removeTimeout) clearTimeout(removeTimeout)
    removeTimeout = null
  }
  const resume = (): void => {
    pause()
    removeTimeout = setTimeout(removeToast, 5000)
  }
  root.addEventListener('mouseenter', pause)
  root.addEventListener('mouseleave', resume)
  root.addEventListener('focusin', pause)
  root.addEventListener('focusout', resume)
  shadow.querySelector('.dismiss')!.addEventListener('click', removeToastImmediately)
  const act = async (action: string, values: Record<string, unknown> = {}): Promise<boolean> => {
    error.textContent = ''
    pause()
    try {
      const reply = await chrome.runtime.sendMessage({
        type: 'CAPTURE_CARD_ACTION',
        captureId: card.captureId,
        action,
        ...values
      })
      if (!reply?.ok) throw new Error(reply?.error ?? 'Birdbrain did not answer. Try again.')
      return true
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : 'Could not complete this action.'
      return false
    } finally {
      resume()
    }
  }
  for (const tag of card.tags) {
    const button = document.createElement('button')
    button.className = 'tag'
    button.setAttribute('aria-pressed', String(tag.applied))
    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.style.backgroundColor = tag.applied ? tag.color : 'transparent'
    button.append(dot, document.createTextNode(tag.name))
    button.addEventListener('click', async () => {
      button.disabled = true
      const applied = button.getAttribute('aria-pressed') !== 'true'
      if (await act('tag', { tagId: tag.id, applied })) {
        button.setAttribute('aria-pressed', String(applied))
        dot.style.backgroundColor = applied ? tag.color : 'transparent'
      }
      button.disabled = false
    })
    shadow.querySelector('.tags')!.append(button)
  }
  shadow.querySelector('.view')!.addEventListener('click', async () => {
    if (await act('view')) removeToastImmediately()
  })
  shadow.querySelector('.recapture')!.addEventListener('click', async () => {
    if (await act('recapture', { scrolling })) removeToastImmediately()
  })
  resume()
}
