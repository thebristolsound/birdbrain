const TOAST_ID = 'birdbrain-capture-toast'

interface ToastOptions {
  status: 'capturing' | 'success' | 'degraded' | 'error' | 'skipped'
  message?: string
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
export function removeToastImmediately(): void {
  if (removeTimeout) {
    clearTimeout(removeTimeout)
    removeTimeout = null
  }
  document.getElementById(TOAST_ID)?.remove()
}

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
