// Birdbrain Selector Sidebar — Shadow DOM overlay for match results
// OLED Dark Mode design from SuperDesign draft 4fb645e0

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

// --- SVG Icons (Lucide, 16×16) ---

const ICON_RADAR = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M4 6h.01"/><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/><path d="M16.24 7.76A6 6 0 1 0 8.23 16.67"/><path d="M12 18h.01"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/></svg>`

const ICON_REGEX = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3v10"/><path d="m12.67 5.5 8.66 5"/><path d="m12.67 10.5 8.66-5"/><rect x="1" y="13" width="10" height="8" rx="2"/></svg>`

const ICON_PANEL_CLOSE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m8 9 3 3-3 3"/></svg>`

const ICON_FILTER = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`

const ICON_USER = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`

const ICON_MAIL = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`

const ICON_WALLET = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></svg>`

const ICON_SERVER = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>`

const ICON_GLOBE = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`

const ICON_CAMERA = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`

const ICON_SETTINGS = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`

// --- Entity type inference ---

type EntityType = 'person' | 'email' | 'crypto' | 'ip' | 'domain' | 'unknown'

interface EntityTypeConfig {
  label: string
  icon: string
  color: string
  badgeClass: string
  badgeLabel: string
}

const ENTITY_TYPES: Record<EntityType, EntityTypeConfig> = {
  person: {
    label: 'Persons',
    icon: ICON_USER,
    color: '#f59e0b',
    badgeClass: 'entity-badge-amber',
    badgeLabel: 'Person'
  },
  email: {
    label: 'Email',
    icon: ICON_MAIL,
    color: '#22c55e',
    badgeClass: 'entity-badge-green',
    badgeLabel: 'Email'
  },
  crypto: {
    label: 'Crypto',
    icon: ICON_WALLET,
    color: '#eab308',
    badgeClass: 'entity-badge-yellow',
    badgeLabel: 'Crypto'
  },
  ip: {
    label: 'IP Address',
    icon: ICON_SERVER,
    color: '#ef4444',
    badgeClass: 'entity-badge-red',
    badgeLabel: 'IP'
  },
  domain: {
    label: 'Domains',
    icon: ICON_GLOBE,
    color: '#ec4899',
    badgeClass: 'entity-badge-pink',
    badgeLabel: 'Domain'
  },
  unknown: {
    label: 'Other',
    icon: ICON_REGEX,
    color: '#6366f1',
    badgeClass: 'entity-badge-indigo',
    badgeLabel: 'Match'
  }
}

function inferEntityType(match: SelectorMatchInfo): EntityType {
  const name = match.pattern.toLowerCase()
  const selectorName = (match as { selectorName?: string }).selectorName?.toLowerCase() || ''
  const combined = `${name} ${selectorName}`

  if (/email|mail|@/.test(combined)) return 'email'
  if (/crypto|wallet|eth|btc|bitcoin|ethereum|0x[a-f0-9]/i.test(combined)) return 'crypto'
  if (/\bip\b|ipv[46]|ip.?addr/i.test(combined)) return 'ip'
  if (/domain|hostname|\.com|\.org|\.net|\.io|fqdn/i.test(combined)) return 'domain'
  if (/person|name|user|author|actor|suspect/i.test(combined)) return 'person'
  return 'unknown'
}

// --- Styles ---
// Note: All HTML set via innerHTML below is built from trusted constants
// (SVG icons, CSS classes) and escapeHtml()-sanitized user data only.
// No untrusted external content is injected.

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

  :host {
    all: initial;
    font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: #e2e8f0;
  }

  @keyframes slideIn {
    from { transform: translateX(320px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }

  .sidebar {
    position: fixed;
    top: 0;
    right: 0;
    width: 320px;
    height: 100vh;
    background: #000000;
    border-left: 1px solid rgba(255,255,255,0.04);
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    box-shadow: -10px 0 60px rgba(0,0,0,0.8), -1px 0 0 rgba(255,255,255,0.04), 0 0 80px rgba(79,70,229,0.03);
    animation: slideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  /* --- Header --- */

  .header {
    height: 56px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .header-logo {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: #4f46e5;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    box-shadow: 0 2px 8px rgba(79,70,229,0.3);
  }

  .header-title {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-weight: 700;
    font-size: 14px;
    letter-spacing: -0.02em;
    color: #f1f5f9;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .icon-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #64748b;
    background: none;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .icon-btn:hover {
    color: #cbd5e1;
    background: #1a1d25;
  }

  /* --- Scrollable content --- */

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 24px 20px;
    display: flex;
    flex-direction: column;
    gap: 32px;
  }

  .content::-webkit-scrollbar { width: 4px; }
  .content::-webkit-scrollbar-track { background: transparent; }
  .content::-webkit-scrollbar-thumb { background: #1e2330; border-radius: 4px; }
  .content::-webkit-scrollbar-thumb:hover { background: #334155; }

  /* --- Section --- */

  .section { display: flex; flex-direction: column; gap: 16px; }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .section-label {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .section-count {
    font-size: 10px;
    font-weight: 600;
    color: #818cf8;
    background: rgba(99,102,241,0.1);
    padding: 2px 8px;
    border-radius: 9999px;
    border: 1px solid rgba(99,102,241,0.2);
  }

  .section-filter {
    color: #475569;
    cursor: pointer;
    display: flex;
    transition: color 0.2s;
  }

  .section-filter:hover { color: #94a3b8; }

  /* --- Selector cards --- */

  .selectors-list { display: flex; flex-direction: column; gap: 8px; }

  .selector-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px;
    border-radius: 12px;
    border: 1px solid #1e2330;
    background: #111318;
    cursor: pointer;
    transition: all 0.25s ease;
  }

  .selector-card:hover {
    background: #252a36;
    transform: translateY(-1px);
  }

  .selector-info {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .selector-icon {
    color: #818cf8;
    display: flex;
  }

  .selector-name {
    font-size: 12px;
    font-weight: 600;
    color: #f1f5f9;
  }

  .selector-match-count {
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
    font-weight: 700;
    color: #818cf8;
  }

  /* --- Entity groups --- */

  .entity-groups { display: flex; flex-direction: column; gap: 12px; }

  .entity-group { display: flex; flex-direction: column; gap: 8px; }

  .entity-type-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 4px;
  }

  .entity-type-icon {
    display: flex;
    align-items: center;
  }

  .entity-type-label {
    font-size: 10px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: -0.01em;
  }

  .entity-type-count {
    font-size: 9px;
    font-family: 'JetBrains Mono', monospace;
    color: #475569;
    margin-left: auto;
  }

  .entity-card {
    padding: 12px;
    border-radius: 12px;
    background: #111318;
    border: 1px solid #1e2330;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .entity-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    padding: 2px 0;
    transition: opacity 0.2s;
  }

  .entity-row:hover { opacity: 0.8; }

  .entity-value {
    font-size: 12px;
    font-weight: 600;
    color: #f1f5f9;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }

  .entity-value-mono {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    font-weight: 400;
    color: #f1f5f9;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }

  /* --- Entity badges by type --- */

  .entity-badge {
    padding: 2px 6px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 600;
    font-family: 'JetBrains Mono', monospace;
    border: 1px solid;
    transition: all 0.3s ease;
  }

  .entity-badge-amber {
    background: rgba(245,158,11,0.12);
    border-color: rgba(245,158,11,0.25);
    color: #fbbf24;
  }

  .entity-badge-green {
    background: rgba(34,197,94,0.12);
    border-color: rgba(34,197,94,0.25);
    color: #4ade80;
  }

  .entity-badge-yellow {
    background: rgba(234,179,8,0.12);
    border-color: rgba(234,179,8,0.25);
    color: #facc15;
  }

  .entity-badge-red {
    background: rgba(239,68,68,0.12);
    border-color: rgba(239,68,68,0.25);
    color: #f87171;
  }

  .entity-badge-pink {
    background: rgba(236,72,153,0.12);
    border-color: rgba(236,72,153,0.25);
    color: #f472b6;
  }

  .entity-badge-indigo {
    background: rgba(99,102,241,0.12);
    border-color: rgba(99,102,241,0.25);
    color: #a5b4fc;
  }

  /* --- Footer --- */

  .footer {
    height: 72px;
    flex-shrink: 0;
    padding: 0 20px;
    border-top: 1px solid rgba(255,255,255,0.04);
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(0,0,0,0.85);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  .settings-btn {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #64748b;
    background: none;
    border: none;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .settings-btn:hover {
    color: #818cf8;
    background: rgba(99,102,241,0.1);
  }

  .capture-btn {
    flex: 1;
    height: 44px;
    background: #4f46e5;
    color: #ffffff;
    border: none;
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-weight: 700;
    font-size: 14px;
    border-radius: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    box-shadow: 0 0 24px rgba(79,70,229,0.4), 0 0 8px rgba(99,102,241,0.25), 0 4px 12px rgba(0,0,0,0.5);
    transition: all 0.2s ease;
  }

  .capture-btn:hover {
    background: #6366f1;
    box-shadow: 0 0 32px rgba(79,70,229,0.55), 0 0 12px rgba(99,102,241,0.35), 0 6px 16px rgba(0,0,0,0.6);
  }

  .capture-btn:active {
    transform: scale(0.98);
  }

  .capture-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* --- Badge (collapsed state) --- */

  .badge {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: #4f46e5;
    color: #ffffff;
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-weight: 700;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 0 24px rgba(79,70,229,0.4), 0 4px 12px rgba(0,0,0,0.5);
    z-index: 2147483647;
    border: none;
    transition: all 0.2s ease;
  }

  .badge:hover {
    background: #6366f1;
    transform: scale(1.1);
    box-shadow: 0 0 32px rgba(79,70,229,0.55), 0 6px 16px rgba(0,0,0,0.6);
  }
`

// --- Helpers ---

function groupMatchesByCase(
  matches: SelectorMatchInfo[]
): Map<string, { caseName: string; caseId: string; matches: SelectorMatchInfo[] }> {
  const groups = new Map<
    string,
    { caseName: string; caseId: string; matches: SelectorMatchInfo[] }
  >()
  for (const match of matches) {
    if (!groups.has(match.caseId)) {
      groups.set(match.caseId, { caseName: match.caseName, caseId: match.caseId, matches: [] })
    }
    groups.get(match.caseId)!.matches.push(match)
  }
  return groups
}

function groupMatchesBySelector(
  matches: SelectorMatchInfo[]
): Map<string, { pattern: string; count: number }> {
  const groups = new Map<string, { pattern: string; count: number }>()
  for (const match of matches) {
    if (!groups.has(match.selectorId)) {
      groups.set(match.selectorId, { pattern: match.pattern, count: 0 })
    }
    groups.get(match.selectorId)!.count++
  }
  return groups
}

function groupMatchesByEntityType(
  matches: SelectorMatchInfo[]
): Map<EntityType, SelectorMatchInfo[]> {
  const groups = new Map<EntityType, SelectorMatchInfo[]>()
  for (const match of matches) {
    const type = inferEntityType(match)
    if (!groups.has(type)) {
      groups.set(type, [])
    }
    groups.get(type)!.push(match)
  }
  return groups
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Derive a friendly name for a selector pattern
function selectorDisplayName(pattern: string): string {
  // If pattern looks like a readable name, use it
  if (/^[A-Za-z][\w\s-]+$/.test(pattern) && pattern.length < 40) {
    return pattern
  }
  // Otherwise try to infer from regex content
  if (/email|mail|@/i.test(pattern)) return 'Email Addresses'
  if (/eth|0x[a-f0-9]/i.test(pattern)) return 'ETH Wallets'
  if (/btc|bitcoin|[13][a-km-zA-HJ-NP-Z1-9]{25,34}/i.test(pattern)) return 'BTC Wallets'
  if (/\bip\b|ipv4|\d+\.\d+\.\d+\.\d+/i.test(pattern)) return 'IP-v4 Assets'
  if (/domain|hostname/i.test(pattern)) return 'Domain Names'
  if (/person|name|user/i.test(pattern)) return 'Person Names'
  // Truncate long regex patterns
  if (pattern.length > 30) return pattern.substring(0, 27) + '...'
  return pattern
}

// Determine if a match value should use monospace styling
function isMonoValue(type: EntityType): boolean {
  return type === 'email' || type === 'crypto' || type === 'ip' || type === 'domain'
}

// --- HTML Builders ---
// Note: All HTML below is built from trusted constants (SVG icon strings,
// CSS class names) combined with escapeHtml()-sanitized user data.
// No raw untrusted content is ever injected.

function buildSelectorsSection(matches: SelectorMatchInfo[]): string {
  const selectors = groupMatchesBySelector(matches)
  const count = selectors.size

  let html = '<section class="section">'
  html += '<div class="section-header">'
  html += '<span class="section-label">Active Selectors</span>'
  html += '<span class="section-count">' + count + ' Active</span>'
  html += '</div>'
  html += '<div class="selectors-list">'

  for (const [selectorId, info] of selectors) {
    const displayName = selectorDisplayName(info.pattern)
    html += '<div class="selector-card" data-selector-id="' + escapeHtml(selectorId) + '">'
    html += '<div class="selector-info">'
    html += '<span class="selector-icon">' + ICON_REGEX + '</span>'
    html += '<span class="selector-name">' + escapeHtml(displayName) + '</span>'
    html += '</div>'
    html += '<span class="selector-match-count">' + info.count + '</span>'
    html += '</div>'
  }

  html += '</div></section>'
  return html
}

function buildEntitiesSection(matches: SelectorMatchInfo[]): string {
  const entityGroups = groupMatchesByEntityType(matches)

  let html = '<section class="section">'
  html += '<div class="section-header">'
  html += '<span class="section-label">Detected Entities</span>'
  html += '<span class="section-filter">' + ICON_FILTER + '</span>'
  html += '</div>'
  html += '<div class="entity-groups">'

  // Sort: known types first, unknown last
  const typeOrder: EntityType[] = ['person', 'email', 'crypto', 'ip', 'domain', 'unknown']
  const sortedEntries = [...entityGroups.entries()].sort(
    (a, b) => typeOrder.indexOf(a[0]) - typeOrder.indexOf(b[0])
  )

  for (const [type, typeMatches] of sortedEntries) {
    const config = ENTITY_TYPES[type]

    // Deduplicate match values
    const uniqueValues = new Map<string, SelectorMatchInfo>()
    for (const m of typeMatches) {
      if (!uniqueValues.has(m.matchText)) {
        uniqueValues.set(m.matchText, m)
      }
    }

    html += '<div class="entity-group">'
    // Type header
    html += '<div class="entity-type-header">'
    html += '<span class="entity-type-icon" style="color:' + config.color + '">' + config.icon + '</span>'
    html += '<span class="entity-type-label">' + escapeHtml(config.label) + '</span>'
    html += '<span class="entity-type-count">' + uniqueValues.size + ' found</span>'
    html += '</div>'

    // Entity card
    html += '<div class="entity-card">'
    for (const [value, m] of uniqueValues) {
      const valueClass = isMonoValue(type) ? 'entity-value-mono' : 'entity-value'
      const displayValue = value.length > 24
        ? value.substring(0, 6) + '...' + value.substring(value.length - 4)
        : value
      html += '<div class="entity-row" data-match-index="' + m.index + '">'
      html += '<span class="' + valueClass + '">' + escapeHtml(displayValue) + '</span>'
      html += '<span class="entity-badge ' + config.badgeClass + '">' + escapeHtml(config.badgeLabel) + '</span>'
      html += '</div>'
    }
    html += '</div>'
    html += '</div>'
  }

  html += '</div></section>'
  return html
}

// --- Main sidebar logic ---

export function showSidebar(matches: SelectorMatchInfo[]): void {
  removeSidebar()

  if (matches.length === 0) return

  // Create sidebar container
  sidebarContainer = document.createElement('div')
  sidebarContainer.id = SIDEBAR_ID
  const shadow = sidebarContainer.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = STYLES
  shadow.appendChild(style)

  const sidebar = document.createElement('div')
  sidebar.className = 'sidebar'

  // --- Header ---
  const header = document.createElement('header')
  header.className = 'header'

  const headerLeft = document.createElement('div')
  headerLeft.className = 'header-left'

  const logo = document.createElement('div')
  logo.className = 'header-logo'
  logo.innerHTML = ICON_RADAR

  const title = document.createElement('span')
  title.className = 'header-title'
  title.textContent = 'Birdbrain'

  headerLeft.appendChild(logo)
  headerLeft.appendChild(title)

  const headerActions = document.createElement('div')
  headerActions.className = 'header-actions'

  const closeBtn = document.createElement('button')
  closeBtn.className = 'icon-btn close-btn'
  closeBtn.title = 'Close sidebar'
  closeBtn.innerHTML = ICON_PANEL_CLOSE
  closeBtn.addEventListener('click', () => {
    collapseSidebar(matches.length)
  })

  headerActions.appendChild(closeBtn)
  header.appendChild(headerLeft)
  header.appendChild(headerActions)
  sidebar.appendChild(header)

  // --- Scrollable content ---
  const content = document.createElement('div')
  content.className = 'content'
  content.innerHTML = buildSelectorsSection(matches) + buildEntitiesSection(matches)

  // Click handlers for entity rows (scroll to highlight)
  content.addEventListener('click', (e) => {
    const entityRow = (e.target as HTMLElement).closest('.entity-row') as HTMLElement | null
    if (entityRow) {
      const index = entityRow.dataset.matchIndex
      const highlights = document.querySelectorAll(
        'mark.birdbrain-selector-highlight[data-match-index="' + index + '"]'
      )
      if (highlights.length > 0) {
        highlights[0].scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  })

  sidebar.appendChild(content)

  // --- Footer ---
  const caseGroups = groupMatchesByCase(matches)
  const firstCaseId = caseGroups.keys().next().value || ''

  const footer = document.createElement('footer')
  footer.className = 'footer'

  const settingsBtn = document.createElement('button')
  settingsBtn.className = 'settings-btn'
  settingsBtn.title = 'Settings'
  settingsBtn.innerHTML = ICON_SETTINGS

  const captureBtn = document.createElement('button')
  captureBtn.className = 'capture-btn'
  captureBtn.dataset.caseId = firstCaseId
  captureBtn.innerHTML = ICON_CAMERA + ' Capture Now'

  captureBtn.addEventListener('click', () => {
    const caseId = captureBtn.dataset.caseId
    if (caseId) {
      chrome.runtime.sendMessage({ type: 'SELECTOR_CAPTURE', caseId })
      captureBtn.innerHTML = ICON_CAMERA + ' Captured!'
      setTimeout(() => {
        captureBtn.innerHTML = ICON_CAMERA + ' Capture Now'
      }, 2000)
    }
  })

  footer.appendChild(settingsBtn)
  footer.appendChild(captureBtn)
  sidebar.appendChild(footer)

  shadow.appendChild(sidebar)
  document.documentElement.appendChild(sidebarContainer)
}

function collapseSidebar(matchCount: number): void {
  if (sidebarContainer) {
    sidebarContainer.style.display = 'none'
  }
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
  badge.title = count + ' selector match' + (count !== 1 ? 'es' : '') + ' found'

  badge.addEventListener('click', () => {
    removeBadge()
    if (sidebarContainer) {
      sidebarContainer.style.display = ''
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
}
