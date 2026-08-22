// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import type { Capture, Tag } from '@shared/types'

const navigateSpy = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateSpy }))

import {
  MentionChipView,
  createMentionNodeView
} from '@renderer/components/notes/mention/MentionChip'
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

function stubLists(captures: Capture[] = [capture], tags: Tag[] = [tag]) {
  fakeBridge({
    captures: { list: vi.fn(async () => captures) },
    notes: { list: vi.fn(async () => []) },
    selectors: { list: vi.fn(async () => []), matchCounts: vi.fn(async () => ({})) },
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
    expect(onOpen).not.toHaveBeenCalled()
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

  it('routes a tag chip to the screen that shows tags', async () => {
    const Chip = createMentionNodeView('case1')
    render(<Chip {...nodeProps({ targetType: 'tag', targetId: 't1', label: 'suspect' })} />, {
      wrapper: Wrapper
    })
    fireEvent.click(await screen.findByText('#suspect'))
    expect(navigateSpy).toHaveBeenCalledWith({
      to: '/cases/$caseId/tags',
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
