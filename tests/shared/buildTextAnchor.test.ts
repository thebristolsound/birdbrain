/**
 * Building a text anchor from a selection in the capture's stored text.
 *
 * The property that matters is the round trip: an anchor built from a
 * selection must resolve back to exactly the offset it was built from, against
 * the same text. Everything else here is an edge of that one claim. A builder
 * that produced anchors the resolver could not locate would be worse than no
 * builder at all — it would manufacture citations that fail later, in a
 * report, rather than now.
 */
import { describe, it, expect } from 'vitest'
import { buildTextAnchor, matchTextAnchor, parseNoteAnchor } from '@shared/noteAnchor'

const PAGE = 'the sum was transferred on 4 April to an account in Riga.'

describe('buildTextAnchor', () => {
  it('captures the selected passage as the quote', () => {
    const start = PAGE.indexOf('transferred')
    const anchor = buildTextAnchor({
      text: PAGE,
      start,
      end: start + 'transferred on 4 April'.length,
      captureId: 'cap-1'
    })

    expect(anchor.quote).toBe('transferred on 4 April')
    expect(anchor.textOffset).toBe(start)
    expect(anchor.kind).toBe('text')
    expect(anchor.captureId).toBe('cap-1')
  })

  it('takes context from both sides of the selection', () => {
    const start = PAGE.indexOf('transferred')
    const anchor = buildTextAnchor({
      text: PAGE,
      start,
      end: start + 'transferred'.length,
      captureId: 'cap-1',
      contextLength: 8
    })

    expect(anchor.prefix).toBe('sum was ')
    expect(anchor.suffix).toBe(' on 4 Ap')
  })

  // The round trip is the whole point: what is built must be findable.
  it('produces an anchor that resolves back to the offset it was built from', () => {
    const start = PAGE.indexOf('4 April')
    const anchor = buildTextAnchor({
      text: PAGE,
      start,
      end: start + '4 April'.length,
      captureId: 'cap-1'
    })

    expect(matchTextAnchor(PAGE, anchor)).toEqual({
      status: 'resolved',
      via: 'offset',
      offset: start
    })
  })

  it('produces an anchor that survives serialization and validation', () => {
    const start = PAGE.indexOf('Riga')
    const anchor = buildTextAnchor({
      text: PAGE,
      start,
      end: start + 'Riga'.length,
      captureId: 'cap-1'
    })

    expect(parseNoteAnchor(JSON.stringify(anchor))).toEqual(anchor)
  })

  describe('at the edges of the document', () => {
    it('gives an empty prefix for a selection at the very start', () => {
      const anchor = buildTextAnchor({ text: PAGE, start: 0, end: 3, captureId: 'cap-1' })

      expect(anchor.prefix).toBe('')
      expect(anchor.quote).toBe('the')
      expect(matchTextAnchor(PAGE, anchor)).toMatchObject({ status: 'resolved', offset: 0 })
    })

    it('gives an empty suffix for a selection at the very end', () => {
      const start = PAGE.length - 5
      const anchor = buildTextAnchor({ text: PAGE, start, end: PAGE.length, captureId: 'cap-1' })

      expect(anchor.suffix).toBe('')
      expect(matchTextAnchor(PAGE, anchor)).toMatchObject({ status: 'resolved', offset: start })
    })

    it('handles a selection spanning the whole document', () => {
      const anchor = buildTextAnchor({ text: PAGE, start: 0, end: PAGE.length, captureId: 'cap-1' })

      expect(anchor.quote).toBe(PAGE)
      expect(anchor.prefix).toBe('')
      expect(anchor.suffix).toBe('')
      expect(matchTextAnchor(PAGE, anchor)).toMatchObject({ status: 'resolved', offset: 0 })
    })
  })

  // A quote appearing twice is the case context exists for. The builder must
  // give the resolver enough to tell the two apart, and rung one must land on
  // the occurrence actually selected rather than the first in the document.
  describe('when the selected passage appears more than once', () => {
    const REPEATED = 'the account was closed. the account was closed. and then reopened.'

    it('resolves to the occurrence that was selected, not the first', () => {
      const second = REPEATED.indexOf('the account', 5)
      const anchor = buildTextAnchor({
        text: REPEATED,
        start: second,
        end: second + 'the account'.length,
        captureId: 'cap-1'
      })

      expect(matchTextAnchor(REPEATED, anchor)).toEqual({
        status: 'resolved',
        via: 'offset',
        offset: second
      })
    })

    it('still carries context that distinguishes the two occurrences', () => {
      const second = REPEATED.indexOf('the account', 5)
      const anchor = buildTextAnchor({
        text: REPEATED,
        start: second,
        end: second + 'the account'.length,
        captureId: 'cap-1'
      })

      // Shift every offset so rung one cannot fire; context must carry it.
      const shifted = 'PREAMBLE. ' + REPEATED
      const result = matchTextAnchor(shifted, anchor)

      expect(result).toMatchObject({ status: 'resolved', via: 'context' })
      expect(result).toMatchObject({ offset: shifted.indexOf('the account', 15) })
    })
  })

  describe('refuses a selection it could never anchor', () => {
    it('rejects an empty selection', () => {
      expect(() => buildTextAnchor({ text: PAGE, start: 5, end: 5, captureId: 'cap-1' })).toThrow(
        /empty/i
      )
    })

    it('rejects a backwards selection', () => {
      expect(() => buildTextAnchor({ text: PAGE, start: 10, end: 4, captureId: 'cap-1' })).toThrow(
        /backwards|empty/i
      )
    })

    it('rejects a selection running past the end of the text', () => {
      expect(() =>
        buildTextAnchor({ text: PAGE, start: 0, end: PAGE.length + 10, captureId: 'cap-1' })
      ).toThrow(/outside|range/i)
    })

    it('rejects a negative start', () => {
      expect(() =>
        buildTextAnchor({ text: PAGE, start: -1, end: 5, captureId: 'cap-1' })
      ).toThrow(/outside|range|negative/i)
    })

    it('rejects a fractional offset, which no string index can be', () => {
      expect(() =>
        buildTextAnchor({ text: PAGE, start: 1.5, end: 6, captureId: 'cap-1' })
      ).toThrow(/integer/i)
    })

    // Whitespace-only is a real selection a user can make by dragging across a
    // gap. It cannot anchor anything: it matches in hundreds of places and
    // carries no evidentiary content.
    it('rejects a whitespace-only selection', () => {
      const spaces = 'a           b'
      expect(() => buildTextAnchor({ text: spaces, start: 1, end: 6, captureId: 'cap-1' })).toThrow(
        /whitespace|empty/i
      )
    })
  })
})
