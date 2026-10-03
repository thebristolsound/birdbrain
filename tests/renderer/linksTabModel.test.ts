import { describe, it, expect } from 'vitest'
import type { CaptureLink } from '@shared/types'
import { filterLinks, splitAtHost } from '@renderer/components/captures/linksTabModel'

function link(href: string, text = '', kind: CaptureLink['kind'] = 'http'): CaptureLink {
  return {
    href,
    rawHref: href,
    text,
    rel: [],
    kind,
    frame: 'main',
    documentUrl: 'https://news.example/',
    occurrences: 1,
    textHostMismatch: false
  }
}

describe('filterLinks', () => {
  const links = [
    link('https://news.example/a', 'Alpha'),
    link('https://www.news.example/b', 'Beta'),
    link('https://other.example/c', 'Gamma'),
    link('mailto:x@other.example', 'Mail', 'mailto'),
    link('https://news.example/#top', 'Top', 'same-page')
  ]

  it('keeps everything with no query and no toggle', () => {
    expect(
      filterLinks(links, { query: '  ', externalOnly: false }, 'https://news.example/')
    ).toHaveLength(5)
  })

  it('matches the query against text and address, ignoring case', () => {
    expect(
      filterLinks(links, { query: 'GAMMA', externalOnly: false }, 'https://news.example/').map(
        (l) => l.text
      )
    ).toEqual(['Gamma'])
    expect(
      filterLinks(
        links,
        { query: 'other.example', externalOnly: false },
        'https://news.example/'
      ).map((l) => l.text)
    ).toEqual(['Gamma', 'Mail'])
  })

  it('keeps only web links to another host when external only, www. being the same host', () => {
    expect(
      filterLinks(links, { query: '', externalOnly: true }, 'https://www.news.example/story').map(
        (l) => l.text
      )
    ).toEqual(['Gamma'])
  })

  it('treats every web link as external when the Capture URL has no host', () => {
    expect(filterLinks(links, { query: '', externalOnly: true }, 'not a url')).toHaveLength(4)
  })

  it('keeps a same-page link inside a frame from another host as external', () => {
    const framed = {
      ...link('https://widgets.example/frame#top', 'Frame top', 'same-page'),
      frame: 'subframe' as const,
      documentUrl: 'https://widgets.example/frame'
    }
    expect(
      filterLinks(
        [...links, framed],
        { query: '', externalOnly: true },
        'https://news.example/'
      ).map((l) => l.text)
    ).toEqual(['Gamma', 'Frame top'])
  })
})

describe('splitAtHost', () => {
  it.each([
    ['https://news.example/a?b#c', ['https://', 'news.example', '/a?b#c']],
    ['http://user@host.example:8080/x', ['http://user@', 'host.example', ':8080/x']],
    ['mailto:a@b.example', ['mailto:a@b.example', '', '']],
    ['not a url', ['not a url', '', '']]
  ])('splits %s', (href, [before, host, after]) => {
    expect(splitAtHost(href)).toEqual({ before, host, after })
  })
})
