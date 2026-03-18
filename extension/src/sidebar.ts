// Birdbrain Selector Sidebar — Shadow DOM overlay for match results

interface SelectorMatchInfo {
  selectorId: string
  caseId: string
  caseName: string
  pattern: string
  matchText: string
  context: string
  index: number
}

const SIDEBAR_ID = 'birdbrain-selector-sidebar'
const BADGE_ID = 'birdbrain-selector-badge'

let sidebarContainer: HTMLDivElement | null = null
let badgeContainer: HTMLDivElement | null = null
let isCollapsed = false

const STYLES = `
  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: #e2e8f0;
  }

  .sidebar {
    position: fixed;
    top: 0;
    right: 0;
    width: 320px;
    height: 100vh;
    background: #000000;
    border-left: 1px solid rgba(255,255,255,0.08);
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    box-shadow: -4px 0 12px rgba(0, 0, 0, 0.4);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    background: #0f172a;
  }

  .header-title {
    font-weight: 600;
    font-size: 14px;
    color: #f5f5f5;
  }

  .header-count {
    background: #4f46e5;
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 10px;
    margin-left: 8px;
  }

  .collapse-btn {
    background: none;
    border: none;
    color: #64748b;
    cursor: pointer;
    font-size: 18px;
    padding: 4px;
    line-height: 1;
  }

  .collapse-btn:hover {
    color: #e2e8f0;
  }

  .matches-container {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .case-group {
    margin-bottom: 4px;
  }

  .case-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: #0f172a;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }

  .case-name {
    font-weight: 600;
    font-size: 12px;
    color: #4f46e5;
  }

  .capture-btn {
    background: #4f46e5;
    color: #ffffff;
    border: none;
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
  }

  .capture-btn:hover {
    background: #4338ca;
  }

  .match-item {
    padding: 8px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    cursor: pointer;
  }

  .match-item:hover {
    background: rgba(255,255,255,0.1);
  }

  .match-pattern {
    font-family: monospace;
    font-size: 11px;
    color: #94a3b8;
    margin-bottom: 4px;
  }

  .match-text {
    font-weight: 600;
    color: #818cf8;
    font-size: 13px;
  }

  .match-context {
    font-size: 11px;
    color: #64748b;
    margin-top: 4px;
    line-height: 1.4;
    word-break: break-word;
  }

  .badge {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: #4f46e5;
    color: #ffffff;
    font-weight: 700;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 2147483647;
    border: none;
  }

  .badge:hover {
    background: #4338ca;
    transform: scale(1.1);
  }

  .matches-container::-webkit-scrollbar {
    width: 6px;
  }

  .matches-container::-webkit-scrollbar-track {
    background: #000000;
  }

  .matches-container::-webkit-scrollbar-thumb {
    background: #404040;
    border-radius: 3px;
  }
`

function groupMatchesByCase(
  matches: SelectorMatchInfo[]
): Map<string, { caseName: string; caseId: string; matches: SelectorMatchInfo[] }> {
  const groups = new Map<string, { caseName: string; caseId: string; matches: SelectorMatchInfo[] }>()
  for (const match of matches) {
    if (!groups.has(match.caseId)) {
      groups.set(match.caseId, { caseName: match.caseName, caseId: match.caseId, matches: [] })
    }
    groups.get(match.caseId)!.matches.push(match)
  }
  return groups
}

function buildSidebarHTML(matches: SelectorMatchInfo[]): string {
  const groups = groupMatchesByCase(matches)
  let html = ''

  for (const [caseId, group] of groups) {
    html += `<div class="case-group">`
    html += `<div class="case-header">`
    html += `<span class="case-name">${escapeHtml(group.caseName)}</span>`
    html += `<button class="capture-btn" data-case-id="${escapeHtml(caseId)}">Capture Now</button>`
    html += `</div>`

    for (let i = 0; i < group.matches.length; i++) {
      const m = group.matches[i]
      html += `<div class="match-item" data-match-index="${m.index}">`
      html += `<div class="match-pattern">${escapeHtml(m.pattern)}</div>`
      html += `<div class="match-text">${escapeHtml(m.matchText)}</div>`
      html += `<div class="match-context">${escapeHtml(m.context)}</div>`
      html += `</div>`
    }

    html += `</div>`
  }

  return html
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function showSidebar(matches: SelectorMatchInfo[]): void {
  removeSidebar()

  if (matches.length === 0) return

  isCollapsed = false

  // Create sidebar container
  sidebarContainer = document.createElement('div')
  sidebarContainer.id = SIDEBAR_ID
  const shadow = sidebarContainer.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = STYLES
  shadow.appendChild(style)

  const sidebar = document.createElement('div')
  sidebar.className = 'sidebar'

  // Header
  const header = document.createElement('div')
  header.className = 'header'
  header.innerHTML = `
    <div>
      <span class="header-title">Selector Matches</span>
      <span class="header-count">${matches.length}</span>
    </div>
    <button class="collapse-btn" title="Collapse">&times;</button>
  `

  const collapseBtn = header.querySelector('.collapse-btn') as HTMLButtonElement
  collapseBtn.addEventListener('click', () => {
    collapseSidebar(matches.length)
  })

  sidebar.appendChild(header)

  // Matches
  const container = document.createElement('div')
  container.className = 'matches-container'
  container.innerHTML = buildSidebarHTML(matches)

  // Click handlers for matches (scroll to highlight)
  container.addEventListener('click', (e) => {
    const matchItem = (e.target as HTMLElement).closest('.match-item') as HTMLElement | null
    if (matchItem) {
      const index = matchItem.dataset.matchIndex
      const highlights = document.querySelectorAll(
        `mark.birdbrain-selector-highlight[data-match-index="${index}"]`
      )
      if (highlights.length > 0) {
        highlights[0].scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  })

  // Capture button handlers
  container.addEventListener('click', (e) => {
    const captureBtn = (e.target as HTMLElement).closest('.capture-btn') as HTMLElement | null
    if (captureBtn) {
      e.stopPropagation()
      const caseId = captureBtn.dataset.caseId
      if (caseId) {
        chrome.runtime.sendMessage({ type: 'SELECTOR_CAPTURE', caseId })
        captureBtn.textContent = 'Captured!'
        setTimeout(() => {
          captureBtn.textContent = 'Capture Now'
        }, 2000)
      }
    }
  })

  sidebar.appendChild(container)
  shadow.appendChild(sidebar)
  document.documentElement.appendChild(sidebarContainer)
}

function collapseSidebar(matchCount: number): void {
  if (sidebarContainer) {
    sidebarContainer.style.display = 'none'
  }
  isCollapsed = true
  showBadge(matchCount)
}

function showBadge(count: number): void {
  removeBadge()

  badgeContainer = document.createElement('div')
  badgeContainer.id = BADGE_ID
  const shadow = badgeContainer.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = STYLES
  shadow.appendChild(style)

  const badge = document.createElement('button')
  badge.className = 'badge'
  badge.textContent = String(count)
  badge.title = `${count} selector match${count !== 1 ? 'es' : ''} found`

  badge.addEventListener('click', () => {
    removeBadge()
    if (sidebarContainer) {
      sidebarContainer.style.display = ''
      isCollapsed = false
    }
  })

  shadow.appendChild(badge)
  document.documentElement.appendChild(badgeContainer)
}

function removeBadge(): void {
  if (badgeContainer) {
    badgeContainer.remove()
    badgeContainer = null
  }
}

export function removeSidebar(): void {
  if (sidebarContainer) {
    sidebarContainer.remove()
    sidebarContainer = null
  }
  removeBadge()
  isCollapsed = false
}
