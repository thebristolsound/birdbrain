import type { Extensions, Node as TiptapNode } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { noteExtensions } from '@shared/noteDoc'
import { createMentionNodeView } from '@renderer/components/notes/mention/MentionChip'
import {
  isMentionTargetType,
  type MentionSources
} from '@renderer/components/notes/mention/mentionModel'
import { MentionSuggestion } from '@renderer/components/notes/mention/mentionSuggestion'

export interface RendererNoteExtensionsArgs {
  caseId: string
  /** Reads the cached lists at call time; see MentionSuggestionOptions. */
  getSources: () => MentionSources
  excludeNoteId?: string
}

/**
 * The renderer's half of the Mention node: a chip to look at, and the ability
 * to read its identity back off pasted HTML.
 *
 * Neither changes the document model. Attribute *specs* are built from
 * `default` alone, so adding `parseHTML` readers leaves the schema's attrs
 * byte-identical to the one main validates against; the node view is not in
 * the spec at all. The one spec field that does differ is `parseDOM`, and it
 * differs deliberately — see below.
 */
function withMentionChip(node: TiptapNode, component: Parameters<typeof ReactNodeViewRenderer>[0]) {
  return node.extend({
    addAttributes() {
      // Spread the parent set. Replacing it would drop the defaults the shared
      // schema is built from, which is the one way this could change the model.
      return {
        ...this.parent?.(),
        targetType: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute('data-target-type')
        },
        targetId: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute('data-target-id')
        },
        // The stored label is a display cache, so recovering it from the text
        // the span carried is exact enough; the live label re-resolves anyway.
        label: {
          default: '',
          parseHTML: (element: HTMLElement) => (element.textContent ?? '').replace(/^[@#]/, '')
        }
      }
    },

    /**
     * Narrower than the shared rule on purpose.
     *
     * Tiptap's generated attribute reader looks for an attribute named
     * `targetType`, while the serializer writes `data-target-type`, so before
     * the readers above a pasted Mention parsed to a node with null identity
     * attrs — and the next save of that note threw, losing the whole note
     * rather than the chip. Requiring both identity attributes on the tag, and
     * rejecting a target type the model does not define, means markup that
     * cannot produce a valid Mention is not parsed as one: it degrades to the
     * text it displayed, which is readable and saveable.
     */
    parseHTML() {
      return [
        {
          tag: 'span[data-mention][data-target-type][data-target-id]',
          getAttrs: (element: HTMLElement) => {
            const targetId = element.getAttribute('data-target-id')
            if (!isMentionTargetType(element.getAttribute('data-target-type'))) return false
            if (!targetId) return false
            return null
          }
        }
      ]
    },

    addNodeView() {
      return ReactNodeViewRenderer(component)
    }
  })
}

/**
 * The extension list the note editor runs on.
 *
 * Built by extending what `noteExtensions()` returns rather than by declaring
 * a second list: main imports that module and derives every note's indexed
 * text from it, so the two processes have to agree on which nodes exist. This
 * adds a view and two autocompletes on top of that agreement, and no nodes.
 */
export function rendererNoteExtensions({
  caseId,
  getSources,
  excludeNoteId
}: RendererNoteExtensionsArgs): Extensions {
  const MentionChip = createMentionNodeView(caseId)
  const base = noteExtensions().map((extension) =>
    extension.name === 'mention' ? withMentionChip(extension as TiptapNode, MentionChip) : extension
  )
  return [...base, MentionSuggestion.configure({ getSources, excludeNoteId })]
}
