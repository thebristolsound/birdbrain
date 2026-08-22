// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import {
  MentionSuggestionList,
  type MentionSuggestionListHandle
} from '@renderer/components/notes/mention/MentionSuggestionList'
import type { MentionCandidate } from '@renderer/components/notes/mention/mentionModel'

function candidate(id: string, label: string): MentionCandidate {
  return { targetType: 'capture', targetId: id, label, meta: 'capture', color: '#f59e0b' }
}

const ITEMS = [candidate('a', 'Alpha'), candidate('b', 'Bravo'), candidate('c', 'Charlie')]

function renderList(props: Partial<Parameters<typeof MentionSuggestionList>[0]> = {}) {
  const ref = createRef<MentionSuggestionListHandle>()
  const onPick = vi.fn()
  const view = render(
    <MentionSuggestionList
      ref={ref}
      sigil="@"
      query="al"
      items={ITEMS}
      onPick={onPick}
      {...props}
    />
  )
  return { ref, onPick, view }
}

// The plugin calls the handle straight from ProseMirror's keydown prop, well
// outside React's event system, so the re-render has to be flushed by hand.
function press(ref: React.RefObject<MentionSuggestionListHandle | null>, key: string): boolean {
  let handled = false
  act(() => {
    handled = ref.current!.onKeyDown({ event: new KeyboardEvent('keydown', { key }) })
  })
  return handled
}

afterEach(cleanup)

describe('MentionSuggestionList', () => {
  it('shows the query and the kinds the sigil offers', () => {
    renderList()
    expect(screen.getByText('al')).toBeTruthy()
    expect(screen.getByText('captures · notes')).toBeTruthy()
  })

  it('names the other pair of kinds behind #', () => {
    renderList({ sigil: '#' })
    expect(screen.getByText('selectors · tags')).toBeTruthy()
  })

  it('prompts rather than showing an empty query string', () => {
    renderList({ query: '' })
    expect(screen.getByText('start typing…')).toBeTruthy()
  })

  it('carries the keyboard contract in its footer', () => {
    renderList()
    expect(screen.getByText('↑↓ to move · ⏎ to insert')).toBeTruthy()
    expect(screen.getByText('esc to dismiss')).toBeTruthy()
  })

  it('selects the first row until something moves the selection', () => {
    renderList()
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false'
    ])
  })

  it('wraps past the end on ArrowDown', () => {
    const { ref } = renderList()
    expect(press(ref, 'ArrowDown')).toBe(true)
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true')
    press(ref, 'ArrowDown')
    press(ref, 'ArrowDown')
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true')
  })

  it('wraps past the start on ArrowUp', () => {
    const { ref } = renderList()
    expect(press(ref, 'ArrowUp')).toBe(true)
    expect(screen.getAllByRole('option')[2].getAttribute('aria-selected')).toBe('true')
  })

  it('inserts on Enter and on Tab alike', () => {
    const { ref, onPick } = renderList()
    expect(press(ref, 'Enter')).toBe(true)
    expect(onPick).toHaveBeenCalledWith(ITEMS[0])
    press(ref, 'ArrowDown')
    expect(press(ref, 'Tab')).toBe(true)
    expect(onPick).toHaveBeenLastCalledWith(ITEMS[1])
  })

  it('leaves any other key to the editor', () => {
    const { ref } = renderList()
    expect(press(ref, 'a')).toBe(false)
  })

  it('clamps a selection the list shrank underneath', () => {
    const { ref, onPick, view } = renderList()
    press(ref, 'ArrowUp')

    view.rerender(
      <MentionSuggestionList
        ref={ref}
        sigil="@"
        query="al"
        items={ITEMS.slice(0, 1)}
        onPick={onPick}
      />
    )

    expect(press(ref, 'Enter')).toBe(true)
    expect(onPick).toHaveBeenCalledWith(ITEMS[0])
  })

  it('starts over when the query changes', () => {
    const { ref, onPick, view } = renderList()
    press(ref, 'ArrowDown')

    view.rerender(
      <MentionSuggestionList ref={ref} sigil="@" query="alp" items={ITEMS} onPick={onPick} />
    )

    press(ref, 'Enter')
    expect(onPick).toHaveBeenCalledWith(ITEMS[0])
  })

  it('follows the pointer, so hovering a row is what Enter would take', () => {
    const { ref, onPick } = renderList()
    fireEvent.mouseEnter(screen.getAllByRole('option')[2])
    press(ref, 'Enter')
    expect(onPick).toHaveBeenCalledWith(ITEMS[2])
  })

  it('inserts the row that was clicked', () => {
    const { onPick } = renderList()
    fireEvent.click(screen.getAllByRole('option')[1])
    expect(onPick).toHaveBeenCalledWith(ITEMS[1])
  })

  it('renders nothing at all when nothing matched, and keeps every key', () => {
    const { ref } = renderList({ items: [] })
    expect(screen.queryByTestId('mention-popup')).toBeNull()
    expect(press(ref, 'ArrowDown')).toBe(false)
    expect(press(ref, 'Enter')).toBe(false)
  })

  it("stroke-colours each row's icon with its entity colour", () => {
    renderList({
      items: [
        { targetType: 'tag', targetId: 't1', label: 'suspect', meta: 'tag', color: '#22c55e' }
      ]
    })
    const icon = screen.getByRole('option').querySelector('svg')
    expect(icon?.getAttribute('style')).toContain('rgb(34, 197, 94)')
  })
})
