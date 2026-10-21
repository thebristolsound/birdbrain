import { useQuery } from '@tanstack/react-query'
import type { Note } from '@shared/types'
import { captureHeldQueryOptions } from '@renderer/lib/api/captures'
import {
  noteCaptureLink,
  type NoteCaptureLink
} from '@renderer/components/notes/notesWorkspaceModel'
import type { MentionResolver } from '@renderer/components/notes/mention/useMentionSources'

/** noteCaptureLink, asking main whether any Case holds a Capture the note's Case does not list. */
export function useNoteCaptureLink(
  note: Pick<Note, 'captureId'>,
  resolve: MentionResolver
): NoteCaptureLink {
  const { captureId } = note
  const missing = !!captureId && resolve('capture', captureId).status === 'missing'
  const { data: held } = useQuery({
    ...captureHeldQueryOptions(captureId ?? ''),
    enabled: missing
  })
  return noteCaptureLink(note, resolve, held === undefined ? 'loading' : held ? 'held' : 'gone')
}
