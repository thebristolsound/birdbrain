import { describe, it, expect } from 'vitest'
import {
  captureLinkBlockReason,
  middleTruncate,
  readGuestContextMenu
} from '@renderer/components/captures/guestLink'

// The shape Electron gives a <webview> `context-menu` listener (#1708 D1): the data is
// on `event.params`, and the event itself carries none of it.
function contextMenuEvent(params: Record<string, unknown>) {
  return {
    type: 'context-menu',
    params: {
      x: 12,
      y: 34,
      linkURL: '',
      linkText: '',
      srcURL: '',
      mediaType: 'none',
      selectionText: '',
      ...params
    }
  }
}

describe('readGuestContextMenu', () => {
  it('reads a link from event.params', () => {
    expect(
      readGuestContextMenu(
        contextMenuEvent({ linkURL: 'https://example.com/a', linkText: '  Example  ' })
      )
    ).toEqual({
      linkUrl: 'https://example.com/a',
      linkText: 'Example',
      imageUrl: '',
      selectionText: '',
      x: 12,
      y: 34
    })
  })

  it('takes srcURL as the image address only when the hit is an image', () => {
    const image = readGuestContextMenu(
      contextMenuEvent({ srcURL: 'https://example.com/i.png', mediaType: 'image' })
    )
    expect(image?.imageUrl).toBe('https://example.com/i.png')
    const video = readGuestContextMenu(
      contextMenuEvent({ srcURL: 'https://example.com/v.mp4', mediaType: 'video' })
    )
    expect(video).toBeNull()
  })

  it('reads a selection with no link', () => {
    expect(readGuestContextMenu(contextMenuEvent({ selectionText: 'quoted' }))?.selectionText).toBe(
      'quoted'
    )
  })

  it('answers null when the hit has nothing the menu acts on', () => {
    expect(readGuestContextMenu(contextMenuEvent({}))).toBeNull()
  })

  it('answers null for an event with no params, and does not read them off the event', () => {
    expect(readGuestContextMenu({ linkURL: 'https://example.com/' })).toBeNull()
    expect(readGuestContextMenu(null)).toBeNull()
    expect(readGuestContextMenu({ params: 'nope' })).toBeNull()
  })

  it('drops fields of the wrong type rather than passing them on', () => {
    expect(
      readGuestContextMenu(
        contextMenuEvent({ linkURL: 'https://example.com/', linkText: 7, x: 'left', y: NaN })
      )
    ).toMatchObject({ linkText: '', x: 0, y: 0 })
  })
})

describe('captureLinkBlockReason', () => {
  it('answers null for a public web address', () => {
    expect(captureLinkBlockReason('https://example.com/a?b=c#d')).toBeNull()
  })

  it('refuses something that is not a URL at all', () => {
    expect(captureLinkBlockReason('')).toBe('Not a web address')
    expect(captureLinkBlockReason('not a url')).toBe('Not a web address')
  })

  it('reads the host after URL normalises it, so an encoded loopback is still caught', () => {
    expect(captureLinkBlockReason('http://0x7f.1/')).toBe('Points at a loopback address')
    expect(captureLinkBlockReason('http://LOCALHOST./')).toBe('Points at this computer')
  })
})

describe('middleTruncate', () => {
  it('leaves a short string alone', () => {
    expect(middleTruncate('https://a.example/', 40)).toBe('https://a.example/')
  })

  it('keeps both ends of a long one, at exactly the limit', () => {
    const url = `https://example.com/${'x'.repeat(200)}/end.html`
    const short = middleTruncate(url, 40)
    expect(short).toHaveLength(40)
    expect(short.startsWith('https://example.com/')).toBe(true)
    expect(short.endsWith('/end.html')).toBe(true)
    expect(short).toContain('…')
  })
})
