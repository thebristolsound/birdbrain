// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import type { Capture, Note, Selector, Tag } from '@shared/types'

const navigateSpy = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateSpy }))

import {
  MentionChipView,
  PEEK_CLOSE_DELAY,
  createMentionNodeView
} from '@renderer/components/notes/mention/MentionChip'
import { PEEK_WIDTH, peekPosition } from '@renderer/components/notes/mention/MentionPeekCard'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'

const capture: Capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/thread',
  title: 'Nightjar thread',
  hash: 'h',
  timestamp: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-08-01T00:00:00.000Z',
  format: 'mhtml',
  method: 'extension'
}

const tag: Tag = { id: 't1', name: 'suspect', color: '#22c55e' }

const note: Note = {
  id: 'n1',
  caseId: 'case1',
  title: 'Timeline',
  body: '',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
}

const selector: Selector = {
  id: 's1',
  caseId: 'case1',
  pattern: 'nightjar',
  isRegex: false,
  enabled: true,
  label: 'nightjar',
  createdAt: '2026-08-01T00:00:00.000Z'
}

function stubLists(
  captures: Capture[] = [capture],
  tags: Tag[] = [tag],
  notes: Note[] = [note],
  selectors: Selector[] = [selector]
) {
  fakeBridge({
    captures: { list: vi.fn(async () => captures) },
    notes: { list: vi.fn(async () => notes) },
    selectors: { list: vi.fn(async () => selectors), matchCounts: vi.fn(async () => ({})) },
    tags: { list: vi.fn(async () => tags), usageCountsForCase: vi.fn(async () => ({})) }
  })
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

// The node view only reads `node`; everything else on NodeViewProps is inert
// here, which is what lets the chip be exercised without an editor.
function nodeProps(attrs: Record<string, unknown>): NodeViewProps {
  return { node: { attrs } } as unknown as NodeViewProps
}

beforeEach(() => {
  stubLists()
})

afterEach(() => {
  cleanup()
  navigateSpy.mockReset()
})

describe('MentionChipView', () => {
  it('renders the sigil for the kind followed by the label', () => {
    render(<MentionChipView targetType="selector" targetId="s1" label="nightjar" broken={false} />)
    expect(screen.getByText('#nightjar')).toBeTruthy()
  })

  it('elides a label past thirty characters so a chip cannot blow out a line', () => {
    const long = 'x'.repeat(40)
    render(<MentionChipView targetType="capture" targetId="c1" label={long} broken={false} />)
    expect(screen.getByText(`@${'x'.repeat(29)}…`)).toBeTruthy()
  })

  it('carries the entity colour as the --mention-color custom property', () => {
    const { container } = render(
      <MentionChipView targetType="capture" targetId="c1" label="Thread" broken={false} />
    )
    const chip = container.querySelector('[data-mention-chip]') as HTMLElement
    expect(chip.style.getPropertyValue('--mention-color')).toBe('var(--color-amber-500)')
    expect(chip.className).toBe('mention-chip')
  })

  it("prefers a tag's own colour over the fallback", () => {
    const { container } = render(
      <MentionChipView
        targetType="tag"
        targetId="t1"
        label="suspect"
        broken={false}
        tagColor="#22c55e"
      />
    )
    const chip = container.querySelector('[data-mention-chip]') as HTMLElement
    expect(chip.style.getPropertyValue('--mention-color')).toBe('#22c55e')
  })

  it('marks a broken chip, colours it destructive and does not invite a click', () => {
    const onOpen = vi.fn()
    const { container } = render(
      <MentionChipView targetType="capture" targetId="c1" label="Thread" broken onOpen={onOpen} />
    )
    const chip = container.querySelector('[data-mention-chip]') as HTMLElement
    expect(chip.hasAttribute('data-mention-broken')).toBe(true)
    expect(chip.className).toContain('mention-chip-broken')
    expect(chip.style.getPropertyValue('--mention-color')).toBe('var(--color-danger-fg)')
    expect(chip.getAttribute('title')).toBe('capture · Thread — target deleted')
    fireEvent.click(chip)
    fireEvent.keyDown(chip, { key: 'Enter' })
    expect(onOpen).not.toHaveBeenCalled()
    // Nothing happens on activation, so it must not be a tab stop either.
    expect(chip.getAttribute('role')).toBeNull()
    expect(chip.getAttribute('tabindex')).toBeNull()
  })

  it('opens the target on click without also moving the caret', () => {
    const onOpen = vi.fn()
    const { container } = render(
      <MentionChipView
        targetType="capture"
        targetId="c1"
        label="Thread"
        broken={false}
        onOpen={onOpen}
      />
    )
    const chip = container.querySelector('[data-mention-chip]') as HTMLElement
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(chip, event)
    expect(onOpen).toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('is a focusable control, so a chip is reachable without a mouse', () => {
    const { container } = render(
      <MentionChipView targetType="capture" targetId="c1" label="Thread" broken={false} />
    )
    const chip = container.querySelector('[data-mention-chip]') as HTMLElement
    expect(chip.getAttribute('role')).toBe('button')
    expect(chip.tabIndex).toBe(0)
  })

  // Both keys mean something to the editor underneath, so activation has to
  // cancel the press rather than let it open the target *and* split the
  // paragraph or type a space.
  it.each(['Enter', ' '])('opens the target on %j and cancels the key', (key) => {
    const onOpen = vi.fn()
    const { container } = render(
      <MentionChipView
        targetType="capture"
        targetId="c1"
        label="Thread"
        broken={false}
        onOpen={onOpen}
      />
    )
    const chip = container.querySelector('[data-mention-chip]') as HTMLElement
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    fireEvent(chip, event)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves every other key to the editor', () => {
    const onOpen = vi.fn()
    const { container } = render(
      <MentionChipView
        targetType="capture"
        targetId="c1"
        label="Thread"
        broken={false}
        onOpen={onOpen}
      />
    )
    const chip = container.querySelector('[data-mention-chip]') as HTMLElement
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    fireEvent(chip, event)
    expect(onOpen).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('the Mention node view', () => {
  it('shows the stored label while the lists are still in flight, not a broken chip', () => {
    const Chip = createMentionNodeView('case1')
    const { container } = render(
      <Chip {...nodeProps({ targetType: 'capture', targetId: 'cap1', label: 'Old title' })} />,
      { wrapper: Wrapper }
    )
    const chip = container.querySelector('[data-mention-chip]') as HTMLElement
    expect(chip.hasAttribute('data-mention-broken')).toBe(false)
    expect(chip.textContent).toBe('@Old title')
  })

  it('follows a rename once the capture list arrives', async () => {
    const Chip = createMentionNodeView('case1')
    render(
      <Chip {...nodeProps({ targetType: 'capture', targetId: 'cap1', label: 'Old title' })} />,
      {
        wrapper: Wrapper
      }
    )
    expect(await screen.findByText('@Nightjar thread')).toBeTruthy()
  })

  it('breaks a chip whose target is gone from the loaded list', async () => {
    stubLists([])
    const Chip = createMentionNodeView('case1')
    const { container } = render(
      <Chip {...nodeProps({ targetType: 'capture', targetId: 'cap1', label: 'Old title' })} />,
      { wrapper: Wrapper }
    )
    await screen.findByTitle('capture · Old title — target deleted')
    expect(container.querySelector('[data-mention-broken]')).not.toBeNull()
  })

  it('navigates to the captures screen with the capture selected', async () => {
    const Chip = createMentionNodeView('case1')
    render(<Chip {...nodeProps({ targetType: 'capture', targetId: 'cap1', label: 'Thread' })} />, {
      wrapper: Wrapper
    })
    fireEvent.click(await screen.findByText('@Nightjar thread'))
    expect(useAppStore.getState().selectedCaptureId).toBe('cap1')
    expect(navigateSpy).toHaveBeenCalledWith({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case1' }
    })
  })

  it('routes a tag chip to the Signals screen and names the tag it opens', async () => {
    // Seeded with a different id on purpose. Signals falls back to
    // allSignals[0] and the store field is sticky, so an assertion against an
    // empty store passes whether or not the chip hands its target over (#716).
    useAppStore.getState().setSelectedSignalId('someone-elses-signal')
    const Chip = createMentionNodeView('case1')
    render(<Chip {...nodeProps({ targetType: 'tag', targetId: 't1', label: 'suspect' })} />, {
      wrapper: Wrapper
    })
    fireEvent.click(await screen.findByText('#suspect'))
    expect(useAppStore.getState().selectedSignalId).toBe('t1')
    expect(navigateSpy).toHaveBeenCalledWith({
      to: '/cases/$caseId/signals',
      params: { caseId: 'case1' }
    })
  })

  it('routes a selector chip to the Signals screen and names the rule it opens', async () => {
    useAppStore.getState().setSelectedSignalId('someone-elses-signal')
    const Chip = createMentionNodeView('case1')
    render(<Chip {...nodeProps({ targetType: 'selector', targetId: 's1', label: 'nightjar' })} />, {
      wrapper: Wrapper
    })
    fireEvent.click(await screen.findByText('#nightjar'))
    expect(useAppStore.getState().selectedSignalId).toBe('s1')
    expect(navigateSpy).toHaveBeenCalledWith({
      to: '/cases/$caseId/signals',
      params: { caseId: 'case1' }
    })
  })

  it('opens the note a chip names rather than the one already selected', async () => {
    // #772: the Notes screen rings whatever selectedNoteId holds, and the
    // dashboard activity feed leaves it set, so a chip that does not write its
    // own target opens a different note than the one it names.
    useAppStore.getState().setSelectedNoteId('a-previously-opened-note')
    const Chip = createMentionNodeView('case1')
    render(<Chip {...nodeProps({ targetType: 'note', targetId: 'n1', label: 'Timeline' })} />, {
      wrapper: Wrapper
    })
    fireEvent.click(await screen.findByText('@Timeline'))
    expect(useAppStore.getState().selectedNoteId).toBe('n1')
    expect(navigateSpy).toHaveBeenCalledWith({
      to: '/cases/$caseId/notes',
      params: { caseId: 'case1' }
    })
  })

  // The paste that motivated the Object.hasOwn guard. `constructor` used to
  // pass isMentionTargetType, resolve to undefined, and throw here — the error
  // boundary at __root then unmounted the route body and took the draft.
  it.each(['constructor', '__proto__', 'toString'])(
    'renders a pasted data-target-type="%s" as broken rather than throwing',
    (rawType) => {
      const Chip = createMentionNodeView('case1')
      const { container } = render(
        <Chip {...nodeProps({ targetType: rawType, targetId: 'cap1', label: 'Thread' })} />,
        { wrapper: Wrapper }
      )
      expect(container.querySelector('[data-mention-broken]')).not.toBeNull()
      expect(container.textContent).toBe('@Thread')
    }
  )

  it('names the kind when a valid node has no label and none has resolved yet', () => {
    // Valid identity, empty label cache, lists still in flight. `??` treated
    // the empty string as a label and rendered a bare '#'.
    const Chip = createMentionNodeView('case1')
    const { container } = render(
      <Chip {...nodeProps({ targetType: 'selector', targetId: 's1', label: '' })} />,
      { wrapper: Wrapper }
    )
    expect(container.textContent).toBe('#selector')
  })

  it('opens the target from the keyboard, not only from a click', async () => {
    useAppStore.getState().setSelectedCaptureId('a-previously-opened-capture')
    const Chip = createMentionNodeView('case1')
    render(<Chip {...nodeProps({ targetType: 'capture', targetId: 'cap1', label: 'Thread' })} />, {
      wrapper: Wrapper
    })
    fireEvent.keyDown(await screen.findByText('@Nightjar thread'), { key: 'Enter' })
    expect(useAppStore.getState().selectedCaptureId).toBe('cap1')
    expect(navigateSpy).toHaveBeenCalledWith({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case1' }
    })
  })

  it('renders a node that lost its identity attributes as broken rather than throwing', () => {
    const Chip = createMentionNodeView('case1')
    const { container } = render(<Chip {...nodeProps({ targetType: null, targetId: null })} />, {
      wrapper: Wrapper
    })
    expect(container.querySelector('[data-mention-broken]')).not.toBeNull()
    expect(container.textContent).toBe('@mention')
  })
})

describe('the peek card', () => {
  const peek = { title: 'Nightjar thread', meta: 'capture · example.com' }

  function renderChip(onOpen = vi.fn()) {
    const utils = render(
      <MentionChipView
        targetType="capture"
        targetId="cap1"
        label="Nightjar thread"
        broken={false}
        onOpen={onOpen}
        peek={peek}
      />
    )
    const chip = utils.container.querySelector('[data-mention-chip]') as HTMLElement
    return { ...utils, chip, onOpen }
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens on hover with the title, the meta line and both actions', () => {
    const { chip } = renderChip()
    expect(screen.queryByTestId('mention-peek')).toBeNull()

    fireEvent.mouseEnter(chip)

    const card = screen.getByTestId('mention-peek')
    expect(screen.getByTestId('mention-peek-title').textContent).toBe('Nightjar thread')
    expect(screen.getByTestId('mention-peek-meta').textContent).toBe('capture · example.com')
    expect(screen.getByTestId('mention-peek-open').textContent).toBe('Open')
    expect(screen.getByTestId('mention-peek-pin').textContent).toBe('Pin')
    // Described by the card, and no native tooltip opening on top of it.
    expect(chip.getAttribute('aria-describedby')).toBe(card.id)
    expect(chip.getAttribute('title')).toBeNull()
  })

  it('closes a moment after the pointer leaves, unless it moves onto the card', () => {
    vi.useFakeTimers()
    const { chip } = renderChip()
    fireEvent.mouseEnter(chip)

    fireEvent.mouseLeave(chip)
    fireEvent.mouseEnter(screen.getByTestId('mention-peek'))
    act(() => {
      vi.advanceTimersByTime(PEEK_CLOSE_DELAY * 2)
    })
    expect(screen.queryByTestId('mention-peek')).not.toBeNull()

    fireEvent.mouseLeave(screen.getByTestId('mention-peek'))
    act(() => {
      vi.advanceTimersByTime(PEEK_CLOSE_DELAY)
    })
    expect(screen.queryByTestId('mention-peek')).toBeNull()
  })

  it('opens on keyboard focus and closes on blur', () => {
    vi.useFakeTimers()
    const { chip } = renderChip()

    fireEvent.focus(chip)
    expect(screen.queryByTestId('mention-peek')).not.toBeNull()

    fireEvent.blur(chip)
    act(() => {
      vi.advanceTimersByTime(PEEK_CLOSE_DELAY)
    })
    expect(screen.queryByTestId('mention-peek')).toBeNull()
  })

  it('opens the target once from Open and closes the card', () => {
    const { chip, onOpen } = renderChip()
    fireEvent.mouseEnter(chip)

    fireEvent.click(screen.getByTestId('mention-peek-open'))

    // Once: the click must not also bubble through the portal to the chip.
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('mention-peek')).toBeNull()
  })

  it('stays open once pinned, and closes on a press elsewhere', () => {
    vi.useFakeTimers()
    const { chip, onOpen } = renderChip()
    fireEvent.mouseEnter(chip)

    fireEvent.click(screen.getByTestId('mention-peek-pin'))
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.getByTestId('mention-peek-pin').getAttribute('aria-pressed')).toBe('true')
    fireEvent.mouseLeave(chip)
    act(() => {
      vi.advanceTimersByTime(PEEK_CLOSE_DELAY * 4)
    })
    expect(screen.queryByTestId('mention-peek')).not.toBeNull()

    // A press on the card or on the chip is not "elsewhere".
    fireEvent.mouseDown(screen.getByTestId('mention-peek-title'))
    fireEvent.mouseDown(chip)
    expect(screen.queryByTestId('mention-peek')).not.toBeNull()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('mention-peek')).toBeNull()
  })

  it('unpins, and then closes like an unpinned card', () => {
    vi.useFakeTimers()
    const { chip } = renderChip()
    fireEvent.mouseEnter(chip)
    fireEvent.click(screen.getByTestId('mention-peek-pin'))

    fireEvent.click(screen.getByTestId('mention-peek-pin'))
    expect(screen.getByTestId('mention-peek-pin').getAttribute('aria-pressed')).toBe('false')
    fireEvent.mouseLeave(chip)
    act(() => {
      vi.advanceTimersByTime(PEEK_CLOSE_DELAY)
    })
    expect(screen.queryByTestId('mention-peek')).toBeNull()
  })

  it('follows the chip when the note scrolls', () => {
    const { chip } = renderChip()
    fireEvent.mouseEnter(chip)
    chip.getBoundingClientRect = () => ({ left: 40, top: 300, bottom: 320 }) as DOMRect

    fireEvent.scroll(window)

    const card = screen.getByTestId('mention-peek')
    expect(card.style.left).toBe('40px')
    expect(card.style.top).toBe('292px')
  })

  it('raises nothing over a broken chip', () => {
    const { container } = render(
      <MentionChipView targetType="capture" targetId="c1" label="Thread" broken peek={peek} />
    )
    fireEvent.mouseEnter(container.querySelector('[data-mention-chip]') as HTMLElement)
    expect(screen.queryByTestId('mention-peek')).toBeNull()
  })

  it('raises nothing when no peek was supplied, and keeps the tooltip', () => {
    const { container } = render(
      <MentionChipView targetType="capture" targetId="c1" label="Thread" broken={false} />
    )
    const chip = container.querySelector('[data-mention-chip]') as HTMLElement
    fireEvent.mouseEnter(chip)
    expect(screen.queryByTestId('mention-peek')).toBeNull()
    expect(chip.getAttribute('title')).toBe('capture · Thread — click to open')
  })
})

describe('the node view peek', () => {
  it('peeks at a resolved target with its current title and a meta line', async () => {
    const Chip = createMentionNodeView('case1')
    render(<Chip {...nodeProps({ targetType: 'capture', targetId: 'cap1', label: 'Old' })} />, {
      wrapper: Wrapper
    })

    fireEvent.mouseEnter(await screen.findByText('@Nightjar thread'))

    expect(screen.getByTestId('mention-peek-title').textContent).toBe('Nightjar thread')
    expect(screen.getByTestId('mention-peek-meta').textContent).toBe('capture · example.com')
  })

  it('does not peek while the lists are still in flight', () => {
    const Chip = createMentionNodeView('case1')
    render(<Chip {...nodeProps({ targetType: 'capture', targetId: 'cap1', label: 'Old' })} />, {
      wrapper: Wrapper
    })

    fireEvent.mouseEnter(screen.getByText('@Old'))

    expect(screen.queryByTestId('mention-peek')).toBeNull()
  })
})

describe('peekPosition', () => {
  it('sits above the chip, left-aligned with it', () => {
    expect(peekPosition({ left: 100, top: 400, bottom: 420 }, 1200)).toEqual({
      left: 100,
      top: 392,
      placement: 'above'
    })
  })

  it('opens below a chip too near the top of the window', () => {
    expect(peekPosition({ left: 100, top: 40, bottom: 60 }, 1200)).toEqual({
      left: 100,
      top: 68,
      placement: 'below'
    })
  })

  it('keeps the card inside both window edges', () => {
    expect(peekPosition({ left: 1100, top: 400, bottom: 420 }, 1200).left).toBe(
      1200 - PEEK_WIDTH - 8
    )
    expect(peekPosition({ left: -20, top: 400, bottom: 420 }, 1200).left).toBe(8)
  })
})
