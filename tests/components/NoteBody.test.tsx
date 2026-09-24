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

const WITH_MENTION = JSON.stringify({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Finding' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Seen on ' },
        {
          type: 'mention',
          attrs: { targetType: 'selector', targetId: 's1', label: 'nightjar' }
        },
        { type: 'text', text: ' twice.' }
      ]
    }
  ]
})

function docWithMentionLabel(label: string, targetType = 'capture'): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'mention', attrs: { targetType, targetId: 'x1', label } }]
      }
    ]
  })
}

describe('NoteBody Mentions', () => {
  it('masks a Mention to its sigil plus label rather than drawing a chip', () => {
    const { container } = render(<NoteBody note={{ body: '', bodyDoc: WITH_MENTION }} />)

    expect(container.textContent).toContain('Seen on #nightjar twice.')
    expect(container.querySelector('[data-mention-chip]')).toBeNull()
  })

  it('leaves every other node rendering as it did', () => {
    // The nodeMapping override is merged over the extension-derived map, not
    // substituted for it — a heading must survive a paragraph gaining a chip.
    const { container } = render(<NoteBody note={{ body: '', bodyDoc: WITH_MENTION }} />)

    expect(container.querySelector('h2')?.textContent).toBe('Finding')
  })

  it('elides a label past thirty characters', () => {
    const { container } = render(
      <NoteBody note={{ body: '', bodyDoc: docWithMentionLabel('x'.repeat(40)) }} />
    )

    expect(container.textContent).toBe(`@${'x'.repeat(29)}…`)
  })

  it('prefers the current label over the one the note was written against', () => {
    const resolveMention = () => ({ status: 'resolved' as const, label: 'Renamed', color: null })
    const { container } = render(
      <NoteBody
        note={{ body: '', bodyDoc: docWithMentionLabel('Old') }}
        resolveMention={resolveMention}
      />
    )

    expect(container.textContent).toBe('@Renamed')
  })

  it('keeps the written label while the resolver is still looking', () => {
    const resolveMention = () => ({ status: 'loading' as const, label: null, color: null })
    const { container } = render(
      <NoteBody
        note={{ body: '', bodyDoc: docWithMentionLabel('Old') }}
        resolveMention={resolveMention}
      />
    )

    expect(container.textContent).toBe('@Old')
    expect(container.querySelector('[data-mention-broken]')).toBeNull()
  })

  it('reads a Mention whose target was deleted as dead, the way the editor chip does', () => {
    const resolveMention = () => ({ status: 'missing' as const, label: null, color: null })
    const { container } = render(
      <NoteBody
        note={{ body: '', bodyDoc: docWithMentionLabel('Old') }}
        resolveMention={resolveMention}
      />
    )

    const dead = container.querySelector('[data-mention-broken]') as HTMLElement
    expect(dead.textContent).toBe('@Old')
    expect(dead.className).toContain('line-through')
    expect(dead.className).toContain('text-danger-fg')
    expect(dead.getAttribute('title')).toBe('capture · Old — target deleted')
  })

  it('leaves a live Mention as plain prose', () => {
    const resolveMention = () => ({ status: 'resolved' as const, label: 'Old', color: null })
    const { container } = render(
      <NoteBody
        note={{ body: '', bodyDoc: docWithMentionLabel('Old') }}
        resolveMention={resolveMention}
      />
    )

    expect(container.querySelector('[data-mention-broken]')).toBeNull()
  })

  it('names a Mention by its kind when it was written without a label', () => {
    const { container } = render(<NoteBody note={{ body: '', bodyDoc: docWithMentionLabel('') }} />)

    expect(container.textContent).toBe('@capture')
  })

  it('renders a node that lost its target type as bare text, not as a broken row', () => {
    const { container } = render(
      <NoteBody note={{ body: '', bodyDoc: docWithMentionLabel('Thread', 'nonsense') }} />
    )

    expect(container.textContent).toBe('Thread')
  })
})
