const TOAST_ID = 'birdbrain-capture-toast'

interface ToastOptions {
  status: 'capturing' | 'success' | 'error'
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
    color: #fff;
    background: #1a1a2e;
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
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
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255,255,255,0.2);
    border-top-color: #fff;
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
    options.status === 'capturing' ? '<div class="spinner"></div>'
    : options.status === 'success' ? '<span class="icon">&#10003;</span>'
    : '<span class="icon">&#10007;</span>'

  const message =
    options.message ??
    (options.status === 'capturing' ? 'Capturing...'
    : options.status === 'success' ? 'Captured!'
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

  if (options.status === 'success' || options.status === 'error') {
    removeTimeout = setTimeout(removeToast, 2000)
  }
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
