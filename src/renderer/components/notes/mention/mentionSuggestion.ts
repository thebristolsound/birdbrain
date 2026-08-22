import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import {
  MENTION_SIGILS,
  EMPTY_MENTION_SOURCES,
  rankMentionCandidates,
  type MentionCandidate,
  type MentionSigil,
  type MentionSources
} from '@renderer/components/notes/mention/mentionModel'
import {
  MentionSuggestionList,
  type MentionSuggestionListHandle,
  type MentionSuggestionListProps
} from '@renderer/components/notes/mention/MentionSuggestionList'

// One key per sigil. Two Suggestion plugins share a document, and a shared key
// would make each read the other's state.
const PLUGIN_KEYS: Record<MentionSigil, PluginKey> = {
  '@': new PluginKey('mentionAt'),
  '#': new PluginKey('mentionHash')
}

export interface MentionSuggestionOptions {
  /**
   * Live view of the cached lists.
   *
   * A function rather than a ref object, and that is load-bearing twice over.
   * The plugin's `items()` closure is built once at editor construction and is
   * never rebuilt, so it has to reach current data through something. And
   * Tiptap's `configure()` merges options *deeply*: a `{ current }` object
   * passed here would be recursively copied over the default rather than
   * assigned, and the plugin would read a snapshot of whatever the lists held
   * on first render, forever. A function is not a plain object, so it survives
   * the merge by reference.
   */
  getSources: () => MentionSources
  /** The note being written, so it cannot be offered as a target of itself. */
  excludeNoteId?: string
}

type MentionRenderer = ReactRenderer<MentionSuggestionListHandle, MentionSuggestionListProps>

function renderPopup(sigil: MentionSigil) {
  let component: MentionRenderer | null = null
  let unmount: (() => void) | null = null

  const propsFor = (props: SuggestionProps<MentionCandidate, MentionCandidate>) => ({
    sigil,
    query: props.query,
    items: props.items,
    onPick: props.command
  })

  return {
    onStart: (props: SuggestionProps<MentionCandidate, MentionCandidate>) => {
      component = new ReactRenderer(MentionSuggestionList, {
        props: propsFor(props),
        editor: props.editor
      })
      // The plugin appends the element to <body>, outside the dialog's
      // stacking context, so it needs a layer of its own to clear z-50 modals.
      component.element.classList.add('mention-popup-layer')
      unmount = props.mount(component.element)
    },
    onUpdate: (props: SuggestionProps<MentionCandidate, MentionCandidate>) => {
      component?.updateProps(propsFor(props))
    },
    onKeyDown: ({ event }: { event: KeyboardEvent }) =>
      component?.ref?.onKeyDown({ event }) ?? false,
    onExit: () => {
      unmount?.()
      unmount = null
      component?.destroy()
      component = null
    }
  }
}

/**
 * The `@` and `#` autocompletes.
 *
 * Escape, dismissal on an outside click and flipping the popup above the caret
 * near the bottom of the viewport are all the plugin's, not ours. What is ours
 * is which entities each sigil offers and what inserting one writes.
 *
 * `allowedPrefixes` is left at its default of `[' ']` on purpose, so `@` only
 * opens the popup after whitespace or at the start of a block. The design
 * source triggers on a looser pattern, which in a tool whose operators type
 * email addresses and handles all day would open the popup in the middle of
 * every `alice@example.com`.
 */
export const MentionSuggestion = Extension.create<MentionSuggestionOptions>({
  name: 'mentionSuggestion',

  addOptions() {
    return { getSources: () => EMPTY_MENTION_SOURCES, excludeNoteId: undefined }
  },

  addProseMirrorPlugins() {
    const { getSources, excludeNoteId } = this.options
    const { editor } = this

    return MENTION_SIGILS.map((sigil) =>
      Suggestion<MentionCandidate, MentionCandidate>({
        editor,
        char: sigil,
        pluginKey: PLUGIN_KEYS[sigil],
        decorationClass: 'mention-suggestion',
        items: ({ query }) =>
          rankMentionCandidates({ sigil, query, sources: getSources(), excludeNoteId }),
        command: ({ editor: ed, range, props }) => {
          ed.chain()
            .focus()
            .insertContentAt(range, [
              {
                type: 'mention',
                attrs: {
                  targetType: props.targetType,
                  targetId: props.targetId,
                  label: props.label
                }
              },
              // A trailing space so the caret lands outside the atom and the
              // next character typed is not read as a fresh query.
              { type: 'text', text: ' ' }
            ])
            .run()
        },
        render: () => renderPopup(sigil)
      })
    )
  }
})
