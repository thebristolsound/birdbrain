import { describe, it, expect } from 'vitest'
import { matchTextAnchor, parseNoteAnchor, type TextAnchor } from '@shared/noteAnchor'

function anchor(over: Partial<TextAnchor> = {}): TextAnchor {
  return {
    kind: 'text',
    captureId: 'cap-1',
    quote: 'transferred on 4 April',
    prefix: 'the sum was ',
    suffix: ' to an account',
    textOffset: 0,
    ...over
  }
}

describe('matchTextAnchor', () => {
  it('resolves at the stored offset when the text is unchanged', () => {
    const text = 'the sum was transferred on 4 April to an account in Riga.'
    const a = anchor({ textOffset: text.indexOf('transferred') })

    const result = matchTextAnchor(text, a)

    expect(result).toEqual({ status: 'resolved', via: 'offset', offset: 12 })
  })

  it('repairs the offset when the quote moved but is still unique', () => {
    const text = 'A preamble was added. the sum was transferred on 4 April to an account.'
    const a = anchor({ textOffset: 12 })

    const result = matchTextAnchor(text, a)

    expect(result.status).toBe('resolved')
    expect(result).toMatchObject({ via: 'quote', offset: text.indexOf('transferred') })
  })

  it('uses surrounding context to pick between repeated quotes', () => {
    const text =
      'the sum was transferred on 4 April to a holding account. ' +
      'Later the sum was transferred on 4 April to an account in Riga.'
    const a = anchor({ textOffset: 999 })

    const result = matchTextAnchor(text, a)

    expect(result.status).toBe('resolved')
    // The second occurrence is the one followed by ' to an account'.
    expect(result).toMatchObject({
      via: 'context',
      offset: text.lastIndexOf('transferred on 4 April')
    })
  })

  it('is unresolved when the quote repeats and context cannot disambiguate', () => {
    const text =
      'the sum was transferred on 4 April to an account. ' +
      'Again: the sum was transferred on 4 April to an account.'

    const result = matchTextAnchor(text, anchor({ textOffset: 999 }))

    expect(result).toEqual({ status: 'unresolved' })
  })

  it('is unresolved when the quote is absent from the text', () => {
    const text = 'Nothing in this page resembles the recorded passage.'

    const result = matchTextAnchor(text, anchor())

    expect(result).toEqual({ status: 'unresolved' })
  })

  it('prefers the stored offset over an equally valid occurrence elsewhere', () => {
    // Both occurrences are exact. The ladder's first rung must win, so the
    // stored offset is honoured rather than repaired to the first match.
    const text =
      'the sum was transferred on 4 April to an account. ' +
      'the sum was transferred on 4 April to an account.'
    const second = text.lastIndexOf('transferred on 4 April')

    const result = matchTextAnchor(text, anchor({ textOffset: second }))

    expect(result).toEqual({ status: 'resolved', via: 'offset', offset: second })
  })

  it('does not resolve a quote that only partially matches at the stored offset', () => {
    const text = 'the sum was transferred on 5 April to an account.'
    const a = anchor({ textOffset: 12 })

    const result = matchTextAnchor(text, a)

    expect(result).toEqual({ status: 'unresolved' })
  })
})

describe('parseNoteAnchor', () => {
  it('parses a capture anchor', () => {
    expect(parseNoteAnchor(JSON.stringify({ kind: 'capture', captureId: 'cap-1' }))).toEqual({
      kind: 'capture',
      captureId: 'cap-1'
    })
  })

  it('parses a region anchor, keeping the image dimensions its coordinates mean nothing without', () => {
    const region = {
      kind: 'region',
      captureId: 'cap-1',
      x: 10,
      y: 20,
      w: 100,
      h: 50,
      imageWidth: 1280,
      imageHeight: 800
    }

    expect(parseNoteAnchor(JSON.stringify(region))).toEqual(region)
  })

  it('parses a text anchor', () => {
    const text = {
      kind: 'text',
      captureId: 'cap-1',
      quote: 'transferred on 4 April',
      prefix: 'the sum was ',
      suffix: ' to an account',
      textOffset: 12
    }

    expect(parseNoteAnchor(JSON.stringify(text))).toEqual(text)
  })

  it('parses an extracted-data finding anchor by its natural key', () => {
    const finding = {
      kind: 'finding',
      finding: 'extractedData',
      captureId: 'cap-1',
      category: 'contact',
      subcategory: 'email',
      value: 'ops@example.com'
    }

    expect(parseNoteAnchor(JSON.stringify(finding))).toEqual(finding)
  })

  it('parses a selector-match finding anchor by its composite key', () => {
    const finding = {
      kind: 'finding',
      finding: 'selectorMatch',
      captureId: 'cap-1',
      selectorId: 'sel-1'
    }

    expect(parseNoteAnchor(JSON.stringify(finding))).toEqual(finding)
  })

  it('drops an extracted_data surrogate id rather than anchoring to it', () => {
    // Re-extraction deletes and re-inserts every row, so a stored `id` would
    // point at a row that no longer exists. The natural key survives it.
    const parsed = parseNoteAnchor(
      JSON.stringify({
        kind: 'finding',
        finding: 'extractedData',
        captureId: 'cap-1',
        category: 'contact',
        subcategory: 'email',
        value: 'ops@example.com',
        id: 'extracted-row-42'
      })
    )

    expect(parsed).not.toHaveProperty('id')
  })

  it('rejects an unknown anchor kind', () => {
    expect(() => parseNoteAnchor(JSON.stringify({ kind: 'vibes', captureId: 'cap-1' }))).toThrow(
      /anchor kind/i
    )
  })

  it('rejects a region anchor with no image dimensions to interpret it against', () => {
    expect(() =>
      parseNoteAnchor(
        JSON.stringify({ kind: 'region', captureId: 'cap-1', x: 1, y: 2, w: 3, h: 4 })
      )
    ).toThrow(/imageWidth/)
  })

  it('rejects a text anchor with an empty quote, which nothing could ever locate', () => {
    expect(() =>
      parseNoteAnchor(
        JSON.stringify({
          kind: 'text',
          captureId: 'cap-1',
          quote: '',
          prefix: '',
          suffix: '',
          textOffset: 0
        })
      )
    ).toThrow(/quote/)
  })

  it('rejects an anchor with no capture to point at', () => {
    expect(() => parseNoteAnchor(JSON.stringify({ kind: 'capture' }))).toThrow(/captureId/)
  })

  it('rejects unparseable JSON', () => {
    expect(() => parseNoteAnchor('{oops')).toThrow(/not valid JSON/)
  })
})
