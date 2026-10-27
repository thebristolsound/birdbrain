import { describe, it, expect } from 'vitest'
import {
  classifyGuestClick,
  linkClickOutcome,
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

// #1735, plan A1 and A7. Each case is an input the E2E harness can also send.
describe('classifyGuestClick', () => {
  const LINK = 'https://example.test/a'
  const press = { url: LINK, button: 'left' as const }
  const release = { url: LINK, button: 'left' as const, modifiers: [] }

  it('is a click on the link when a left press and release share a destination', () => {
    expect(classifyGuestClick(press, release)).toBe(LINK)
  })

  it('is no click from a press on one link to a release on another', () => {
    expect(classifyGuestClick(press, { ...release, url: 'https://example.test/b' })).toBeNull()
  })

  it('is no click when the release is off any link', () => {
    expect(classifyGuestClick(press, { ...release, url: '' })).toBeNull()
  })

  it('is no click when the press was on no link', () => {
    expect(classifyGuestClick({ ...press, url: '' }, { ...release, url: '' })).toBeNull()
  })

  it('is no click without a press before the release', () => {
    expect(classifyGuestClick(null, release)).toBeNull()
  })

  it('is no click with the middle or right button, or none', () => {
    for (const button of ['middle', 'right', null] as const) {
      expect(classifyGuestClick({ ...press, button }, { ...release, button })).toBeNull()
      expect(classifyGuestClick(press, { ...release, button })).toBeNull()
      expect(classifyGuestClick({ ...press, button }, release)).toBeNull()
    }
  })

  it('is no click with any key modifier held', () => {
    for (const modifier of ['shift', 'control', 'alt', 'meta'] as const) {
      expect(classifyGuestClick(press, { ...release, modifiers: [modifier] })).toBeNull()
    }
  })
})

// #1735, plan A2's table.
describe('linkClickOutcome', () => {
  const viewed = {
    id: 'cap1',
    url: 'https://news.example/story',
    timestamp: '2026-01-01T00:00:00Z'
  }
  const older = { id: 'old', url: 'https://other.example/a', timestamp: '2026-01-01T00:00:00Z' }
  const newer = { id: 'new', url: 'https://other.example/a/', timestamp: '2026-02-01T00:00:00Z' }
  const captures = [viewed, older, newer]

  it('opens the newest Capture the Case holds of the address', () => {
    expect(linkClickOutcome('https://other.example/a#top', viewed, captures)).toEqual({
      kind: 'open',
      captureId: 'new'
    })
  })

  it('does nothing on the viewed Capture’s own address or a fragment of it', () => {
    for (const url of ['https://news.example/story', 'https://news.example/story#more']) {
      expect(linkClickOutcome(url, viewed, captures)).toEqual({ kind: 'none' })
    }
  })

  it('does nothing on the viewed address when another Capture of it is newer', () => {
    const recapture = { ...viewed, id: 'cap2', timestamp: '2026-03-01T00:00:00Z' }
    expect(linkClickOutcome(viewed.url, viewed, [...captures, recapture])).toEqual({
      kind: 'none'
    })
  })

  it('says a web address the Case does not hold is not in it', () => {
    expect(linkClickOutcome('http://elsewhere.example/', viewed, captures)).toEqual({
      kind: 'not-in-case',
      url: 'http://elsewhere.example/'
    })
  })

  it('does nothing on any other scheme, or on what is not an address', () => {
    for (const url of [
      'mailto:a@b.example',
      'tel:+15550100',
      'javascript:alert(1)',
      'file:///x',
      'not a url'
    ]) {
      expect(linkClickOutcome(url, viewed, captures)).toEqual({ kind: 'none' })
    }
  })
})
