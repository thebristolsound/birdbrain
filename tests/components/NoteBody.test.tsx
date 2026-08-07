// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NoteBody } from '@renderer/components/notes/NoteBody'

const RICH = JSON.stringify({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Finding' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The handle ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'nightjar' },
        { type: 'text', text: ' recurs.' }
      ]
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Two sites' }] }]
        }
      ]
    }
  ]
})

describe('NoteBody', () => {
  it('renders a rich body with its structure intact', () => {
    const { container } = render(<NoteBody note={{ body: 'derived text', bodyDoc: RICH }} />)

    expect(screen.getByRole('heading', { name: 'Finding' })).toBeTruthy()
    expect(container.querySelector('strong')?.textContent).toBe('nightjar')
    expect(container.querySelectorAll('ul li')).toHaveLength(1)
  })

  it('renders a legacy note from its plain text, preserving line breaks', () => {
    const { container } = render(<NoteBody note={{ body: 'line one\nline two' }} />)

    const p = container.querySelector('p')!
    expect(p.textContent).toBe('line one\nline two')
    expect(p.className).toContain('whitespace-pre-wrap')
  })

  it('falls back to the plain text when the document will not parse', () => {
    // body is derived in main and always present, so a corrupt body_doc
    // degrades to readable text rather than an empty card.
    const { container } = render(<NoteBody note={{ body: 'still readable', bodyDoc: '{oops' }} />)

    expect(container.textContent).toBe('still readable')
  })

  it('renders nothing for an empty legacy note', () => {
    const { container } = render(<NoteBody note={{ body: '' }} />)

    expect(container.innerHTML).toBe('')
  })
})
