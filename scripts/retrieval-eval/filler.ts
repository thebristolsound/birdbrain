/**
 * Generated filler pages that bring the synthetic evaluation Case up to its
 * target size (docs/plans/2026-10-09-case-retrieval-first-slice.md, D10).
 *
 * Deterministic: page `i` is the same on every run, so two runs of the
 * evaluation measure the same Case. The pages carry the decoy words the target
 * queries use ("Quillmere", "payments", "desk", "ledger") at fixed rates, so a
 * plain-word search has many candidates to rank, plus shared addresses and
 * outbound links, so a rare identifier stands out against common ones. Every
 * host is a subdomain of a reserved example domain and every name is invented.
 */

const HOSTS = [
  'brindle-forum.example.org',
  'harrow-gazette.example.org',
  'kestrel-classifieds.example.org',
  'mossgiel-news.example.org',
  'tarn-valley-trade.example.com',
  'oakhollow-blog.example.org'
]

const LINK_HOSTS = [
  ...HOSTS,
  'quillmere-supplies.example.com',
  'ferrous-parts.example.com',
  'linden-couriers.example.com',
  'wexley-bank.example.com',
  'pellam-maps.example.org'
]

const SHARED_ADDRESSES = [
  'help@linden-couriers.example.com',
  'orders@ferrous-parts.example.com',
  'news@mossgiel-news.example.org',
  'desk@harrow-gazette.example.org',
  'support@wexley-bank.example.com',
  'admin@brindle-forum.example.org'
]

const WORDS = [
  'order',
  'parts',
  'delivery',
  'seller',
  'invoice',
  'bearing',
  'courier',
  'refund',
  'warehouse',
  'shipment',
  'customer',
  'account',
  'review',
  'complaint',
  'tracking',
  'supplier',
  'catalogue',
  'price',
  'stock',
  'gearbox',
  'pulley',
  'bracket',
  'workshop',
  'weekend',
  'market',
  'council',
  'library',
  'road',
  'meeting',
  'report',
  'river',
  'harbour',
  'station',
  'notice',
  'forum',
  'thread',
  'reply',
  'question',
  'answer',
  'update'
]

const TOPICS = [
  'Courier delays this week',
  'Spare parts swap',
  'Council meeting notes',
  'Workshop open day',
  'Market stall prices',
  'Harbour road works',
  'Library opening hours',
  'Gearbox repair advice',
  'Bracket sizes explained',
  'Refund timelines'
]

/** A small seeded generator (mulberry32), so page `i` never depends on run order. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(next: () => number, list: readonly T[]): T {
  return list[Math.floor(next() * list.length)]
}

function sentence(next: () => number, decoys: string[]): string {
  const count = 8 + Math.floor(next() * 10)
  const words: string[] = []
  for (let i = 0; i < count; i += 1) words.push(pick(next, WORDS))
  if (decoys.length > 0 && next() < 0.5) {
    words.splice(Math.floor(next() * words.length), 0, ...decoys)
  }
  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1) + '.'
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface FillerPage {
  url: string
  title: string
  html: string
}

/** Filler page `index` (0-based). */
export function fillerPage(index: number): FillerPage {
  const next = prng(0x5eed + index * 7919)
  const host = pick(next, HOSTS)
  // Base 36 keeps the page id from spelling a target-only number such as 7781.
  const id = `p${index.toString(36)}`
  const url = `https://${host}/page/${id}`
  const title = `${pick(next, TOPICS)} (${id})`

  const decoys: string[] = []
  if (next() < 0.15) decoys.push('Quillmere')
  if (next() < 0.1) decoys.push('payments', 'desk')
  if (next() < 0.2) decoys.push('ledger')

  const paragraphs: string[] = []
  const paragraphCount = 3 + Math.floor(next() * 5)
  for (let p = 0; p < paragraphCount; p += 1) {
    const sentences: string[] = []
    const sentenceCount = 2 + Math.floor(next() * 4)
    for (let s = 0; s < sentenceCount; s += 1) {
      sentences.push(sentence(next, p === 0 && s === 0 ? decoys : []))
    }
    paragraphs.push(`<p>${escapeHtml(sentences.join(' '))}</p>`)
  }

  const addressCount = Math.floor(next() * 3)
  for (let a = 0; a < addressCount; a += 1) {
    paragraphs.push(`<p>Contact: ${pick(next, SHARED_ADDRESSES)}</p>`)
  }

  const links: string[] = []
  const linkCount = 5 + Math.floor(next() * 21)
  for (let l = 0; l < linkCount; l += 1) {
    const target = `https://${pick(next, LINK_HOSTS)}/${pick(next, WORDS)}/${Math.floor(next() * 500)}`
    const label = `${pick(next, WORDS)} ${pick(next, WORDS)}`
    links.push(
      next() < 0.2
        ? `<li><a href="${target}"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="${label}" width="88" height="31" /></a></li>`
        : `<li><a href="${target}">${label}</a></li>`
    )
  }

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <main>
      <p><em>This page is fictional. It was generated for Birdbrain's retrieval evaluation, and every
      person, site and identifier on it is invented.</em></p>
      <h1>${escapeHtml(title)}</h1>
      ${paragraphs.join('\n      ')}
      <ul>
        ${links.join('\n        ')}
      </ul>
    </main>
  </body>
</html>
`
  return { url, title, html }
}
