import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import type { MentionTargetType } from '@shared/noteDoc'
import { useAppStore } from '@renderer/stores/appStore'
import {
  MENTION_BROKEN_COLOR,
  isMentionTargetType,
  maskMention,
  mentionColor,
  mentionRoute,
  mentionSelection,
  mentionTooltip
} from '@renderer/components/notes/mention/mentionModel'
import { useMentionResolver } from '@renderer/components/notes/mention/useMentionSources'

export interface MentionChipViewProps {
  targetType: MentionTargetType
  targetId: string
  /** The current label if the target resolved, the node's stored label if not. */
  label: string
  broken: boolean
  /** A tag's own colour, when one is known. */
  tagColor?: string | null
  onOpen?: () => void
}

/**
 * The chip itself, with no editor and no router underneath it.
 *
 * The entity colour arrives as the `--mention-color` custom property and the
 * geometry lives in CSS (`.mention-chip` in globals.css). That split is what
 * lets a tag chip carry the tag's own colour without a second rule per tag.
 */
export function MentionChipView({
  targetType,
  targetId,
  label,
  broken,
  tagColor,
  onOpen
}: MentionChipViewProps) {
  const color = broken ? MENTION_BROKEN_COLOR : mentionColor(targetType, tagColor)

  function handleClick(e: MouseEvent) {
    // Inside a contenteditable a click would otherwise also move the caret.
    e.preventDefault()
    e.stopPropagation()
    onOpen?.()
  }

  // A chip is a control, so it has to be reachable without a mouse. Both keys
  // mean something to the editor underneath — Enter splits the paragraph and
  // Space types a character — so activation cancels the event rather than
  // letting the same press do two things.
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    e.stopPropagation()
    onOpen?.()
  }

  // A broken chip opens nothing, so it is not a control and does not take
  // focus: a keyboard user tabbing through a note would otherwise stop on it
  // and find that nothing happens.
  const interactive = !broken

  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      data-mention-chip=""
      data-target-type={targetType}
      data-target-id={targetId}
      data-mention-broken={broken ? '' : undefined}
      className={broken ? 'mention-chip mention-chip-broken' : 'mention-chip'}
      style={{ '--mention-color': color } as CSSProperties}
      title={mentionTooltip(targetType, label, broken)}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? handleClick : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
    >
      {maskMention(targetType, label)}
    </NodeViewWrapper>
  )
}

/**
 * Build the node view for one editor.
 *
 * The case is closed over rather than threaded through node attributes: a
 * Mention's identity is (targetType, targetId) and adding a case to the stored
 * attrs would change the document model, which is exactly what this ticket
 * stays clear of.
 */
export function createMentionNodeView(caseId: string) {
  function MentionChip({ node }: NodeViewProps) {
    const navigate = useNavigate()
    const resolve = useMentionResolver(caseId)

    const rawType = node.attrs.targetType
    const targetId = typeof node.attrs.targetId === 'string' ? node.attrs.targetId : ''
    const storedLabel = typeof node.attrs.label === 'string' ? node.attrs.label : ''

    // A node with no usable target type cannot be resolved or opened. It reads
    // as broken, which is the honest rendering of a paste that lost its
    // identity attributes on the way in.
    if (!isMentionTargetType(rawType)) {
      return (
        <MentionChipView
          targetType="note"
          targetId={targetId}
          label={storedLabel || 'mention'}
          broken
        />
      )
    }

    const targetType: MentionTargetType = rawType
    const resolution = resolve(targetType, targetId)
    const broken = resolution.status === 'missing'

    function handleOpen() {
      // Every destination opens on whichever row is already selected, so a chip
      // click has to name its target before it navigates or it lands on the
      // right screen showing the wrong thing (#716, #772).
      const store = useAppStore.getState()
      // Exhaustive on purpose. A bare `else` would route a selection kind added
      // later to Signals in silence, which is the shape of defect this whole
      // fix is about.
      switch (mentionSelection(targetType)) {
        case 'capture':
          store.setSelectedCaptureId(targetId)
          break
        case 'note':
          store.setSelectedNoteId(targetId)
          break
        case 'signal':
          store.setSelectedSignalId(targetId)
          break
      }
      navigate({ to: mentionRoute(targetType), params: { caseId } })
    }

    return (
      <MentionChipView
        targetType={targetType}
        targetId={targetId}
        // `||`, not `??`: an unresolved node whose stored label is the empty
        // string would otherwise render as a bare sigil. storedLabel is already
        // coalesced to '' above, so `??` never reached the target-type fallback.
        label={resolution.label || storedLabel || targetType}
        broken={broken}
        tagColor={resolution.color}
        onOpen={handleOpen}
      />
    )
  }

  MentionChip.displayName = 'MentionChip'
  return MentionChip
}
