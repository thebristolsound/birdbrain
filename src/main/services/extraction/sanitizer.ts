import * as cheerio from 'cheerio'

export const MAX_HTML_BYTES = 5 * 1024 * 1024

export interface SanitizedHtml {
  text: string
  attrs: {
    href: string[]
    src: string[]
    action: string[]
    mailto: string[]
  }
}

const BLOCKED_SCHEMES = /^(javascript:|data:|blob:|about:)/i

function filterScheme(url: string): string | null {
  const trimmed = url.trim()
  return BLOCKED_SCHEMES.test(trimmed) ? null : trimmed
}

export function sanitizeHtml(html: string): SanitizedHtml {
  const empty: SanitizedHtml = { text: '', attrs: { href: [], src: [], action: [], mailto: [] } }

  try {
    // Enforce a true byte cap (not UTF-16 code units): multi-byte characters
    // would otherwise let the input exceed MAX_HTML_BYTES.
    const input =
      Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES
        ? Buffer.from(html, 'utf8').slice(0, MAX_HTML_BYTES).toString('utf8')
        : html
    const $ = cheerio.load(input, { xmlMode: false })

    // Remove noise subtrees
    $('script, style, svg, template, noscript, iframe').remove()
    // Remove HTML comments
    $('*')
      .contents()
      .filter((_, el) => el.type === 'comment')
      .remove()

    // Harvest attrs
    const hrefs: string[] = []
    const srcs: string[] = []
    const actions: string[] = []
    const mailtos: string[] = []

    $('[href]').each((_, el) => {
      const val = $(el).attr('href')
      if (!val) return
      if (val.trim().toLowerCase().startsWith('mailto:')) {
        // Extract email: strip prefix, take part before '?', URL-decode
        const withoutPrefix = val.trim().slice('mailto:'.length)
        const emailPart = withoutPrefix.split('?')[0]
        try {
          mailtos.push(decodeURIComponent(emailPart))
        } catch {
          mailtos.push(emailPart)
        }
      } else {
        const filtered = filterScheme(val)
        if (filtered) hrefs.push(filtered)
      }
    })

    $('[src]').each((_, el) => {
      const val = $(el).attr('src')
      if (!val) return
      const filtered = filterScheme(val)
      if (filtered) srcs.push(filtered)
    })

    $('[action]').each((_, el) => {
      const val = $(el).attr('action')
      if (!val) return
      const filtered = filterScheme(val)
      if (filtered) actions.push(filtered)
    })

    // Extract visible text
    const bodyEl = $('body')
    const rawText = bodyEl.length ? bodyEl.text() : $.root().text()
    const text = rawText.replace(/[\s\u00a0]+/g, ' ').trim()

    return { text, attrs: { href: hrefs, src: srcs, action: actions, mailto: mailtos } }
  } catch {
    return empty
  }
}
