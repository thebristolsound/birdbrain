import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { noteExtensions, parseNoteDoc, noteDocToText } from '@shared/noteDoc'
import { NoteToolbar } from '@renderer/components/notes/NoteToolbar'

let editor: Editor
beforeEach(() => {
  editor = new Editor({ extensions: noteExtensions(), content: '<p>Observation</p>' })
})
afterEach(() => {
  cleanup()
  editor.destroy()
})
function show() {
  return render(<NoteToolbar editor={editor} workspace />)
}
function click(label: string) {
  fireEvent.mouseDown(screen.getByRole('button', { name: label }))
  fireEvent.click(screen.getByRole('button', { name: label }))
}

describe('note formatting controls', () => {
  it('exposes every supported format and history command while leaving code blocks disabled', () => {
    const { rerender } = show()
    expect(screen.queryByRole('button', { name: 'Code block' })).toBeNull()
    for (const [label, mark] of [
      ['Bold', 'bold'],
      ['Italic', 'italic'],
      ['Strikethrough', 'strike'],
      ['Inline code', 'code']
    ]) {
      act(() => {
        editor.commands.setTextSelection({ from: 1, to: 12 })
      })
      click(label)
      expect(editor.isActive(mark)).toBe(true)
      click(label)
    }
    act(() => editor.commands.setTextSelection(1))
    click('Heading 1')
    expect(editor.isActive('heading', { level: 1 })).toBe(true)
    click('Heading 2')
    expect(editor.isActive('heading', { level: 2 })).toBe(true)
    fireEvent.change(screen.getByLabelText('Text style'), { target: { value: '3' } })
    expect(editor.isActive('heading', { level: 3 })).toBe(true)
    fireEvent.change(screen.getByLabelText('Text style'), { target: { value: 'paragraph' } })
    expect(editor.isActive('paragraph')).toBe(true)
    click('Bullet list')
    expect(editor.isActive('bulletList')).toBe(true)
    click('Bullet list')
    click('Numbered list')
    expect(editor.isActive('orderedList')).toBe(true)
    click('Numbered list')
    click('Quote')
    expect(editor.isActive('blockquote')).toBe(true)
    click('Quote')
    act(() => editor.commands.insertContent('Extra'))
    rerender(<NoteToolbar editor={editor} workspace={false} />)
    click('Undo')
    rerender(<NoteToolbar editor={editor} workspace={false} />)
    click('Redo')
    expect(editor.getText()).toContain('Extra')
    click('Link a capture')
    expect(editor.getText()).toContain('@')
  })

  it('inserts a valid link at the saved selection and rejects unsafe schemes', async () => {
    show()
    act(() => editor.commands.setTextSelection({ from: 1, to: 12 }))
    click('Insert link')
    fireEvent.change(screen.getByLabelText('Link URL'), {
      target: { value: 'javascript:alert(1)' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    expect(screen.getByRole('alert').textContent).toContain('http or https')
    fireEvent.change(screen.getByLabelText('Link URL'), {
      target: { value: 'https://example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    expect(editor.getHTML()).toContain('href="https://example.com"')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    act(() => editor.commands.setTextSelection(editor.state.doc.content.size - 1))
    click('Insert link')
    fireEvent.change(screen.getByLabelText('Link URL'), {
      target: { value: 'https://second.example' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    expect(editor.getText()).toContain('https://second.example')
  })

  it('embeds a selected raster file in the shared schema with searchable alternate text', async () => {
    show()
    const picker = screen.getByLabelText('Choose note image')
    const picked = vi.spyOn(picker, 'click')
    click('Insert image')
    expect(picked).toHaveBeenCalled()
    fireEvent.change(picker, {
      target: { files: [new File(['pixels'], 'site.png', { type: 'image/png' })] }
    })
    await waitFor(() =>
      expect(editor.getJSON().content?.some((n) => n.type === 'image')).toBe(true)
    )
    const saved = parseNoteDoc(JSON.stringify(editor.getJSON()))
    expect(noteDocToText(saved)).toContain('site.png')
    expect(editor.getHTML()).toContain('src="data:image/png;base64,')
    expect(editor.getHTML()).toContain('max-width: 100%')
  })

  it('drops pasted remote images while retaining surrounding prose and embedded image attributes', () => {
    editor.commands.setContent(
      '<p>Keep this text</p><img src="https://example.com/tracker.png" alt="remote">'
    )
    expect(editor.getJSON().content?.some((n) => n.type === 'image')).toBe(false)
    expect(editor.getText()).toBe('Keep this text')
    editor.commands.setContent('<img src="data:image/png;base64,aA==" alt="Local example">')
    const doc = parseNoteDoc(JSON.stringify(editor.getJSON()))
    expect(doc.content?.[0].attrs).toEqual({
      src: 'data:image/png;base64,aA==',
      alt: 'Local example'
    })
  })

  it('rejects unsupported and oversized files without changing the note', () => {
    show()
    const before = editor.getJSON()
    const picker = screen.getByLabelText('Choose note image')
    fireEvent.change(picker, { target: { files: [] } })
    fireEvent.change(picker, {
      target: { files: [new File(['svg'], 'site.svg', { type: 'image/svg+xml' })] }
    })
    expect(screen.getByRole('alert').textContent).toContain('under 2 MB')
    fireEvent.change(picker, {
      target: { files: [new File(['x'.repeat(2_000_001)], 'large.png', { type: 'image/png' })] }
    })
    expect(editor.getJSON()).toEqual(before)
  })
})
